import { describe, expect, it, vi } from 'vitest';
import { MangaUpdatesFavoriteProviderAdapter, mangaUpdatesApiOrigin } from './mangaupdates-provider-adapter';

const series = { associated: [{ title: 'Synthetic Alias' }], categories: [{ category: 'Fantasy' }], genres: [{ genre: 'Adventure' }], latest_chapter: 84, series_id: 12345, status: 'Complete', title: 'Synthetic Series', type: 'Manhwa', url: 'https://www.mangaupdates.com/series/abc123/synthetic-series', year: 2020 };

describe('MangaUpdatesFavoriteProviderAdapter', () => {
  it('maps search results and exposes truncation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ record: series }], total_hits: 2 }), { headers: { 'content-type': 'application/json' } }));
    const adapter = new MangaUpdatesFavoriteProviderAdapter(fetcher);
    const result = await adapter.search({ limit: 1, provider: 'mangaupdates', titles: ['Synthetic Series'] });
    expect(fetcher).toHaveBeenCalledWith(`${mangaUpdatesApiOrigin}/v1/series/search`, expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ complete: false, provider: 'mangaupdates', truncated: true });
    expect(result.candidates[0]).toMatchObject({ chapterCount: 84, editorialStatus: 'COMPLETED', externalId: '12345', mediaKind: 'MANHWA', metadataVersion: 1, startYear: 2020, titles: ['Synthetic Series', 'Synthetic Alias'] });
  });

  it('hydrates the exact series route and rejects a foreign reference', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(series), { headers: { 'content-type': 'application/json' } }));
    const adapter = new MangaUpdatesFavoriteProviderAdapter(fetcher);
    await expect(adapter.hydrate({ externalId: '12345', provider: 'mangaupdates' })).resolves.toMatchObject({ externalId: '12345' });
    expect(fetcher).toHaveBeenCalledWith(`${mangaUpdatesApiOrigin}/v1/series/12345`, expect.objectContaining({ method: 'GET' }));
    await expect(adapter.hydrate({ externalId: 'abc123', provider: 'mangaupdates' })).rejects.toThrow(/numeric/u);
    await expect(adapter.hydrate({ externalId: '../bad', provider: 'mangaupdates' })).rejects.toThrow();
  });
});
