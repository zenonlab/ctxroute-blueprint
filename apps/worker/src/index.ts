import { createCatalogueApp } from './catalogue/catalogue-routes';
import { createCoverMediaApp } from './media/cover-routes';
import { createPublicReleaseApp } from './releases/public-release-routes';
import { createCollectiveReviewApp } from './reviews/collective-routes';
import { createFavoriteCollectiveApp } from './reviews/favorite-collective-routes';
import { createWorkerServices, type WorkerRuntime } from './composition';
import { boundedDuration, classifyWorkerRoute, emitWorkerDiagnostic, workerMethod } from './diagnostics';
import { Hono } from 'hono';

const app = new Hono<WorkerRuntime>();
const publicSiteRoutes = new Set(['/', '/library', '/agenda', '/privacy', '/download']);

export function isPublicSiteRoute(pathname: string): boolean {
  return publicSiteRoutes.has(pathname) || (pathname.startsWith('/library/') && pathname.split('/').filter(Boolean).length === 2);
}
app.use('*', async (context, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const routeFamily = classifyWorkerRoute(new URL(context.req.url).pathname);
  context.set('requestId', requestId);
  context.set('services', createWorkerServices(context.env));
  try {
    await next();
  } finally {
    context.header('X-Tobirink-Request-Id', requestId);
    emitWorkerDiagnostic(context.env, {
      durationMs: boundedDuration(startedAt, Date.now()),
      method: workerMethod(context.req.method),
      requestId,
      routeFamily,
      schemaVersion: 1,
      status: context.res.status,
      type: 'worker.request',
    });
  }
});
app.route('/', createCatalogueApp());
app.route('/', createCollectiveReviewApp());
app.route('/', createFavoriteCollectiveApp());
app.route('/', createCoverMediaApp());
app.route('/', createPublicReleaseApp());
app.notFound((context) => {
  if (context.req.method === 'GET' && isPublicSiteRoute(new URL(context.req.url).pathname)) return context.env.ASSETS.fetch(context.req.raw);
  return context.json({ error: 'not-found' }, 404);
});
app.onError((_error, context) => {
  emitWorkerDiagnostic(context.env, {
    durationMs: 0,
    method: workerMethod(context.req.method),
    requestId: context.get('requestId'),
    routeFamily: classifyWorkerRoute(new URL(context.req.url).pathname),
    schemaVersion: 1,
    status: 500,
    type: 'worker.error',
  });
  context.header('Cache-Control', 'no-store');
  context.header('X-Content-Type-Options', 'nosniff');
  return context.json({ error: 'internal-error' }, 500);
});

export const scheduled = async (_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> => {
  const now = new Date();
  const from = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 15 * 86_400_000).toISOString().slice(0, 10);
  const result = await createWorkerServices(env).releaseCalendar.sync({ from, to });
  if (result.failures.length > 0) {
    emitWorkerDiagnostic(env, { durationMs: result.count, method: 'OTHER', requestId: crypto.randomUUID(), routeFamily: 'release', schemaVersion: 1, status: 503, type: 'worker.error' });
    // A provider outage is a lane failure, not a failed calendar run. The
    // adapter has already preserved the last valid rows; throwing here makes
    // Cloudflare report the whole cron as failed and hides those rows from
    // clients until the next invocation.
    console.warn(JSON.stringify({ event: 'agenda_sync_lane_failed', failures: result.failures }));
  }
};

export default { fetch: app.fetch, scheduled };
