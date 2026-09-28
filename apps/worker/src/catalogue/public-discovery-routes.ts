import type { PublicDiscoveryV3Port } from '@tobirink/adapters-cloudflare';
import {
  publicDiscoveryKeyV3Schema,
  publicDiscoveryLookupSubmissionSchema,
  publicDiscoveryRefreshSubmissionSchema,
  publicDiscoveryResultBatchSchema,
  publicDiscoverySubmissionSchema,
  type PublicDiscoveryKeyV3,
} from '@tobirink/public-discovery';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime, WorkerServices } from '../composition';
import { processPublicDiscoveryQueue, type NativeCollectorSignal } from '../native-collectors';
import { boundedDuration, emitWorkerCostDiagnostic, queueFailureDiagnostic, type WorkerCostDiagnosticEvent, type WorkerCostResult, type WorkerCostTask } from '../diagnostics';
import type { D1MetricTotals, InstrumentedD1 } from '../operational-metrics';
interface DiscoveryQueuePort {
  send(body: NativeCollectorSignal, options?: { contentType?: 'json' }): Promise<QueueSendResponse | void>;
}
type DiscoveryDeliveryMode = 'queue' | 'worker-direct';
type DiscoveryFallbackReport = { claimed: number; continuationScheduled?: boolean; deferred?: number; failed: number; published: number; replayed: number };
type DiscoveryServices = { publicDiscoveryV3?: PublicDiscoveryV3Port; queue?: DiscoveryQueuePort; queueFallback?: (key: PublicDiscoveryKeyV3, correlationId: string) => Promise<DiscoveryFallbackReport | void>; deliveryMode?: DiscoveryDeliveryMode; rateLimiter?: RateLimit; readRateLimiter?: RateLimit; d1Metrics?: Pick<InstrumentedD1, 'snapshot'> };

function routeServices(context: { env: WorkerRuntime['Bindings']; get(key: 'services'): WorkerServices }, injected?: DiscoveryServices): DiscoveryServices {
  if (injected) return injected;
  const services = context.get('services');
  const selected: DiscoveryServices = { d1Metrics: services.d1Metrics, publicDiscoveryV3: services.publicDiscoveryV3 };
  selected.deliveryMode = context.env.DISCOVERY_DELIVERY_MODE === 'worker-direct' ? 'worker-direct' : 'queue';
  if (services.publicDiscoveryQueue) selected.queue = services.publicDiscoveryQueue;
  selected.queueFallback = async (key, correlationId) => {
    const startedAt = Date.now();
    const report = await processPublicDiscoveryQueue(context.env, key, true, correlationId);
    const metrics = report.metrics;
    if (metrics !== undefined) {
      const diagnostic: WorkerCostDiagnosticEvent = {
        acceptedResults: metrics.acceptedResults, d1RowsRead: metrics.rowsRead, d1RowsWritten: metrics.rowsWritten,
        durationMs: boundedDuration(startedAt, Date.now()), pagesRequested: metrics.pagesRequested, provider: metrics.provider,
        provider429s: metrics.provider429s, providerHttpErrors: metrics.providerHttpErrors,
        providerNetworkErrors: metrics.providerNetworkErrors, providerRequests: metrics.providerRequests,
        providerTransportDurationMs: metrics.providerTransportDurationMs, queueFailures: metrics.queueFailures,
        queueSends: metrics.queueSends, result: metrics.result, retries: 0, schemaVersion: 1, task: 'discovery', type: 'worker.cost',
      };
      if (correlationId !== undefined) Object.assign(diagnostic, { correlationId });
      emitWorkerCostDiagnostic(context.env, diagnostic);
    }
    return report;
  };
  if (services.publicDiscoveryRateLimiter) selected.rateLimiter = services.publicDiscoveryRateLimiter;
  if (services.publicDiscoveryReadRateLimiter) selected.readRateLimiter = services.publicDiscoveryReadRateLimiter;
  return selected;
}

function v3Port(services: DiscoveryServices): PublicDiscoveryV3Port {
  if (!services.publicDiscoveryV3) throw new Error('public-discovery-v3-unavailable');
  return services.publicDiscoveryV3;
}

