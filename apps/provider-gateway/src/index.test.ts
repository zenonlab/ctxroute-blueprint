import {
  createProviderGatewayHandler,
  createUnconfiguredGatewayHandler,
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

async function signature(raw: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { hash: 'SHA-256', name: 'HMAC' }, false, ['sign']);
  const value = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gatewayRequest(overrides: Partial<{ body: string | null; issuedAt: string; method: 'GET' | 'POST'; nonce: string; target: string; version: 1 }> = {}): Promise<Request> {
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
    headers: { 'Content-Type': 'application/json', 'X-Tobirink-Gateway-Signature': await signature(raw) },
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
    secret,
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

Deno.test('uses the JSON:API accept header required by Kitsu', async () => {
  let init: RequestInit | undefined;
  const handler = createProviderGatewayHandler({
    fetcher: (_input, requestInit) => {
      init = requestInit;
      return Promise.resolve(Response.json({ data: [] }));
    },
    nonceStore: memoryNonceStore(),
    now: () => now,
    secret,
  });
  const response = await handler(await gatewayRequest({
    body: null,
    method: 'GET',
    target: 'https://kitsu.io/api/edge/anime?filter%5Btext%5D=Naruto&page%5Blimit%5D=1',
  }));
  assert(response.status === 200);
  assert(new Headers(init?.headers).get('accept') === 'application/vnd.api+json');
});

Deno.test('rejects a replay before a second provider call', async () => {
  let calls = 0;
  const handler = createProviderGatewayHandler({
    fetcher: () => { calls += 1; return Promise.resolve(Response.json({ ok: true })); },
    nonceStore: memoryNonceStore(),
    now: () => now,
    secret,
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
    secret,
  });
  const tampered = await gatewayRequest();
  tampered.headers.set('X-Tobirink-Gateway-Signature', '0'.repeat(64));
  assert((await handler(tampered)).status === 401);
  assert((await handler(await gatewayRequest({ issuedAt: '2026-09-15T11:58:59.999Z' }))).status === 400);
  assert((await handler(await gatewayRequest({ target: 'https://example.com/' }))).status === 400);
  assert(!isAllowedProviderTarget('https://graphql.anilist.co/other', 'POST'));
  assert(isAllowedProviderTarget('https://api.mangaupdates.com/v1/releases/search', 'POST'));
});

Deno.test('bounds request and upstream response bodies', async () => {
  const oversized = new Uint8Array(512 * 1024 + 1);
  const handler = createProviderGatewayHandler({
    fetcher: () => Promise.resolve(new Response(oversized, { headers: { 'Content-Type': 'application/json' } })),
    nonceStore: memoryNonceStore(),
    now: () => now,
    secret,
  });
  assert((await handler(await gatewayRequest())).status === 502);
  const largeBody = 'x'.repeat(64 * 1024);
  assert((await handler(await gatewayRequest({ body: largeBody, nonce: '223e4567-e89b-42d3-a456-426614174000' }))).status === 413);
});

Deno.test('exposes only a bounded health endpoint besides the signed route', async () => {
  const handler = createProviderGatewayHandler({ nonceStore: memoryNonceStore(), now: () => now, secret });
  assert((await handler(new Request('https://gateway.example/healthz'))).status === 200);
  assert((await handler(new Request('https://gateway.example/'))).status === 404);
  assert((await handler(new Request('https://gateway.example/v1/provider-fetch?target=https://example.com'))).status === 404);
});

Deno.test('starts closed while Deno provisions the secret and KV binding', async () => {
  const response = await createUnconfiguredGatewayHandler()(
    new Request('https://gateway.example/healthz'),
  );
  assert(response.status === 503);
  assert((await response.json()).error === 'gateway-not-configured');
});
