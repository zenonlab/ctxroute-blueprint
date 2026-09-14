import {
  publicDiscoveryClaimSchema,
  publicDiscoveryKeySchema,
  publicDiscoveryPromotionBatchSchema,
  publicDiscoveryProposalSchema,
  type PublicDiscoveryPort,
} from '@tobirink/application';
import type { PublicDiscoveryV2Port } from '@tobirink/adapters-cloudflare';
import {
  publicDiscoveryKeyV2Schema,
  publicDiscoveryResultBatchSchema,
  publicDiscoverySubmissionSchema,
} from '@tobirink/public-discovery';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { WorkerRuntime, WorkerServices } from '../composition';
import { verifyGitHubAgendaToken } from '../releases/github-oidc';

type VerifyCollectorToken = (token: string, audience: string) => Promise<void>;
type DiscoveryServices = { publicDiscovery: PublicDiscoveryPort; publicDiscoveryV2?: PublicDiscoveryV2Port; rateLimiter?: RateLimit };

function routeServices(context: { get(key: 'services'): WorkerServices }, injected?: DiscoveryServices): DiscoveryServices {
  if (injected) return injected;
  const services = context.get('services');
  return services.publicDiscoveryRateLimiter
    ? { publicDiscovery: services.publicDiscovery, publicDiscoveryV2: services.publicDiscoveryV2, rateLimiter: services.publicDiscoveryRateLimiter }
    : { publicDiscovery: services.publicDiscovery, publicDiscoveryV2: services.publicDiscoveryV2 };
}

function v2Port(services: DiscoveryServices): PublicDiscoveryV2Port {
  if (!services.publicDiscoveryV2) throw new Error('public-discovery-v2-unavailable');
  return services.publicDiscoveryV2;
}

function noStore<TBody>(body: TBody, status = 200): Response {
  return Response.json(body, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, status });
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
    const key = publicDiscoveryKeyV2Schema.safeParse({
      fingerprint: context.req.query('fingerprint'), mediaKind: context.req.query('mediaKind'),
      parserVersion: context.req.query('parserVersion'), siteRulesVersion: context.req.query('siteRulesVersion'),
    });
    if (!key.success) return noStore({ error: 'invalid-query' }, 400);
    return noStore(await v2Port(routeServices(context, injected)).read(key.data, new Date().toISOString()));
  });

  app.post('/v3/catalogue/discoveries/requests', limitedBody, async (context) => {
    const services = routeServices(context, injected);
    const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
    if (services.rateLimiter && !(await services.rateLimiter.limit({ key: ip })).success) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoverySubmissionSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-request' }, 400);
    const requestDigest = await digest(JSON.stringify(parsed.data));
    try {
      return noStore(await v2Port(services).request({ ...parsed.data, requestDigest }, new Date().toISOString()), 202);
    } catch {
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
    return noStore(await v2Port(routeServices(context, injected)).claimBatch({
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
      return noStore(await v2Port(routeServices(context, injected)).publishBatch(parsed.data, await digest(parsed.data.claimToken), resultDigest), 201);
    } catch {
      return noStore({ error: 'result-conflict' }, 409);
    }
  });

  app.get('/v2/catalogue/discoveries', async (context) => {
    const key = publicDiscoveryKeySchema.safeParse({
      fingerprint: context.req.query('fingerprint'), mediaKind: context.req.query('mediaKind'),
      parserVersion: context.req.query('parserVersion'), siteRulesVersion: context.req.query('siteRulesVersion'),
    });
    if (!key.success) return noStore({ error: 'invalid-query' }, 400);
    return noStore(await routeServices(context, injected).publicDiscovery.read(key.data, new Date().toISOString()));
  });

  app.post('/v2/catalogue/discoveries/claims', limitedBody, async (context) => {
    const services = routeServices(context, injected);
    const ip = context.req.header('CF-Connecting-IP') ?? 'unknown';
    if (services.rateLimiter && !(await services.rateLimiter.limit({ key: ip })).success) return noStore({ error: 'rate-limited' }, 429);
    const parsed = publicDiscoveryClaimSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-claim' }, 400);
    const token = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
    const result = await services.publicDiscovery.claim(parsed.data.key, { expiresAt, tokenDigest: await digest(token) }, now.toISOString());
    if (result.state === 'PENDING' && result.leaseGranted) return noStore({ expiresAt, leaseToken: token, state: 'LEASED' }, 201);
    return noStore(result);
  });

  app.post('/v2/catalogue/discoveries/proposals', limitedBody, async (context) => {
    const parsed = publicDiscoveryProposalSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-proposal' }, 400);
    const references = [...parsed.data.references].sort((left, right) => `${left.provider}:${left.externalId}`.localeCompare(`${right.provider}:${right.externalId}`));
    const proposalDigest = await digest(JSON.stringify({ key: parsed.data.key, references, schemaVersion: 1 }));
    const accepted = await routeServices(context, injected).publicDiscovery.propose({ ...parsed.data, references }, await digest(parsed.data.leaseToken), proposalDigest, new Date().toISOString());
    return accepted ? noStore({ proposalDigest, state: 'PENDING' }, 202) : noStore({ error: 'stale-or-invalid-lease' }, 409);
  });

  app.get('/v2/catalogue/discoveries/pending', async (context) => {
    const audience = `${new URL(context.req.url).origin}/v2/catalogue/discoveries/pending`;
    if (!await authorize(context.req, audience, verifyToken)) return noStore({ error: 'discovery-ingestion-unauthorized' }, 401);
    const limit = Number(context.req.query('limit') ?? '50');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return noStore({ error: 'invalid-limit' }, 400);
    return noStore({ claims: await routeServices(context, injected).publicDiscovery.listPending(limit) });
  });

  app.post('/v2/catalogue/discoveries/promotions', limitedBody, async (context) => {
    const audience = `${new URL(context.req.url).origin}/v2/catalogue/discoveries/promotions`;
    if (!await authorize(context.req, audience, verifyToken)) return noStore({ error: 'discovery-ingestion-unauthorized' }, 401);
    const parsed = publicDiscoveryPromotionBatchSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) return noStore({ error: 'invalid-promotion' }, 400);
    const now = Date.now();
    if (parsed.data.promotions.some((promotion) => Math.abs(Date.parse(promotion.verifiedAt) - now) > 2 * 86_400_000)) return noStore({ error: 'invalid-verification-time' }, 400);
    try { return noStore(await routeServices(context, injected).publicDiscovery.promote(parsed.data.promotions), 201); }
    catch { return noStore({ error: 'promotion-conflict' }, 409); }
  });

  return app;
}
