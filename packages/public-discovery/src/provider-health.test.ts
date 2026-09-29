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

  it('preserves a provider Retry-After instead of probing sooner', async () => {
    vi.useFakeTimers({ now: 10_000 });
    try {
      await expect(probeFavoriteProvider('anilist', async () => new Response(null, { status: 429, headers: { 'Retry-After': '1800' } })))
        .rejects.toMatchObject({ retryAt: 1_810_000 });
    } finally { vi.useRealTimers(); }
  });
});
