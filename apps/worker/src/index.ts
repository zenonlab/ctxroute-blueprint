import { createCatalogueApp } from './catalogue/catalogue-routes';
import { createPublicDiscoveryApp } from './catalogue/public-discovery-routes';
import { createCoverMediaApp } from './media/cover-routes';
import { createPublicReleaseApp } from './releases/public-release-routes';
import { createWorkerServices, type WorkerRuntime } from './composition';
import { boundedDuration, classifyWorkerRoute, emitWorkerDiagnostic, workerMethod } from './diagnostics';
import { Hono } from 'hono';
import { enqueueAgendaRefresh, handleNativeCollectorQueue, processAgendaQueue, processPublicDiscoveryQueue, recoverPendingAgenda, type NativeCollectorBindings, type NativeCollectorSignal } from './native-collectors';

const app = new Hono<WorkerRuntime>();
const publicSiteRoutes = new Set(['/', '/library', '/agenda', '/privacy', '/download']);
// Queue delivery performs normal continuation. This is only a bounded daily
// repair for rows whose Queue signal was lost, so it must never become a poll.
export const publicDiscoveryRecoveryCron = '37 3 * * *';

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
app.route('/', createPublicDiscoveryApp());
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

export default {
  fetch: app.fetch,
  queue: async (batch: MessageBatch<NativeCollectorSignal>, env: NativeCollectorBindings) => {
    let recovery: Promise<void> | undefined;
    const recover = () => recovery ??= recoverPendingAgenda(env);
    await handleNativeCollectorQueue(batch.messages, {
      agenda: (scheduledFor) => processAgendaQueue(env, scheduledFor),
      discovery: () => processPublicDiscoveryQueue(env),
      recovery: recover,
      forward: async (signal) => { await env.PUBLIC_DISCOVERY_QUEUE.send(signal, { contentType: 'json', delaySeconds: 1 }); },
    });
    await recover();
  },
  scheduled: (controller: ScheduledController, env: NativeCollectorBindings) => {
    // The weekly Agenda trigger remains unchanged. The separate bounded wake
    // repairs due Discovery rows when a previously sent Queue signal vanished.
    if (controller.cron === publicDiscoveryRecoveryCron) return processPublicDiscoveryQueue(env).then(() => undefined);
    return enqueueAgendaRefresh(controller, env);
  },
};
