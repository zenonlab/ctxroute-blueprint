import { COVER_CONTENT_TYPES } from '@tobirink/adapters-cloudflare';
import { favoritePublicReferenceSchema } from '@tobirink/application';
import { Hono } from 'hono';
import { cloudPolicy } from '../cloud-policy';
import type { WorkerRuntime, WorkerServices } from '../composition';

const COVER_VARIANTS = cloudPolicy.cover.variants;

type CoverVariantName = keyof typeof COVER_VARIANTS;
type CoverExtension = 'avif' | 'jpg' | 'png' | 'webp';

const CONTENT_TYPE_BY_EXTENSION: Record<CoverExtension, (typeof COVER_CONTENT_TYPES)[number]> = {
  avif: 'image/avif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const HASH_PATTERN = /^[a-f0-9]{64}$/;
interface ErrorBody { error: string }

function noStoreJson(context: { header(name: string, value: string): void; json(body: ErrorBody, status: 400 | 404): Response }, error: string, status: 400 | 404): Response {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  return context.json({ error }, status);
}

function outputFormat(accept: string, source: (typeof COVER_CONTENT_TYPES)[number]): (typeof COVER_CONTENT_TYPES)[number] {
  if (accept.includes('image/avif')) return 'image/avif';
  if (accept.includes('image/webp')) return 'image/webp';
  return source;
}

function isVariant(value: string): value is CoverVariantName {
  return Object.hasOwn(COVER_VARIANTS, value);
}

function isExtension(value: string): value is CoverExtension {
  return Object.hasOwn(CONTENT_TYPE_BY_EXTENSION, value);
}

type CoverServices = Pick<WorkerServices, 'coverImages' | 'coverMasters' | 'policy'>;

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: CoverServices): CoverServices {
  return injected ?? context.get('services');
}

export function createCoverMediaApp(injected?: CoverServices): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();

  app.get('/v1/media/provider-covers/:provider/:externalId/:variant', async (context) => {
    if (new URL(context.req.url).search.length > 0) return noStoreJson(context, 'query-parameters-not-supported', 400);
    const reference = favoritePublicReferenceSchema.safeParse({ provider: context.req.param('provider'), externalId: context.req.param('externalId') });
    const variant = context.req.param('variant');
    if (!reference.success || !isVariant(variant)) return noStoreJson(context, 'cover-not-found', 404);
    const master = await routeServices(context, injected).coverMasters.findMaster?.(reference.data);
    if (master === undefined || !HASH_PATTERN.test(master.digest) || !isExtension(master.extension)) return noStoreJson(context, 'cover-not-found', 404);
    context.header('Cache-Control', 'public, max-age=300');
    context.header('X-Content-Type-Options', 'nosniff');
    return context.redirect(`/v1/media/covers/${master.digest}/${master.extension}/${variant}`, 302);
  });

  app.get('/v1/media/covers/:digest/:extension/:variant', async (context) => {
    const requestUrl = new URL(context.req.url);
    if (requestUrl.search.length > 0) return noStoreJson(context, 'query-parameters-not-supported', 400);

    const digest = context.req.param('digest');
    const extension = context.req.param('extension');
    const variant = context.req.param('variant');
    if (!HASH_PATTERN.test(digest) || !isExtension(extension) || !isVariant(variant)) {
      return noStoreJson(context, 'cover-not-found', 404);
    }

    const format = outputFormat(context.req.header('Accept') ?? '', CONTENT_TYPE_BY_EXTENSION[extension]);
    const entityTag = `"${digest}-${variant}-${format.slice(6)}"`;
    if (context.req.header('If-None-Match') === entityTag) {
      return new Response(null, {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: entityTag,
          Vary: 'Accept',
        },
        status: 304,
      });
    }

    const services = routeServices(context, injected);
    const masterKey = [services.policy.cover.masterPrefix, `${digest}.${extension}`].join('/');
    const master = await services.coverMasters.readMaster(masterKey);
    if (!master) return noStoreJson(context, 'cover-not-found', 404);

    return services.coverImages.render({
      body: master,
      format,
      headers: {
        'Cache-Control': services.policy.cover.immutableCacheControl,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        ETag: entityTag,
        Vary: 'Accept',
        'X-Content-Type-Options': 'nosniff',
      },
      quality: format === 'image/avif' || format === 'image/webp' ? services.policy.cover.quality : undefined,
      transform: { ...COVER_VARIANTS[variant], fit: 'scale-down' },
    });
  });

  return app;
}

export { COVER_VARIANTS };
