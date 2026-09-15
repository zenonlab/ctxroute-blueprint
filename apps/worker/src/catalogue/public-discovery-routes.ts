import type { PublicDiscoveryV3Port } from '@tobirink/adapters-cloudflare';
import {
  publicDiscoveryKeyV3Schema,
  publicDiscoveryResultBatchSchema,
  publicDiscoverySubmissionSchema,
} from '@tobirink/public-discovery';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime, WorkerServices } from '../composition';
import type { NativeCollectorSignal } from '../native-collectors';
import { verifyGitHubAgendaToken } from '../releases/github-oidc';

type VerifyCollectorToken = (token: string, audience: string) => Promise<void>;
interface DiscoveryQueuePort {
  send(body: NativeCollectorSignal, options?: { contentType?: 'json' }): Promise<QueueSendResponse | void>;
}
type DiscoveryServices = { publicDiscoveryV3?: PublicDiscoveryV3Port; queue?: DiscoveryQueuePort; rateLimiter?: RateLimit };

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: DiscoveryServices): DiscoveryServices {
  if (injected) return injected;
  const services = context.get('services');
  const selected: DiscoveryServices = { publicDiscoveryV3: services.publicDiscoveryV3 };
  if (services.publicDiscoveryQueue) selected.queue = services.publicDiscoveryQueue;
  if (services.publicDiscoveryRateLimiter) selected.rateLimiter = services.publicDiscoveryRateLimiter;
  return selected;
}

function v3Port(services: DiscoveryServices): PublicDiscoveryV3Port {
  if (!services.publicDiscoveryV3) throw new Error('public-discovery-v3-unavailable');
  return services.publicDiscoveryV3;
}

function noStore<TBody>(body: TBody, status = 200): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status });
}

function retiredV2(): Response {
  return noStore({ error: 'public-discovery-v2-retired' }, 410);
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

function bearer(request: { header(name: string): string | undefined }): string | undefined {
  return /^Bearer ([A-Za-z0-9._-]{32,8192})$/u.exec(request.header('Authorization') ?? '')?.[1];
}

function oidcRejectionCode(message: string | undefined): string {
  return message && /^agenda-oidc-[a-z-]+$/u.test(message) ? message : 'agenda-oidc-invalid';
}

async function authorize(request: { header(name: string): string | undefined }, url: string, verify: VerifyCollectorToken): Promise<boolean> {
  const token = bearer(request);
  if (!token) return false;
  try { await verify(token, url); return true; }
  catch (error) {
    console.warn('discovery-ingestion-authorization-rejected', oidcRejectionCode(error instanceof Error ? error.message : undefined));
    return false;
  }
}

export function createPublicDiscoveryApp(injected?: DiscoveryServices, verifyToken: VerifyCollectorToken = verifyGitHubAgendaToken): Hono<WorkerRuntime> {
  const app = new Hono<WorkerRuntime>();
  const limitedBody = bodyLimit({ maxSize: 64 * 1024, onError: () => noStore({ error: 'body-too-large' }, 413) });

  app.get('/v3/catalogue/discoveries', async (context) => {
    const key = publicDiscoveryKeyV3Schema.safeParse({
      fingerprint: context.req.query('fingerprint'), mediaKind: context.req.query('mediaKind'),
      parserVersion: context.req.query('parserVersion'), siteRulesVersion: context.req.query('siteRulesVersion'),
    });
    if (!key.success) return noStore({ error: 'invalid-query' }, 400);
    return noStore(await v3Port(routeServices(context, injected)).read(key.data, new Date().toISOString()));
  });

  app.post('/v3/catalogue/discoveries/requests', limitedBody, async (context) => {
    const services = routeServices(context, injected);
    const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
    if (services.rateLimiter && !(await services.rateLimiter.limit({ key: ip })).success) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoverySubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const requestDigest = await digest(JSON.stringify(parsed.data));
    try {
      const state = await v3Port(services).request({ ...parsed.data, requestDigest }, new Date().toISOString());
      if (state.state === 'PENDING' && services.queue) {
        try { await services.queue.send({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' }); }
        catch { return noStore({ error: 'discovery-queue-unavailable' }, 503); }
      }
      return noStore(state, 202);
    } catch (error) {
      if (error instanceof Error && error.message === 'public-discovery-capacity-unavailable') {
        return noStore({ error: 'discovery-capacity-unavailable' }, 503);
      }
      return noStore({ error: 'request-conflict' }, 409);
    }
  });

  app.post('/v3/catalogue/discoveries/collector/claims', limitedBody, async (context) => {
    const audience = `${new URL(context.req.url).origin}/v3/catalogue/discoveries/collector/claims`;
    if (!await authorize(context.req, audience, verifyToken)) return noStore({ error: 'discovery-ingestion-unauthorized' }, 401);
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
    const audience = `${new URL(context.req.url).origin}/v3/catalogue/discoveries/results`;
    if (!await authorize(context.req, audience, verifyToken)) return noStore({ error: 'discovery-ingestion-unauthorized' }, 401);
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
