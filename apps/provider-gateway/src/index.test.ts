import {
  DenoKvNonceStore,
  createProviderGatewayHandler,
  createUnconfiguredGatewayHandler,
  type GatewayRequestMetrics,
  type GatewayNonceStore,
  isAllowedProviderTarget,
} from './index.ts';

const secret = '0123456789abcdef0123456789abcdef';
const now = Date.parse('2026-09-15T12:00:00.000Z');
const nonce = '123e4567-e89b-42d3-a456-426614174000';

function assert(condition: boolean, message = 'assertion failed'): asserts condition {
  if (!condition) throw new Error(message);
}

function memoryNonceStore(): GatewayNonceStore {
  const values = new Set<string>();
  return { claim: (value) => Promise.resolve(!values.has(value) && Boolean(values.add(value))) };
}

async function signature(raw: string, signingSecret = secret): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const value = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gatewayRequest(overrides: Partial<{ body: string | null; issuedAt: string; method: 'GET' | 'POST'; nonce: string; target: string; version: 1 }> = {}, signingSecret = secret): Promise<Request> {
  const raw = JSON.stringify({
    body: '{"query":"query { Media(id: 154587) { id } }"}',
    issuedAt: new Date(now).toISOString(),
    method: 'POST',
    nonce,
    target: 'https://graphql.anilist.co',
    version: 1,
    ...overrides,
  });
  return new Request('https://gateway.example/v1/provider-fetch', {
    body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Tobirink-Gateway-Signature': await signature(raw, signingSecret) },
    method: 'POST',
  });
}

Deno.test('forwards a valid signed AniList request with fixed product headers', async () => {
  let target = '';
  let init: RequestInit | undefined;
  const handler = createProviderGatewayHandler({
    fetcher: (input, requestInit) => {
      target = input;
      init = requestInit;
      return Promise.resolve(Response.json({ data: { Media: { id: 154587 } } }, { headers: { 'X-RateLimit-Remaining': '29' } }));
    },
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  const response = await handler(await gatewayRequest());
  assert(response.status === 200);
  assert(target === 'https://graphql.anilist.co');
  const headers = new Headers(init?.headers);
  assert(headers.get('origin') === 'https://tobirink.com');
  assert(headers.get('referer') === 'https://tobirink.com/');
  assert(headers.get('user-agent') === 'TobiRink/1.0 (+https://tobirink.com)');
  assert(init?.redirect === 'error');
  assert(response.headers.get('x-ratelimit-remaining') === '29');
});

Deno.test('disables gateway metrics with the explicit boolean debug switch', async () => {
  const logs: GatewayRequestMetrics[] = [];
  const handler = createProviderGatewayHandler({
    debug: false,
    fetcher: () => Promise.resolve(Response.json({ ok: true })),
    logger: (entry) => logs.push(entry),
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  assert((await handler(await gatewayRequest({ nonce: '223e4567-e89b-42d3-a456-426614174000' }))).status === 200);
  assert(logs.length === 0);
});

Deno.test('classifies gateway and AniList authentication failures without sensitive metrics', async () => {
  const logs: GatewayRequestMetrics[] = [];
  const handler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(new Response('private upstream body', { status: 401 })),
    logger: (entry) => logs.push(entry),
    nonceStore: memoryNonceStore(),
    now: () => now,
    requestId: () => 'gateway-request-401',
    secrets: [secret],
  });

  const invalid = await gatewayRequest({ nonce: '223e4567-e89b-42d3-a456-426614174000' });
  invalid.headers.set('X-Tobirink-Gateway-Signature', '0'.repeat(64));
  const gatewayResponse = await handler(invalid);
  assert(gatewayResponse.status === 401);
  assert((await gatewayResponse.json()).error === 'invalid-signature');
  assert(logs[0]?.gateway_request_id === 'gateway-request-401');
  assert(logs[0]?.provider === 'unknown');
  assert(logs[0]?.upstream_status === null);
  assert(logs[0]?.auth_failure_layer === 'gateway');
  assert(gatewayResponse.headers.get('x-tobirink-gateway-request-id') === 'gateway-request-401');

  let upstreamLog: GatewayRequestMetrics | undefined;
  const upstreamHandler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(new Response('private upstream body', { status: 401 })),
    logger: (entry) => { upstreamLog = entry; },
    nonceStore: memoryNonceStore(),
    now: () => now,
    requestId: () => 'gateway-request-401',
    secrets: [secret],
  });
  const upstreamResponse = await upstreamHandler(await gatewayRequest({ nonce: '323e4567-e89b-42d3-a456-426614174000' }));
  assert(upstreamResponse.status === 401);
  assert((await upstreamResponse.json()).error === 'anilist-auth-failed');
  assert(upstreamLog !== undefined);
  assert(upstreamLog.provider === 'anilist');
  assert(upstreamLog.upstream_status === 401);
  assert(upstreamLog.status === 401);
  assert(upstreamLog.auth_failure_layer === 'upstream');
  assert(upstreamLog.retries === 0);
  assert(!JSON.stringify(upstreamLog).includes('query'));
  assert(!JSON.stringify(upstreamLog).includes('graphql.anilist.co'));
});