function noStore<TBody>(body: TBody, status = 200): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (status === 429) headers.set('Retry-After', '60');
  return Response.json(body, { headers, status });
}

function retiredV2(): Response {
  return noStore({ error: 'public-discovery-v2-retired' }, 410);
}

type PublicCostCounters = Pick<WorkerCostDiagnosticEvent, 'd1Hits' | 'd1Misses' | 'd1RowsRead' | 'd1RowsWritten' | 'deduplicated' | 'rehydrations'>;
function d1Cost(services: DiscoveryServices, before: D1MetricTotals): Pick<PublicCostCounters, 'd1RowsRead' | 'd1RowsWritten'> {
  const after = services.d1Metrics?.snapshot() ?? before;
  return { d1RowsRead: Math.max(0, after.rowsRead - before.rowsRead), d1RowsWritten: Math.max(0, after.rowsWritten - before.rowsWritten) };
}
function d1Snapshot(services: DiscoveryServices): D1MetricTotals {
  return services.d1Metrics?.snapshot() ?? { rowsRead: 0, rowsWritten: 0 };
}
async function allowRead(services: DiscoveryServices, context: { req: { header(name: string): string | undefined } }): Promise<boolean> {
  const limiter = services.readRateLimiter ?? services.rateLimiter;
  if (!limiter) return true;
  const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
  // Keep read traffic in a separate bucket from admissions and refreshes.
  return (await limiter.limit({ key: `read:${ip}` })).success;
}
function emitPublicCost(bindings: WorkerRuntime['Bindings'] | undefined, services: DiscoveryServices, before: D1MetricTotals, task: WorkerCostTask, result: WorkerCostResult, startedAt: number, counters: Partial<PublicCostCounters> = {}): void {
  emitWorkerCostDiagnostic(bindings, {
    acceptedResults: 0, durationMs: boundedDuration(startedAt, Date.now()), pagesRequested: 0,
    provider: 'none', providerRequests: 0, result, retries: 0, schemaVersion: 1, task, type: 'worker.cost', ...counters, ...d1Cost(services, before),
  });
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function queueFailureCode(error: Error | undefined): string {
  const message = error?.message.toLowerCase() ?? '';
  if (message === 'public-discovery-queue-unavailable') return 'public-discovery-queue-binding-missing';
  if (/429|rate.?limit|too many/u.test(message)) return 'public-discovery-queue-rate-limited';
  if (/forbidden|unauthori[sz]ed|permission|access denied/u.test(message)) return 'public-discovery-queue-forbidden';
  if (/not found|unavailable|disabled|not enabled/u.test(message)) return 'public-discovery-queue-unavailable';
  return 'public-discovery-queue-runtime-failed';
}

function emitQueueHealth(code: string, error?: Error): void {
  console.warn(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code, ...queueFailureDiagnostic(error) }));
}

async function sendDiscoverySignal(services: DiscoveryServices, port: PublicDiscoveryV3Port, key: PublicDiscoveryKeyV3, requestDigest: string, correlationId: string, admissionToken: string, startFallback?: (key: PublicDiscoveryKeyV3) => Promise<void>): Promise<boolean> {
  if (services.deliveryMode === 'worker-direct') {
    await port.releaseQueueSignal(key, requestDigest, new Date().toISOString()).catch(() => undefined);
    if (startFallback) {
      await startFallback(key);
      return true;
    }
    emitQueueHealth('public-discovery-worker-direct-unavailable');
    return false;
  }
  if (!services.queue) {
    emitQueueHealth('public-discovery-queue-binding-missing');
    await port.releaseQueueSignal(key, requestDigest, new Date().toISOString()).catch(() => undefined);
    return false;
  }
  try {
    await services.queue.send({ continuationToken: admissionToken, correlationId, type: 'public-discovery-ready', version: 1 });
  } catch (caught) {
    const error = caught instanceof Error ? caught : undefined;
    emitQueueHealth(queueFailureCode(error), error);
    await port.releaseQueueSignal(key, requestDigest, new Date().toISOString()).catch(() => undefined);
    if (startFallback) {
      await startFallback(key);
      return true;
    }
    return false;
  }
  try { await port.confirmQueueSignal(key, requestDigest, new Date().toISOString()); }
  catch { emitQueueHealth('public-discovery-queue-confirm-failed'); }
  return true;
}

