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

  return app;
}
