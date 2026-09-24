import { describe, expect, it, vi } from 'vitest';
import { MangaUpdatesFavoriteProviderAdapter, mangaUpdatesApiOrigin } from './mangaupdates';

const series = { associated: [{ title: 'Synthetic Alias' }], categories: [{ category: 'Fantasy' }], genres: [{ genre: 'Adventure' }], image: { url: { original: 'https://cdn.mangaupdates.com/image/i1.jpg', thumb: 'https://cdn.mangaupdates.com/image/i1-thumb.jpg' } }, latest_chapter: 84, series_id: 12345, status: 'Complete', title: 'Synthetic Series', type: 'Manhwa', url: 'https://www.mangaupdates.com/series/abc123/synthetic-series', year: 2020 };

describe('MangaUpdatesFavoriteProviderAdapter', () => {
  it('retains an exact ID even when the title differs from the source slug', async () => {
    const adapter = new MangaUpdatesFavoriteProviderAdapter(async () => Response.json({ results: [{ record: series }], total_hits: 1 }));
    const result = await adapter.search({ limit: 20, provider: 'mangaupdates', titles: ['Unrelated Source Slug'], explicitProviderReference: { provider: 'mangaupdates', externalId: '12345' } });
    expect(result.candidates.map(value => value.externalId)).toEqual(['12345']);
  });
  it('preserves comparable identities when a provider record has null cover URLs', async () => {
    const withoutCover = { ...series, image: { url: { original: null, thumb: null } } };
    const fetcher = vi.fn(async () => Response.json({ results: [{ record: withoutCover }, { record: { ...series, series_id: 67890, title: 'Unrelated Journey' } }], total_hits: 2 }));
    const result = await new MangaUpdatesFavoriteProviderAdapter(fetcher).search({ limit: 20, provider: 'mangaupdates', titles: ['Synthetic Series'] });
    expect(result).toMatchObject({ complete: true, candidates: [{ externalId: '12345' }] });
    expect(result.candidates[0]).not.toHaveProperty('cover');
  });

  it('keeps exact evidence but marks pages with unprojectable long titles incomplete', async () => {
    const overlong = { ...series, series_id: 67890, title: 'A'.repeat(201), associated: [] };
    const adapter = new MangaUpdatesFavoriteProviderAdapter(async () => Response.json({ results: [{ record: overlong }, { record: series }], total_hits: 2 }));
    const result = await adapter.search({ limit: 20, provider: 'mangaupdates', titles: ['Synthetic Series'] });
    expect(result).toMatchObject({ complete: false, truncated: true, candidates: [{ externalId: '12345' }] });
    expect(result).not.toHaveProperty('nextCursor');
    const unmatched = new MangaUpdatesFavoriteProviderAdapter(async () => Response.json({ results: [{ record: overlong }], total_hits: 1 }));
    await expect(unmatched.search({ limit: 20, provider: 'mangaupdates', titles: ['Synthetic Series'] })).resolves.toMatchObject({ candidates: [], complete: false, truncated: true });
  });

  it('does not claim completeness after omitting a late alias', async () => {
    const manyAliases = { ...series, associated: Array.from({ length: 33 }, (_value, index) => ({ title: `Alias ${index}` })) };
    const adapter = new MangaUpdatesFavoriteProviderAdapter(async () => Response.json({ results: [{ record: manyAliases }], total_hits: 1 }));
    await expect(adapter.search({ limit: 20, provider: 'mangaupdates', titles: ['Missing'] })).resolves.toMatchObject({ complete: false, truncated: true });
  });

  it('uses a bounded alternate title for an exact long-title identity', async () => {
    const longSeries = { ...series, title: 'A'.repeat(201), associated: [{ title: 'Synthetic Series' }] };
    const adapter = new MangaUpdatesFavoriteProviderAdapter(async () => Response.json(longSeries));
    await expect(adapter.hydrate({ externalId: '12345', provider: 'mangaupdates' })).resolves.toMatchObject({ displayTitle: 'Synthetic Series', titles: ['Synthetic Series'] });
  });

  it('accepts the nullable optional fields returned by the live MangaUpdates API', async () => {
    const liveRecord = {
      ...series,
      associated: null,
      categories: null,
      image: null,
      status: null,
      title: 'One Piece',
      type: 'Manga',
      url: null,
      year: '1997',
    };
    const fetcher = vi.fn(async () => Response.json({ results: [{ record: liveRecord }], total_hits: 1 }));
    const result = await new MangaUpdatesFavoriteProviderAdapter(fetcher).search({ limit: 20, provider: 'mangaupdates', titles: ['One Piece'] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ displayTitle: 'One Piece', externalId: '12345', mediaKind: 'MANGA', startYear: 1997, titles: ['One Piece'] });
    expect(result.candidates[0]).not.toHaveProperty('cover');
    expect(result.candidates[0]).not.toHaveProperty('editorialStatus');
  });

  it('accepts the larger category and alias collections returned by detail hydration', async () => {
    const detail = {
      ...series,
      associated: Array.from({ length: 19 }, (_, index) => ({ title: `Alias ${index}` })),
      categories: Array.from({ length: 344 }, (_, index) => ({ category: `Category ${index}` })),
    };
    const fetcher = vi.fn(async () => Response.json(detail));
    const hydrated = await new MangaUpdatesFavoriteProviderAdapter(fetcher).hydrate({ provider: 'mangaupdates', externalId: '12345' });
    expect(hydrated).toMatchObject({ externalId: '12345', displayTitle: 'Synthetic Series' });
    expect(hydrated?.titles).toHaveLength(20);
    expect(hydrated?.categories).toHaveLength(32);
  });

  it('maps search results and exposes truncation', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      requestInit = init;
      return new Response(JSON.stringify({ results: [{ record: series }], total_hits: 26 }), { headers: { 'content-type': 'application/json' } });
    });
    const adapter = new MangaUpdatesFavoriteProviderAdapter(fetcher);
    const result = await adapter.search({ limit: 1, provider: 'mangaupdates', titles: ['Synthetic Series'] });
    expect(fetcher).toHaveBeenCalledWith(`${mangaUpdatesApiOrigin}/v1/series/search`, expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ complete: false, provider: 'mangaupdates', truncated: true });
    expect(result.candidates[0]).toMatchObject({ cover: { attribution: 'MangaUpdates', url: series.image.url.original }, displayTitle: 'Synthetic Series', editorialStatus: 'COMPLETED', externalId: '12345', mediaKind: 'MANHWA', metadataVersion: 2, startYear: 2020, titleVariants: [{ title: 'Synthetic Series' }, { title: 'Synthetic Alias' }], titles: ['Synthetic Series', 'Synthetic Alias'] });
    expect(result.candidates[0]).not.toHaveProperty('chapterCount');
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({ perpage: 25 });
  });

  it('finds a comparable identity at the end of the minimum provider page without trusting API order', async () => {
    const unrelated = Array.from({ length: 24 }, (_, index) => ({ record: { ...series, series_id: index + 1, title: `Unrelated ${index + 1}` } }));
    const fetcher = vi.fn(async () => Response.json({ results: [...unrelated, { record: series }], total_hits: 25 }));

    const result = await new MangaUpdatesFavoriteProviderAdapter(fetcher).search({ limit: 20, provider: 'mangaupdates', titles: ['Synthetic Series'] });

    expect(result).toMatchObject({ complete: true, truncated: false });
    expect(result.candidates.map(({ externalId }) => externalId)).toEqual(['12345']);
  });

  it('returns an advancing empty evidence page when no provider result is comparable', async () => {
    const fetcher = vi.fn(async () => Response.json({ results: [{ record: { ...series, title: 'Unrelated Work' } }], total_hits: 26 }));

    const result = await new MangaUpdatesFavoriteProviderAdapter(fetcher).search({ limit: 20, provider: 'mangaupdates', titles: ['Synthetic Series'] });

    expect(result).toMatchObject({ candidates: [], complete: false, nextCursor: '2', truncated: true });
  });

  it('hydrates the exact series route and rejects a foreign reference', async () => {
    const hydratedSeries = {
      ...series,
      categories: [{ category: 'Fantasy', series_id: 12345, votes: 98, votes_plus: 100, votes_minus: 4, added_by: 59641381499 }],
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(hydratedSeries), { headers: { 'content-type': 'application/json' } }));
    const adapter = new MangaUpdatesFavoriteProviderAdapter(fetcher);
    await expect(adapter.hydrate({ externalId: '12345', provider: 'mangaupdates' })).resolves.toMatchObject({ externalId: '12345' });
    expect(fetcher).toHaveBeenCalledWith(`${mangaUpdatesApiOrigin}/v1/series/12345`, expect.objectContaining({ method: 'GET' }));
    await expect(adapter.hydrate({ externalId: 'abc123', provider: 'mangaupdates' })).rejects.toThrow(/numeric/u);
    await expect(adapter.hydrate({ externalId: '../bad', provider: 'mangaupdates' })).rejects.toThrow();
  });
});
