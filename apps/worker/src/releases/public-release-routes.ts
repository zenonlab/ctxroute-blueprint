import { parsePublicReleaseSnapshot } from '@tobirink/adapters-cloudflare';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime, WorkerServices } from '../composition';
import { verifyGitHubAgendaToken } from './github-oidc';
import type { PublicReleaseCalendarPort, PublicReleaseQuery } from './public-release-calendar';
import { publicReleaseIngestionSchema } from './public-release-ingestion';

interface ReleaseErrorBody { error: string }

function noStoreJson(
  context: { header(name: string, value: string): void; json(body: ReleaseErrorBody, status: 400 | 503): Response },
  error: string,
  status: 400 | 503,
): Response {
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  return context.json({ error }, status);
}

type ReleaseCalendarRoute = Pick<PublicReleaseCalendarPort, 'query'> & Partial<Pick<PublicReleaseCalendarPort, 'ingest'>>;
type ReleaseServices = Pick<WorkerServices, 'policy' | 'releases'> & { releaseCalendar?: ReleaseCalendarRoute };
type VerifyAgendaToken = (token: string, audience: string) => Promise<void>;
const maximumReleaseWindowDays = 40;

function canonicalDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedReleaseWindow(from: string, to: string): boolean {
  if (!canonicalDate(from) || !canonicalDate(to) || from > to) return false;
  return Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`) < maximumReleaseWindowDays * 86_400_000;
}

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: ReleaseServices): ReleaseServices {
  return injected ?? context.get('services');
}

export function createPublicReleaseApp(injected?: ReleaseServices, verifyAgendaToken: VerifyAgendaToken = verifyGitHubAgendaToken): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();

  app.post('/v2/releases/generations', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: () => Response.json({ error: 'body-too-large' }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: 413 }) }), async (context) => {
    const authorization = context.req.header('Authorization') ?? '';
    const match = /^Bearer ([A-Za-z0-9._-]{32,8192})$/u.exec(authorization);
    if (!match?.[1]) return Response.json({ error: 'agenda-ingestion-unauthorized' }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: 401 });
    const url = new URL(context.req.url);
    try {
      await verifyAgendaToken(match[1], `${url.origin}/v2/releases/generations`);
    } catch {
      return Response.json({ error: 'agenda-ingestion-unauthorized' }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: 401 });
    }
    let input;
    try {
      input = publicReleaseIngestionSchema.parse(await context.req.json());
    } catch {
      return Response.json({ error: 'invalid-agenda-generation' }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: 400 });
    }
    const generatedAt = Date.parse(input.generatedAt);
    if (generatedAt > Date.now() + 10 * 60_000 || generatedAt < Date.now() - 2 * 86_400_000) {
      return Response.json({ error: 'invalid-agenda-generation-time' }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: 400 });
    }
    try {
      const calendar = routeServices(context, injected).releaseCalendar;
      if (!calendar?.ingest) return noStoreJson(context, 'release-calendar-unavailable', 503);
      const result = await calendar.ingest(input);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status: result.accepted ? (result.replayed ? 200 : 201) : 202 });
    } catch {
      return noStoreJson(context, 'release-calendar-unavailable', 503);
    }
  });

  app.get('/v1/releases', async (context) => {
    if (new URL(context.req.url).search.length > 0) {
      return noStoreJson(context, 'query-parameters-not-supported', 400);
    }

    try {
      const services = routeServices(context, injected);
      const pointer = await services.releases.readPointer(services.policy.releases.currentKey);
      if (!pointer) return noStoreJson(context, 'release-snapshot-unavailable', 503);
      const entityTag = `"releases-${pointer.revision}"`;
      if (context.req.header('If-None-Match') === entityTag) {
        return new Response(null, {
          headers: {
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
            ETag: entityTag,
          },
          status: 304,
        });
      }

      const snapshotKey = [services.policy.releases.snapshotPrefix, `${pointer.revision}.json`].join('/');
      const storedSnapshot = await services.releases.readSnapshot(snapshotKey);
      if (!storedSnapshot) return noStoreJson(context, 'release-snapshot-unavailable', 503);
      const snapshot = parsePublicReleaseSnapshot({ ...storedSnapshot, entries: [...storedSnapshot.entries] });
      if (snapshot.revision !== pointer.revision) {
        return noStoreJson(context, 'release-snapshot-unavailable', 503);
      }

      context.header('Cache-Control', services.policy.http.publicReadCacheControl);
      context.header('ETag', entityTag);
      context.header('X-Content-Type-Options', 'nosniff');
      return context.json(snapshot);
    } catch {
      return noStoreJson(context, 'release-snapshot-unavailable', 503);
    }
  });

  app.get('/v2/releases', async (context) => {
    const url = new URL(context.req.url);
    const allowed = new Set(['from', 'to', 'cursor', 'limit']);
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) return noStoreJson(context, 'unsupported-query-parameter', 400);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return noStoreJson(context, 'invalid-limit', 400);
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
    if ((from && !canonicalDate(from)) || (to && !canonicalDate(to)) || (from && to && !boundedReleaseWindow(from, to))) return noStoreJson(context, 'invalid-window', 400);
    const cursor = url.searchParams.get('cursor');
    if (cursor && (cursor.length > 256 || cursor.indexOf('|') < 10 || cursor.endsWith('|'))) return noStoreJson(context, 'invalid-cursor', 400);
    try {
      const services = routeServices(context, injected);
      if (!services.releaseCalendar) return noStoreJson(context, 'release-calendar-unavailable', 503);
      const query: PublicReleaseQuery = { limit };
      if (from) query.from = from;
      if (to) query.to = to;
      if (cursor) query.cursor = cursor;
      const page = await services.releaseCalendar.query(query);
      if (!/^[A-Za-z0-9._-]{1,64}$/u.test(page.revision)) return noStoreJson(context, 'release-calendar-unavailable', 503);
      const entityTag = `"releases-${page.revision}-${from ?? ''}-${to ?? ''}"`;
      if (context.req.header('If-None-Match') === entityTag) return new Response(null, { status: 304, headers: { ETag: entityTag, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
      context.header('Cache-Control', services.policy.http.publicReadCacheControl); context.header('ETag', entityTag); context.header('X-Content-Type-Options', 'nosniff');
      const { window: _sourceWindow, ...v2Page } = page;
      return context.json(v2Page);
    } catch { return noStoreJson(context, 'release-snapshot-unavailable', 503); }
  });

  app.get('/v3/releases', async (context) => {
    const url = new URL(context.req.url);
    const allowed = new Set(['from', 'to', 'cursor', 'limit']);
    for (const key of url.searchParams.keys()) if (!allowed.has(key)) return noStoreJson(context, 'unsupported-query-parameter', 400);
    const limit = Number(url.searchParams.get('limit') ?? '100');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return noStoreJson(context, 'invalid-limit', 400);
    const from = url.searchParams.get('from'); const to = url.searchParams.get('to');
    if (!from || !to || !boundedReleaseWindow(from, to)) return noStoreJson(context, 'invalid-window', 400);
    const cursor = url.searchParams.get('cursor');
    if (cursor && (cursor.length > 256 || cursor.indexOf('|') < 10 || cursor.endsWith('|'))) return noStoreJson(context, 'invalid-cursor', 400);
    try {
      const services = routeServices(context, injected);
      if (!services.releaseCalendar) return noStoreJson(context, 'release-calendar-unavailable', 503);
      const query: PublicReleaseQuery = { from, limit, to };
      if (cursor) query.cursor = cursor;
      const page = await services.releaseCalendar.query(query);
      if (!/^[A-Za-z0-9._-]{1,64}$/u.test(page.revision)) return noStoreJson(context, 'release-calendar-unavailable', 503);
      const entityTag = `"releases-v3-${page.revision}-${from}-${to}"`;
      if (context.req.header('If-None-Match') === entityTag) return new Response(null, { status: 304, headers: { ETag: entityTag, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
      context.header('Cache-Control', services.policy.http.publicReadCacheControl); context.header('ETag', entityTag); context.header('X-Content-Type-Options', 'nosniff');
      return context.json(page);
    } catch { return noStoreJson(context, 'release-snapshot-unavailable', 503); }
  });

  app.get('/downloads/:artifact', async (context) => {
    const artifact = context.req.param('artifact');
    if (!/^tobirink-(?:chrome|firefox)-mv3-\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?\.zip$/u.test(artifact)) {
      return noStoreJson(context, 'invalid-release-artifact', 400);
    }
    const object = await routeServices(context, injected).releases.readArtifact(`downloads/${artifact}`);
    if (!object) return noStoreJson(context, 'release-artifact-unavailable', 503);
    return new Response(object.body, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': `attachment; filename="${artifact}"`,
        'Content-Type': object.contentType,
        ETag: object.etag,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  return app;
}
