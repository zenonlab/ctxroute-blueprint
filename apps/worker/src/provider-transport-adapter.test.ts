import { describe, expect, it, vi } from 'vitest';
import { probeFavoriteProvider } from '../../../packages/public-discovery/src/provider-health';
import {
  createProviderTransportAdapter,
  DirectProviderTransportAdapter,
  isAllowedProviderTarget,
  requiresProviderGateway,
  SelectiveGatewayProviderTransportAdapter,
} from './provider-transport-adapter';

const anilist = 'https://graphql.anilist.co';

describe('provider transport adapter gate', () => {
  it.each([
    ['anilist', { data: { __typename: 'Query' } }],
    ['mangaupdates', { total_hits: 0, results: [] }],
    ['mangadex', { result: 'ok', response: 'collection', data: [] }],
    ['kitsu-anime', { data: [{ id: '1', type: 'anime', attributes: { slug: 'fixture' } }] }],
    ['kitsu-manga', { data: [{ id: '1', type: 'manga', attributes: { slug: 'fixture' } }] }],
  ] as const)('allows the actual bounded %s recovery probe through transport', async (provider, payload) => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const transport = createProviderTransportAdapter({}, { fetcher });
    await probeFavoriteProvider(provider, (url, init) => transport.fetch(url, init));
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ['anime?include=mappings&fields[mappings]=externalSite,externalId', true],
    ['anime/46474?include=mappings&fields[mappings]=externalSite,externalId', true],
    ['anime?include=characters&fields[mappings]=externalSite,externalId', false],
    ['anime?include=mappings&include=characters&fields[mappings]=externalSite,externalId', false],
    ['anime?include=mappings&fields[mappings]=item', false],
    ['anime?fields[mappings]=externalSite,externalId', false],
    ['manga?include=mappings&fields[mappings]=externalSite,externalId', false],
  ])('bounds Kitsu mapping parameters: %s', (path, allowed) => {
    expect(isAllowedProviderTarget(`https://kitsu.io/api/edge/${path}`, 'GET')).toBe(allowed);
  });

  it.each([
    'limit=2&ids[]=00000000-0000-4000-8000-000000000000',
    'limit=1&ids[]=12345678-1234-4234-8234-123456789abc',
    'limit=1&ids[]=00000000-0000-4000-8000-000000000000&title=private',
    'limit=1&ids[]=00000000-0000-4000-8000-000000000000&ids[]=00000000-0000-4000-8000-000000000000',
  ])('does not widen MangaDex ID access for %s', query => {
    expect(isAllowedProviderTarget(`https://api.mangadex.org/manga?${query}`, 'GET')).toBe(false);
  });

  it('selects the isolated direct adapter by default', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => { requestInit = init; return Response.json({ ok: true }); });
    const transport = createProviderTransportAdapter({}, { fetcher });
    expect(transport).toBeInstanceOf(DirectProviderTransportAdapter);

    await transport.fetch(anilist, { body: '{}', method: 'POST' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(anilist, expect.objectContaining({ cache: 'no-store', redirect: 'manual' }));
    expect(new Headers(requestInit?.headers).get('User-Agent')).toBe('TobiRink/1.0 (+https://tobirink.com)');
  });

  it('refuses arbitrary direct targets before network access', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const transport = createProviderTransportAdapter({ PROVIDER_TRANSPORT_MODE: 'direct' }, { fetcher });
    await expect(transport.fetch('https://example.com/internal', { method: 'GET' })).rejects.toThrow('provider-transport-target');
    expect(fetcher).not.toHaveBeenCalled();
    expect(isAllowedProviderTarget('https://api.mangaupdates.com/v1/series/123', 'GET')).toBe(true);
  });

  it('selects a signed HTTPS gateway without changing the caller contract', async () => {
    let requestUrl = '';
    let requestInit: RequestInit | undefined;
    const fetcher = vi.fn(async (input: string, init: RequestInit) => {
      requestUrl = input;
      requestInit = init;
      return Response.json({ ok: true });
    });
    const transport = createProviderTransportAdapter({
      PROVIDER_GATEWAY_HMAC_KEY: '0123456789abcdef0123456789abcdef',
      PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example',
      PROVIDER_TRANSPORT_MODE: 'gateway',
    }, { fetcher, nonce: () => '123e4567-e89b-42d3-a456-426614174000', now: () => Date.parse('2026-09-15T12:00:00.000Z') });

    await transport.fetch(anilist, { body: '{"query":"query"}', method: 'POST' });
    expect(requestUrl).toBe('https://gateway.example/v1/provider-fetch');
    expect(new Headers(requestInit?.headers).get('X-Tobirink-Gateway-Signature')).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      body: '{"query":"query"}', issuedAt: '2026-09-15T12:00:00.000Z', method: 'POST',
      nonce: '123e4567-e89b-42d3-a456-426614174000', target: anilist, version: 1,
    });
  });

  it('generates a nonce with the bound Worker crypto implementation', async () => {
    let requestBody = '';
    const transport = createProviderTransportAdapter({
      PROVIDER_GATEWAY_HMAC_KEY: '0123456789abcdef0123456789abcdef',
      PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example',
      PROVIDER_TRANSPORT_MODE: 'gateway',
    }, {
      fetcher: async (_input, init) => {
        requestBody = String(init.body);
        return Response.json({ ok: true });
      },
      now: () => Date.parse('2026-09-15T12:00:00.000Z'),
    });

    await transport.fetch(anilist, { body: '{}', method: 'POST' });
    expect(JSON.parse(requestBody).nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('routes only blocked provider endpoints through the signed gateway', async () => {
    const calls: string[] = [];
    const transport = createProviderTransportAdapter({
      PROVIDER_GATEWAY_HMAC_KEY: '0123456789abcdef0123456789abcdef',
      PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example',
      PROVIDER_TRANSPORT_MODE: 'selective-gateway',
    }, {
      fetcher: async (input) => { calls.push(input); return Response.json({ ok: true }); },
      nonce: () => '123e4567-e89b-42d3-a456-426614174000',
      now: () => Date.parse('2026-09-15T12:00:00.000Z'),
    });
    expect(transport).toBeInstanceOf(SelectiveGatewayProviderTransportAdapter);

    await transport.fetch(anilist, { body: '{}', method: 'POST' });
    await transport.fetch('https://api.mangaupdates.com/v1/series/search', { body: '{}', method: 'POST' });
    await transport.fetch('https://api.mangaupdates.com/v1/series/123', { method: 'GET' });
    await transport.fetch('https://api.mangaupdates.com/v1/releases/search', { body: '{}', method: 'POST' });
    await transport.fetch('https://api.mangadex.org/manga?title=Naruto&limit=1', { method: 'GET' });
    await transport.fetch('https://kitsu.io/api/edge/anime?filter%5Btext%5D=Naruto&page%5Blimit%5D=1', { method: 'GET' });

    expect(calls).toEqual([
      'https://gateway.example/v1/provider-fetch',
      'https://gateway.example/v1/provider-fetch',
      'https://gateway.example/v1/provider-fetch',
      'https://gateway.example/v1/provider-fetch',
      'https://api.mangadex.org/manga?title=Naruto&limit=1',
      'https://kitsu.io/api/edge/anime?filter%5Btext%5D=Naruto&page%5Blimit%5D=1',
    ]);
    expect(requiresProviderGateway('https://api.mangaupdates.com/v1/releases/search', 'POST')).toBe(true);
  });

  it('sets the product User-Agent on direct manga providers', async () => {
    const requests: RequestInit[] = [];
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => { requests.push(init); return Response.json({ ok: true }); });
    const transport = createProviderTransportAdapter({ PROVIDER_TRANSPORT_MODE: 'direct' }, { fetcher });
    await transport.fetch('https://api.mangadex.org/manga?title=Naruto&limit=1', { method: 'GET' });
    await transport.fetch('https://kitsu.io/api/edge/manga?filter%5Btext%5D=Naruto&page%5Blimit%5D=1', { method: 'GET' });
    for (const request of requests) expect(new Headers(request.headers).get('User-Agent')).toBe('TobiRink/1.0 (+https://tobirink.com)');
  });

  it('rejects redirects explicitly in both transports', async () => {
    const redirect = async () => new Response(null, { headers: { Location: 'https://example.com' }, status: 302 });
    const direct = createProviderTransportAdapter({}, { fetcher: redirect });
    await expect(direct.fetch(anilist, { body: '{}', method: 'POST' })).rejects.toThrow('provider-transport-redirect');

    const gateway = createProviderTransportAdapter({
      PROVIDER_GATEWAY_HMAC_KEY: '0123456789abcdef0123456789abcdef',
      PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example',
      PROVIDER_TRANSPORT_MODE: 'gateway',
    }, { fetcher: redirect, nonce: () => '123e4567-e89b-42d3-a456-426614174000' });
    await expect(gateway.fetch(anilist, { body: '{}', method: 'POST' })).rejects.toThrow('provider-gateway-fetch');
  });

  it.each([
    [{ PROVIDER_TRANSPORT_MODE: 'unknown' }, 'provider-transport-mode'],
    [{ PROVIDER_TRANSPORT_MODE: 'gateway' }, 'provider-gateway-origin-required'],
    [{ PROVIDER_GATEWAY_ORIGIN: 'http://gateway.example', PROVIDER_TRANSPORT_MODE: 'gateway' }, 'provider-gateway-origin'],
    [{ PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example', PROVIDER_TRANSPORT_MODE: 'gateway' }, 'provider-gateway-secret-required'],
    [{ PROVIDER_GATEWAY_ORIGIN: 'https://gateway.example', PROVIDER_TRANSPORT_MODE: 'selective-gateway' }, 'provider-gateway-secret-required'],
  ])('fails closed for invalid gate configuration %#', (bindings, message) => {
    expect(() => createProviderTransportAdapter(bindings)).toThrow(message);
  });
});
