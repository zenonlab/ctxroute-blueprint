import { describe, expect, it, vi } from 'vitest';
import { MangaDexFavoriteProviderAdapter } from './mangadex';

const id = '12345678-1234-4234-8234-123456789abc';
const payload = { result: 'ok', data: { id, type: 'manga', attributes: { title: { en: 'Synthetic Series' }, altTitles: [{ ja: 'Synthetic Alias' }], contentRating: 'safe', lastChapter: '42', lastVolume: '6', originalLanguage: 'ko', status: 'ongoing', tags: [{ attributes: { group: 'genre', name: { en: 'Adventure' } } }, { attributes: { group: 'theme', name: { en: 'School Life' } } }, { attributes: { group: 'format', name: { en: 'Long Strip' } } }], year: 2021 }, relationships: [{ attributes: { fileName: 'cover-file.jpg' }, id: '12345678-1234-4234-8234-123456789abd', type: 'cover_art' }] } };

describe('MangaDex exact hydration', () => {
  it.each(['abc123', 'https://www.mangaupdates.com/series/abc123/synthetic'])('retains a modern MangaUpdates reference: %s', async (mu) => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ ...payload, data: { ...payload.data, attributes: { ...payload.data.attributes, links: { mu } } } }));
    expect((await adapter.hydrate({ provider: 'mangadex', externalId: id }))?.linkedReferences).toEqual([{ provider: 'mangaupdates', externalId: String(parseInt('abc123', 36)) }]);
  });
  it.each(['12345', 'https://www.mangaupdates.com/series.html?id=12345', 'https://untrusted.example/series/abc123'])('does not invent a canonical identity from %s', async (mu) => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ ...payload, data: { ...payload.data, attributes: { ...payload.data.attributes, links: { mu } } } }));
    expect((await adapter.hydrate({ provider: 'mangadex', externalId: id }))?.linkedReferences).toBeUndefined();
  });
  it('retains a next page and forwards its offset instead of claiming completeness', async () => {
    const unrelated = { ...payload.data, id: '12345678-1234-4234-8234-123456789abd', attributes: { ...payload.data.attributes, title: { en: 'Unrelated Constellation' }, altTitles: [] } };
    const fetcher = vi.fn(async () => Response.json({ result: 'ok', data: [payload.data, ...Array.from({ length: 19 }, () => unrelated)], limit: 20, offset: 20, total: 41 }));
    const result = await new MangaDexFavoriteProviderAdapter(fetcher).search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 10, cursor: '2' });
    expect(result).toMatchObject({ complete: false, truncated: true, nextCursor: '3' });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('offset=20'), expect.anything());
  });
  it('rejects inconsistent pagination instead of declaring no-match', async () => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: [], limit: 20, offset: 0, total: 42 }));
    await expect(adapter.search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 })).rejects.toThrow('pagination');
  });
  it('searches by a bounded title and returns normalized candidates', async () => {
    const fetcher = vi.fn(async () => Response.json({ result: 'ok', data: [payload.data], limit: 20, offset: 0, total: 1 }));
    const adapter = new MangaDexFavoriteProviderAdapter(fetcher);
    const result = await adapter.search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 });
    expect(result).toMatchObject({ provider: 'mangadex', complete: true, candidates: [{ provider: 'mangadex', externalId: id, mediaKind: 'MANHWA' }] });
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/manga?title=Synthetic+Series'), expect.objectContaining({ method: 'GET' }));
  });

  it('accepts a public search result with 84 relationships but rejects 129', async () => {
    const relationships = Array.from({ length: 84 }, (_value, index) => ({ id: `12345678-1234-4234-8234-${String(index).padStart(12, '0')}`, type: 'author' }));
    const searchResponse = (items: typeof relationships) => Response.json({ result: 'ok', data: [{ ...payload.data, relationships: items }], limit: 20, offset: 0, total: 1 });
    const accepted = await new MangaDexFavoriteProviderAdapter(async () => searchResponse(relationships)).search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 });
    expect(accepted.candidates).toMatchObject([{ externalId: id }]);
    await expect(new MangaDexFavoriteProviderAdapter(async () => searchResponse(Array.from({ length: 129 }, (_value, index) => relationships[index % relationships.length]!))).search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 })).rejects.toThrow();
  });

  it('keeps a matching identity when another result has an oversized title', async () => {
    const overlong = { ...payload.data, id: '12345678-1234-4234-8234-123456789abd', attributes: { ...payload.data.attributes, title: { en: 'A'.repeat(201) }, altTitles: [] } };
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: [overlong, payload.data], limit: 20, offset: 0, total: 2 }));
    const result = await adapter.search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 });
    expect(result).toMatchObject({ complete: false, truncated: true, candidates: [{ externalId: id }] });
    expect(result).not.toHaveProperty('nextCursor');
    const unmatched = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: [overlong], limit: 20, offset: 0, total: 1 }));
    await expect(unmatched.search({ provider: 'mangadex', titles: ['Synthetic Series'], limit: 20 })).resolves.toMatchObject({ candidates: [], complete: false, truncated: true });
  });

  it('does not claim completeness after omitting a late alias', async () => {
    const attributes = { ...payload.data.attributes, altTitles: Array.from({ length: 17 }, (_value, index) => ({ en: `Alias ${index}` })) };
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: [{ ...payload.data, attributes }], limit: 20, offset: 0, total: 1 }));
    await expect(adapter.search({ provider: 'mangadex', titles: ['Missing'], limit: 20 })).resolves.toMatchObject({ complete: false, truncated: true });
  });

  it('hydrates an exact identity using a bounded alternate title', async () => {
    const attributes = { ...payload.data.attributes, title: { en: 'A'.repeat(201) }, altTitles: [{ ja: 'Synthetic Alias' }] };
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: { ...payload.data, attributes } }));
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).resolves.toMatchObject({ displayTitle: 'Synthetic Alias', titles: ['Synthetic Alias'] });
  });

  it('hydrates only the requested public identity and retains aliases', async () => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const adapter = new MangaDexFavoriteProviderAdapter(fetcher);
    const hydrated = await adapter.hydrate({ provider: 'mangadex', externalId: id });
    expect(hydrated).toMatchObject({ cover: { attribution: 'MangaDex', url: `https://uploads.mangadex.org/covers/${id}/cover-file.jpg.512.jpg` }, displayTitle: 'Synthetic Series', provider: 'mangadex', externalId: id, mediaKind: 'MANHWA', editorialStatus: 'ONGOING', genres: ['Adventure'], startYear: 2021, titleVariants: [{ language: 'en', title: 'Synthetic Series' }, { language: 'ja', title: 'Synthetic Alias' }], titles: ['Synthetic Series', 'Synthetic Alias'] });
    expect(hydrated).not.toHaveProperty('chapterCount');
    expect(hydrated).not.toHaveProperty('volumeCount');
    expect(fetcher).toHaveBeenCalledWith(`https://api.mangadex.org/manga/${id}?includes%5B%5D=cover_art`, expect.objectContaining({ method: 'GET' }));
  });

  it('rejects invalid references before network access', async () => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const adapter = new MangaDexFavoriteProviderAdapter(fetcher);
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: '../manga' })).rejects.toThrow();
    await expect(adapter.hydrate({ provider: 'anilist', externalId: id })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a response for another identity', async () => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ ...payload, data: { ...payload.data, id: '12345678-1234-4234-8234-123456789abd' } }));
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).rejects.toThrow('different identity');
  });

  it('treats an exact 404 as absent', async () => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => new Response(null, { status: 404 }));
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).resolves.toBeUndefined();
  });

  it.each([429, 500, 503])('preserves HTTP %i as a provider failure', async (status) => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => new Response(null, { status }));
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).rejects.toThrow();
  });

  it('rejects incomplete metadata instead of returning absence', async () => {
    const adapter = new MangaDexFavoriteProviderAdapter(async () => Response.json({ result: 'ok', data: { id } }));
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).rejects.toThrow();
  });
});
