import { Hono } from 'hono';
import type { WorkerRuntime, WorkerServices } from '../composition';
import { favoriteCollectiveKeySchema, favoritePublicCacheBatchRequestSchema, favoritePublicCacheBatchResponseSchema, favoritePublicCacheEntrySchema } from '@tobirink/application';
import { bodyLimit } from 'hono/body-limit';

const publicIdPattern = /^[A-Za-z0-9_-]{1,128}$/u;
const providerPattern = /^[a-z0-9-]{1,32}$/u;

interface CatalogueCursor {
  id: string;
  revision: number;
}

type CatalogueServices = Pick<WorkerServices, 'catalogue' | 'policy'>;

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: CatalogueServices): CatalogueServices {
  return injected ?? context.get('services');
}

function parseLimit(value: string | undefined, services: CatalogueServices): number | undefined {
  if (value === undefined) return services.policy.catalogue.defaultPageSize;
  if (!/^\d{1,3}$/u.test(value)) return undefined;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= services.policy.catalogue.maximumPageSize ? parsed : undefined;
}

function encodeCursor(row: { id: string; revision: number }): string {
  return `${row.revision}.${row.id}`;
}

function parseCursor(value: string | undefined): CatalogueCursor | undefined {
  if (value === undefined) return { id: '', revision: -1 };
  const match = /^(\d{1,10})\.([A-Za-z0-9_-]{1,128})$/u.exec(value);
  if (!match) return undefined;
  const revision = Number.parseInt(match[1] ?? '', 10);
  return Number.isSafeInteger(revision) ? { id: match[2] ?? '', revision } : undefined;
}

function validPublicId(value: string): boolean {
  return publicIdPattern.test(value);
}

function parseTitle(value: string | undefined): string | undefined {
  const title = value?.trim();
  if (!title || title.length > 200) return undefined;
  const hasControlCharacter = [...title].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
  return hasControlCharacter ? undefined : title;
}

export function createCatalogueApp(injected?: CatalogueServices) {
  const app = new Hono<WorkerRuntime>();

  app.use('/v1/catalogue/*', async (context, next) => {
    await next();
    const services = routeServices(context, injected);
    context.header('Cache-Control', context.res.status < 400 ? services.policy.http.publicReadCacheControl : services.policy.http.noStore);
    context.header('X-Content-Type-Options', 'nosniff');
  });

  app.get('/v1/catalogue', async (context) => {
    const services = routeServices(context, injected);
    const limit = parseLimit(context.req.query('limit'), services);
    const cursor = parseCursor(context.req.query('cursor'));
    if (limit === undefined || cursor === undefined) return context.json({ error: 'invalid-query' }, 400);

    const page = await services.catalogue.listWorksAfter(cursor, limit + 1);
    const items = page.slice(0, limit);
    const lastItem = items.at(-1);
    return context.json({
      items,
      nextCursor: page.length > limit && lastItem ? encodeCursor(lastItem) : null,
    });
  });

  app.get('/v1/catalogue/resolve', async (context) => {
    const provider = context.req.query('provider');
    const externalId = context.req.query('externalId');
    if (!provider || !providerPattern.test(provider) || !externalId || !validPublicId(externalId)) {
      return context.json({ error: 'invalid-query' }, 400);
    }
    const work = await routeServices(context, injected).catalogue.resolveReference(provider, externalId);
    return work ? context.json({ work }) : context.json({ error: 'not-found' }, 404);
  });

  app.get('/v1/catalogue/favorites/resolve', async (context) => {
    const key = favoriteCollectiveKeySchema.safeParse({
      fingerprint: context.req.query('fingerprint'), mediaKind: context.req.query('mediaKind'),
      parserVersion: context.req.query('parserVersion'), siteRulesVersion: context.req.query('siteRulesVersion'),
    });
    if (!key.success) return context.json({ error: 'invalid-query' }, 400);
    const identity = await routeServices(context, injected).catalogue.findFavoriteIdentity(key.data);
    return identity === undefined ? context.json({ error: 'not-found' }, 404) : context.json({ identity: favoritePublicCacheEntrySchema.parse(identity) });
  });

  app.post('/v1/catalogue/favorites/resolve-batch', bodyLimit({ maxSize: 65536, onError: (context) => context.json({ error: 'body-too-large' }, 413) }), async (context) => {
    const request = favoritePublicCacheBatchRequestSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!request.success) return context.json({ error: 'invalid-query' }, 400);
    const results = await routeServices(context, injected).catalogue.findFavoriteIdentities(request.data.keys);
    return context.json(favoritePublicCacheBatchResponseSchema.parse({ results }));
  });

  app.get('/v1/catalogue/search', async (context) => {
    const services = routeServices(context, injected);
    const title = parseTitle(context.req.query('title'));
    const limit = parseLimit(context.req.query('limit'), services);
    if (title === undefined || limit === undefined) return context.json({ error: 'invalid-query' }, 400);
    const items = await services.catalogue.searchWorksByTitle(title, limit);
    return context.json({ items });
  });

  app.get('/v1/catalogue/works/:workId', async (context) => {
    const workId = context.req.param('workId');
    if (!validPublicId(workId)) return context.json({ error: 'invalid-work-id' }, 400);
    const services = routeServices(context, injected);
    const work = await services.catalogue.findWork(workId);
    if (!work) return context.json({ error: 'not-found' }, 404);

    const [titles, externalReferences] = await Promise.all([
      services.catalogue.listTitles(workId, services.policy.catalogue.maximumRelatedRows),
      services.catalogue.listReferences(workId, services.policy.catalogue.maximumRelatedRows),
    ]);
    return context.json({
      work: {
        ...work,
        externalReferences,
        titles,
      },
    });
  });

  return app;
}
