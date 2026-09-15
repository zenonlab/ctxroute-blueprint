import { describe, expect, it, vi } from 'vitest';
import { createProviderTransportAdapter, DirectProviderTransportAdapter, isAllowedProviderTarget } from './provider-transport-adapter';

const anilist = 'https://graphql.anilist.co';

describe('provider transport adapter gate', () => {
  it('selects the isolated direct adapter by default', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    const transport = createProviderTransportAdapter({}, { fetcher });
    expect(transport).toBeInstanceOf(DirectProviderTransportAdapter);

    await transport.fetch(anilist, { body: '{}', method: 'POST' });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(anilist, expect.objectContaining({ cache: 'no-store', redirect: 'manual' }));
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
  ])('fails closed for invalid gate configuration %#', (bindings, message) => {
    expect(() => createProviderTransportAdapter(bindings)).toThrow(message);
  });
});
