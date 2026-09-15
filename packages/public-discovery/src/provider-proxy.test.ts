import { describe, expect, it, vi } from 'vitest';
import { BoundedProviderProxyNonceStore, createProviderProxyHandler, createSignedProviderProxyFetch, isAllowedProviderTarget } from './provider-proxy';

const secret = 'local-test-key-with-at-least-thirty-two-bytes';
const now = Date.parse('2026-09-15T14:00:00.000Z');
const nonce = '123e4567-e89b-42d3-a456-426614174000';

describe('signed provider proxy', () => {
  it('allows only exact provider routes and methods', () => {
    expect(isAllowedProviderTarget('https://graphql.anilist.co', 'POST')).toBe(true);
    expect(isAllowedProviderTarget('https://api.mangaupdates.com/v1/series/42', 'GET')).toBe(true);
    expect(isAllowedProviderTarget('https://api.mangadex.org/manga?title=Frieren&limit=20&offset=0&includes%5B%5D=cover_art', 'GET')).toBe(true);
    expect(isAllowedProviderTarget('https://kitsu.io/api/edge/anime/42?fields%5Banime%5D=slug', 'GET')).toBe(true);
    expect(isAllowedProviderTarget('https://api.mangadex.org/../../admin', 'GET')).toBe(false);
    expect(isAllowedProviderTarget('https://example.com/?url=https://graphql.anilist.co', 'GET')).toBe(false);
  });

  it('forwards one authenticated bounded request', async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ data: { ok: true } }));
    const handler = createProviderProxyHandler({ fetcher: upstream, now: () => now, secret });
    const proxyFetch = createSignedProviderProxyFetch({ fetcher: (request, init) => handler(new Request(request, init)), nonce: () => nonce, now: () => now, origin: 'https://proxy.example', secret });
    const response = await proxyFetch('https://graphql.anilist.co', { body: '{"query":"test"}', method: 'POST' });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledExactlyOnceWith('https://graphql.anilist.co/', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects tampering, expiry and replay', async () => {
    const handler = createProviderProxyHandler({ fetcher: async () => Response.json({ ok: true }), now: () => now, secret });
    let captured: Request | undefined;
    const proxyFetch = createSignedProviderProxyFetch({ fetcher: async (request, init) => { captured = new Request(request, init); return handler(captured.clone()); }, nonce: () => nonce, now: () => now, origin: 'https://proxy.example', secret });
    expect((await proxyFetch('https://graphql.anilist.co', { body: '{}', method: 'POST' })).status).toBe(200);
    expect((await handler(captured!.clone())).status).toBe(409);
    const body = await captured!.clone().text();
    expect((await handler(new Request(captured!.url, { body: `${body} `, headers: captured!.headers, method: 'POST' }))).status).toBe(401);
    const expired = createSignedProviderProxyFetch({ fetcher: (request, init) => handler(new Request(request, init)), nonce: () => '123e4567-e89b-42d3-a456-426614174001', now: () => now - 120_000, origin: 'https://proxy.example', secret });
    expect((await expired('https://graphql.anilist.co', { body: '{}', method: 'POST' })).status).toBe(401);
  });

  it('bounds nonce memory and rejects oversized upstream responses', async () => {
    const store = new BoundedProviderProxyNonceStore(1, () => now);
    expect(store.consume('one', now + 1_000)).toBe(true); expect(store.consume('two', now + 1_000)).toBe(false); expect(store.consume('one', now + 1_000)).toBe(false);
    const handler = createProviderProxyHandler({ fetcher: async () => new Response('x'.repeat(512 * 1024 + 1)), now: () => now, secret });
    const proxyFetch = createSignedProviderProxyFetch({ fetcher: (request, init) => handler(new Request(request, init)), nonce: () => nonce, now: () => now, origin: 'https://proxy.example', secret });
    expect((await proxyFetch('https://graphql.anilist.co', { body: '{}', method: 'POST' })).status).toBe(502);
  });
});