function startQueueFallback(services: DiscoveryServices, correlationId: string): ((key: PublicDiscoveryKeyV3) => Promise<void>) | undefined {
  if (services.queueFallback === undefined) return undefined;
  return async (key) => {
    try {
      const report = await services.queueFallback!(key, correlationId);
      if (report !== undefined) {
        const deferred = report.deferred ?? 0;
        const terminal = report.failed === 0 && deferred === 0 && report.published + report.replayed === 1;
        const continued = report.continuationScheduled === true && report.published + report.replayed === 0
          && report.failed + deferred === 1;
        if (report.claimed !== 1 || !(terminal || continued)) throw new Error('public-discovery-fallback-incomplete');
      }
    }
    catch (error) {
      emitQueueHealth('public-discovery-queue-fallback-failed', error instanceof Error ? error : undefined);
      throw error;
    }
  };
}

export function createPublicDiscoveryApp(injected?: DiscoveryServices, retiredCollectorTestHarness?: () => Promise<void>): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();
  const limitedBody = bodyLimit({ maxSize: 64 * 1024, onError: () => noStore({ error: 'body-too-large' }, 413) });

  app.get('/v3/catalogue/discoveries', async (context) => {
    const startedAt = Date.now();
    const services = routeServices(context, injected);
    if (!(await allowRead(services, context))) return noStore({ error: 'rate-limited' }, 429);
    const before = d1Snapshot(services);
    const key = publicDiscoveryKeyV3Schema.safeParse({
      fingerprint: context.req.query('fingerprint'), mediaKind: context.req.query('mediaKind'),
      parserVersion: context.req.query('parserVersion'), siteRulesVersion: context.req.query('siteRulesVersion'),
    });
    if (!key.success) return noStore({ error: 'invalid-query' }, 400);
    const state = await v3Port(services).read(key.data, new Date().toISOString());
    const miss = state.state === 'MISS' ? 1 : 0;
    emitPublicCost(context.env, services, before, 'discovery-lookup', 'unchanged', startedAt, { d1Hits: 1 - miss, d1Misses: miss });
    return noStore(state);
  });

  app.post('/v3/catalogue/discoveries/lookup', limitedBody, async (context) => {
    const startedAt = Date.now();
    const services = routeServices(context, injected);
    if (!(await allowRead(services, context))) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoveryLookupSubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const before = d1Snapshot(services);
    const port = v3Port(services);
    const now = new Date().toISOString();
    const states = port.readMany === undefined
      ? await Promise.all(parsed.data.keys.map(async (key) => ({ key, state: await port.read(key, now) })))
      : await port.readMany(parsed.data.keys, now);
    const misses = states.filter(({ state }) => state.state === 'MISS').length;
    emitPublicCost(context.env, services, before, 'discovery-lookup', 'unchanged', startedAt, { d1Hits: states.length - misses, d1Misses: misses });
    return noStore(states);
  });

  app.post('/v3/catalogue/discoveries/requests', limitedBody, async (context) => {
    const startedAt = Date.now();
    const services = routeServices(context, injected);
    const before = d1Snapshot(services);
    const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
    if (services.rateLimiter && !(await services.rateLimiter.limit({ key: ip })).success) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoverySubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const requestDigest = await digest(JSON.stringify(parsed.data));
    const port = v3Port(services);
    const now = new Date().toISOString();
    try {
      const admissionToken = randomToken();
      const admission = await port.request({ ...parsed.data, requestDigest }, now, await digest(admissionToken));
      if (admission.outcome === 'saturated') {
        emitPublicCost(context.env, services, before, 'discovery-admission', 'failed', startedAt);
        return noStore({ error: 'discovery-capacity-unavailable' }, 503);
      }
      const correlationId = context.get('requestId') ?? crypto.randomUUID();
      if (admission.outcome === 'created' && !(await sendDiscoverySignal(services, port, parsed.data.key, requestDigest, correlationId, admissionToken, startQueueFallback(services, correlationId)))) {
        emitPublicCost(context.env, services, before, 'discovery-admission', 'backoff', startedAt);
        return noStore({ error: 'discovery-queue-unavailable' }, 503);
      }
      emitPublicCost(context.env, services, before, 'discovery-admission', admission.outcome === 'created' ? 'changed' : 'deduplicated', startedAt, admission.outcome === 'existing' ? { deduplicated: 1 } : {});
      return noStore(admission.state, 202);
    } catch (error) {
      emitPublicCost(context.env, services, before, 'discovery-admission', 'failed', startedAt);
      return error instanceof Error && error.message === 'public-discovery-request-conflict'
        ? noStore({ error: 'request-conflict' }, 409)
        : noStore({ error: 'discovery-unavailable' }, 503);
    }
  });

  app.post('/v3/catalogue/discoveries/refreshes', limitedBody, async (context) => {
    const startedAt = Date.now();
    const services = routeServices(context, injected);
    const before = d1Snapshot(services);
    const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
    if (services.rateLimiter && !(await services.rateLimiter.limit({ key: ip })).success) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoveryRefreshSubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const port = v3Port(services);
    try {
      const admissionToken = randomToken();
      const admission = await port.requestRefresh(parsed.data.key, new Date().toISOString(), await digest(admissionToken));
      const correlationId = context.get('requestId') ?? crypto.randomUUID();
      if (admission.outcome === 'created' && !(await sendDiscoverySignal(services, port, parsed.data.key, admission.requestDigest, correlationId, admissionToken, startQueueFallback(services, correlationId)))) {
        emitPublicCost(context.env, services, before, 'discovery-refresh', 'backoff', startedAt);
        return noStore({ error: 'discovery-queue-unavailable' }, 503);
      }
      emitPublicCost(context.env, services, before, 'discovery-refresh', admission.outcome === 'created' ? 'changed' : 'deduplicated', startedAt, admission.outcome === 'created' ? { rehydrations: 1 } : { deduplicated: 1 });
      return noStore(admission.state, 202);
    } catch {
      emitPublicCost(context.env, services, before, 'discovery-refresh', 'failed', startedAt);
      return noStore({ error: 'refresh-unavailable' }, 409);
    }
  });

  app.post('/v3/catalogue/discoveries/collector/claims', limitedBody, async (context) => {
    if (retiredCollectorTestHarness === undefined) return noStore({ error: 'external-discovery-collector-retired' }, 410);
    await retiredCollectorTestHarness();
    const body: { limit?: unknown } = await context.req.json<{ limit?: unknown }>().catch(() => ({}));
    const limit = body.limit ?? 20;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 50) return noStore({ error: 'invalid-limit' }, 400);
    const claimToken = randomToken();
    const now = new Date();
    return noStore(await v3Port(routeServices(context, injected)).claimBatch({
      claimToken, leaseUntil: new Date(now.getTime() + 15 * 60_000).toISOString(),
      limit: Number(limit), now: now.toISOString(), tokenDigest: await digest(claimToken),
    }));
  });

  app.post('/v3/catalogue/discoveries/results', limitedBody, async (context) => {
    if (retiredCollectorTestHarness === undefined) return noStore({ error: 'external-discovery-collector-retired' }, 410);
    await retiredCollectorTestHarness();
    const parsed = publicDiscoveryResultBatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-result' }, 400);
    if (Math.abs(Date.parse(parsed.data.verifiedAt) - Date.now()) > 2 * 86_400_000) return noStore({ error: 'invalid-verification-time' }, 400);
    try {
      const resultDigest = await digest(JSON.stringify(parsed.data.results));
      return noStore(await v3Port(routeServices(context, injected)).publishBatch(
        parsed.data, await digest(parsed.data.claimToken), resultDigest, new Date().toISOString(),
      ), 201);
    } catch {
      return noStore({ error: 'result-conflict' }, 409);
    }
  });

  app.all('/v2/catalogue/discoveries', retiredV2);
  app.all('/v2/catalogue/discoveries/*', retiredV2);

  return app;
}
