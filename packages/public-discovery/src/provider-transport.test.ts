import { describe, expect, it, vi } from 'vitest';
import { bindProviderTransport, type ProviderTransportPort } from './provider-transport.js';

describe('provider transport port', () => {
  it('binds the stable port without exposing its implementation to providers', async () => {
    const response = Response.json({ ok: true });
    const port: ProviderTransportPort = { fetch: vi.fn(async () => response) };
    const fetcher = bindProviderTransport(port);

    await expect(fetcher('https://graphql.anilist.co', { body: '{}', method: 'POST' })).resolves.toBe(response);
    expect(port.fetch).toHaveBeenCalledExactlyOnceWith('https://graphql.anilist.co', { body: '{}', method: 'POST' });
  });
});
