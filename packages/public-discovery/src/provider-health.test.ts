import { describe, expect, it, vi } from 'vitest';
import { probeFavoriteProvider } from './provider-health';

describe('shared recovery probes', () => {
  it.each([
    ['anilist', { data: { __typename: 'Query' } }],
    ['mangaupdates', { total_hits: 0, results: [] }],
    ['mangadex', { result: 'ok', response: 'collection', data: [] }],
    ['kitsu-anime', { data: [{ id: '1', type: 'anime', attributes: { slug: 'synthetic' } }] }],
    ['kitsu-manga', { data: [{ id: '1', type: 'manga', attributes: { slug: 'synthetic' } }] }],
  ] as const)('validates one small fixed %s request', async (provider, payload) => {
    const fetcher = vi.fn(async () => Response.json(payload));
    await expect(probeFavoriteProvider(provider, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    { data: { __typename: 'Query' }, errors: [{ message: 'unavailable' }] },
    { data: null },
    { data: { __typename: 'Query' }, padding: 'x'.repeat(8192) },
  ])('rejects invalid or oversized success payloads', async (payload) => {
    await expect(probeFavoriteProvider('anilist', async () => Response.json(payload))).rejects.toThrow();
  });

  it.each(['kitsu-anime', 'kitsu-manga'] as const)('uses the JSON API media type for the %s health probe', async (provider) => {
    const media = provider === 'kitsu-anime' ? 'anime' : 'manga';
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (headers.get('Accept') !== 'application/vnd.api+json') return new Response(null, { status: 406 });
      if (headers.has('Content-Type')) return new Response(null, { status: 415 });
      return Response.json({ data: [{ id: '1', type: media, attributes: { slug: 'synthetic' } }] }, { headers: { 'Content-Type': 'application/vnd.api+json' } });
    });
    await expect(probeFavoriteProvider(provider, fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]![1].method).toBe('GET');
    expect(fetcher.mock.calls[0]![1].body).toBeUndefined();
  });

  it('preserves a provider Retry-After instead of probing sooner', async () => {
    vi.useFakeTimers({ now: 10_000 });
    try {
      await expect(probeFavoriteProvider('anilist', async () => new Response(null, { status: 429, headers: { 'Retry-After': '1800' } })))
        .rejects.toMatchObject({ retryAt: 1_810_000 });
    } finally { vi.useRealTimers(); }
  });
});
