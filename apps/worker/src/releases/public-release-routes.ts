import { parsePublicReleaseSnapshot } from '@tobirink/adapters-cloudflare';
import { Hono } from 'hono';
import type { WorkerRuntime, WorkerServices } from '../composition';

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

type ReleaseServices = Pick<WorkerServices, 'policy' | 'releases'>;

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: ReleaseServices): ReleaseServices {
  return injected ?? context.get('services');
}

export function createPublicReleaseApp(injected?: ReleaseServices): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();

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
    if ((from && !/^\d{4}-\d{2}-\d{2}$/u.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/u.test(to)) || (from && to && from > to)) return noStoreJson(context, 'invalid-window', 400);
    try {
      const services = routeServices(context, injected);
      const pointer = await services.releases.readPointer(services.policy.releases.currentKey);
      if (!pointer) return noStoreJson(context, 'release-snapshot-unavailable', 503);
      const entityTag = `"releases-${pointer.revision}-${from ?? ''}-${to ?? ''}"`;
      if (context.req.header('If-None-Match') === entityTag) return new Response(null, { status: 304, headers: { ETag: entityTag, 'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600' } });
      const stored = await services.releases.readSnapshot([services.policy.releases.snapshotPrefix, `${pointer.revision}.json`].join('/'));
      if (!stored || stored.revision !== pointer.revision) return noStoreJson(context, 'release-snapshot-unavailable', 503);
      const filtered = parsePublicReleaseSnapshot({ ...stored, entries: [...stored.entries] }).entries.filter((entry) => (!from || entry.occursAt.slice(0, 10) >= from) && (!to || entry.occursAt.slice(0, 10) <= to));
      const start = url.searchParams.get('cursor') ? Math.max(0, filtered.findIndex((entry) => entry.releaseId === url.searchParams.get('cursor')) + 1) : 0;
      const entries = filtered.slice(start, start + limit); const nextCursor = entries.length === limit ? entries.at(-1)?.releaseId : undefined;
      context.header('Cache-Control', services.policy.http.publicReadCacheControl); context.header('ETag', entityTag); context.header('X-Content-Type-Options', 'nosniff');
      return context.json({ entries, generatedAt: stored.generatedAt, revision: stored.revision, nextCursor });
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
