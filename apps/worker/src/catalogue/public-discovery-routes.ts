import type { PublicDiscoveryV3Port } from '@tobirink/adapters-cloudflare';
import {
  publicDiscoveryKeyV3Schema,
  publicDiscoveryLookupSubmissionSchema,
  publicDiscoveryRefreshSubmissionSchema,
  publicDiscoveryResultBatchSchema,
  publicDiscoverySubmissionSchema,
} from '@tobirink/public-discovery';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime, WorkerServices } from '../composition';
import type { NativeCollectorSignal } from '../native-collectors';
import { boundedDuration, emitWorkerCostDiagnostic, type WorkerCostDiagnosticEvent, type WorkerCostResult, type WorkerCostTask } from '../diagnostics';
import type { D1MetricTotals, InstrumentedD1 } from '../operational-metrics';
interface DiscoveryQueuePort {
  send(body: NativeCollectorSignal, options?: { contentType?: 'json' }): Promise<QueueSendResponse | void>;
}
type DiscoveryServices = { publicDiscoveryV3?: PublicDiscoveryV3Port; queue?: DiscoveryQueuePort; rateLimiter?: RateLimit; d1Metrics?: Pick<InstrumentedD1, 'snapshot'> };

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: DiscoveryServices): DiscoveryServices {
  if (injected) return injected;
  const services = context.get('services');
  const selected: DiscoveryServices = { d1Metrics: services.d1Metrics, publicDiscoveryV3: services.publicDiscoveryV3 };
  if (services.publicDiscoveryQueue) selected.queue = services.publicDiscoveryQueue;
  if (services.publicDiscoveryRateLimiter) selected.rateLimiter = services.publicDiscoveryRateLimiter;
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

export function createPublicDiscoveryApp(injected?: DiscoveryServices, retiredCollectorTestHarness?: () => Promise<void>): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();
  const limitedBody = bodyLimit({ maxSize: 64 * 1024, onError: () => noStore({ error: 'body-too-large' }, 413) });

  app.get('/v3/catalogue/discoveries', async (context) => {
    const startedAt = Date.now();
    const services = routeServices(context, injected);
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
    const parsed = publicDiscoveryLookupSubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const services = routeServices(context, injected);
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
      const admission = await port.request({ ...parsed.data, requestDigest }, now);
      if (admission.outcome === 'saturated') {
        emitPublicCost(context.env, services, before, 'discovery-admission', 'failed', startedAt);
        return noStore({ error: 'discovery-capacity-unavailable' }, 503);
      }
      if (admission.outcome === 'created' && services.queue) {
        try {
          await services.queue.send({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' });
          await port.confirmQueueSignal(parsed.data.key, requestDigest, new Date().toISOString());
        } catch {
          await port.releaseQueueSignal(parsed.data.key, requestDigest, new Date().toISOString()).catch(() => undefined);
          emitPublicCost(context.env, services, before, 'discovery-admission', 'backoff', startedAt);
          return noStore({ error: 'discovery-queue-unavailable' }, 503);
        }
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
      const admission = await port.requestRefresh(parsed.data.key, new Date().toISOString());
      if (admission.outcome === 'created' && services.queue) {
        try {
          await services.queue.send({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' });
          await port.confirmQueueSignal(parsed.data.key, admission.requestDigest, new Date().toISOString());
        } catch {
          await port.releaseQueueSignal(parsed.data.key, admission.requestDigest, new Date().toISOString()).catch(() => undefined);
          emitPublicCost(context.env, services, before, 'discovery-refresh', 'backoff', startedAt);
          return noStore({ error: 'discovery-queue-unavailable' }, 503);
        }
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