Deno.test('forwards MangaUpdates and rejects direct-only provider targets', async () => {
  let target = '';
  const handler = createProviderGatewayHandler({
    fetcher: (input) => {
      target = input;
      return Promise.resolve(Response.json({ data: [] }));
    },
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  const response = await handler(await gatewayRequest({
    body: '{}',
    target: 'https://api.mangaupdates.com/v1/series/search',
  }));
  assert(response.status === 200);
  assert(target === 'https://api.mangaupdates.com/v1/series/search');
  assert(isAllowedProviderTarget('https://api.mangaupdates.com/v1/releases/search', 'POST'));
  assert(!isAllowedProviderTarget('https://api.mangadex.org/manga?title=Naruto&limit=1', 'GET'));
  assert(!isAllowedProviderTarget('https://kitsu.io/api/edge/anime?filter%5Btext%5D=Naruto&page%5Blimit%5D=1', 'GET'));
});

Deno.test('rejects a replay before a second provider call', async () => {
  let calls = 0;
  const handler = createProviderGatewayHandler({
    fetcher: () => { calls += 1; return Promise.resolve(Response.json({ ok: true })); },
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  assert((await handler(await gatewayRequest())).status === 200);
  assert((await handler(await gatewayRequest())).status === 409);
  assert(calls === 1);
});

Deno.test('rejects tampering, stale envelopes and arbitrary targets', async () => {
  const handler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(Response.json({ ok: true })),
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  const tampered = await gatewayRequest();
  tampered.headers.set('X-Tobirink-Gateway-Signature', '0'.repeat(64));
  assert((await handler(tampered)).status === 401);
  assert((await handler(await gatewayRequest({ issuedAt: '2026-09-15T11:58:59.999Z' }))).status === 400);
  assert((await handler(await gatewayRequest({ target: 'https://example.com/' }))).status === 400);
  assert(!isAllowedProviderTarget('https://graphql.anilist.co/other', 'POST'));
  assert(isAllowedProviderTarget('https://api.mangaupdates.com/v1/series/123', 'GET'));
});

Deno.test('bounds request and upstream response bodies', async () => {
  const oversized = new Uint8Array(512 * 1024 + 1);
  const handler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(new Response(oversized, { headers: { 'Content-Type': 'application/json' } })),
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret],
  });
  assert((await handler(await gatewayRequest())).status === 502);
  const largeBody = 'x'.repeat(64 * 1024);
  assert((await handler(await gatewayRequest({ body: largeBody, nonce: '223e4567-e89b-42d3-a456-426614174000' }))).status === 413);
});

Deno.test('exposes only a bounded health endpoint besides the signed route', async () => {
  const handler = createProviderGatewayHandler({ nonceStore: memoryNonceStore(), now: () => now, secrets: [secret] });
  const health = await handler(new Request('https://gateway.example/healthz'));
  assert(health.status === 200);
  assert((await health.json()).status === 'healthy');
  assert((await handler(new Request('https://gateway.example/'))).status === 404);
  assert((await handler(new Request('https://gateway.example/v1/provider-fetch?target=https://example.com'))).status === 404);
});

Deno.test('accepts one distinct previous key only during a bounded rotation window', async () => {
  const previousSecret = 'abcdef0123456789abcdef0123456789';
  const handler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(Response.json({ ok: true })),
    nonceStore: memoryNonceStore(),
    now: () => now,
    secrets: [secret, previousSecret],
  });
  assert((await handler(await gatewayRequest({}, previousSecret))).status === 200);
  assert((await handler(await gatewayRequest({ nonce: '223e4567-e89b-42d3-a456-426614174000' }))).status === 200);
});

Deno.test('rejects invalid, duplicate and excessive gateway key sets', () => {
  const options = { nonceStore: memoryNonceStore(), now: () => now };
  for (const secrets of [[], ['short'], [secret, secret], [secret, 'abcdef0123456789abcdef0123456789', 'fedcba9876543210fedcba9876543210']]) {
    let rejected = false;
    try { createProviderGatewayHandler({ ...options, secrets }); } catch { rejected = true; }
    assert(rejected);
  }
});

Deno.test('starts closed while Deno provisions the secret and KV binding', async () => {
  const response = await createUnconfiguredGatewayHandler()(
    new Request('https://gateway.example/healthz'),
  );
  assert(response.status === 503);
  assert((await response.json()).error === 'gateway-not-configured');
});

Deno.test('serves health before lazy KV initialization and fails signed traffic closed', async () => {
  const handler = createProviderGatewayHandler({
    nonceStore: new DenoKvNonceStore(Promise.resolve(undefined)),
    now: () => now,
    secrets: [secret],
  });
  const health = await handler(new Request('https://gateway.example/healthz'));
  assert(health.status === 200);
  assert((await health.json()).status === 'healthy');

  const signed = await handler(await gatewayRequest());
  assert(signed.status === 503);
  assert((await signed.json()).error === 'gateway-not-configured');
});
