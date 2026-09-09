import { describe, expect, it, vi } from 'vitest';
import { MangaDexFavoriteProviderAdapter } from './mangadex-provider-adapter';

const id = '12345678-1234-4234-8234-123456789abc';
const payload = { result: 'ok', data: { id, type: 'manga', attributes: { title: { en: 'Synthetic Series' }, altTitles: [{ ja: 'Synthetic Alias' }], contentRating: 'safe', lastChapter: '42', lastVolume: '6', originalLanguage: 'ko', status: 'ongoing', tags: [{ attributes: { name: { en: 'Adventure' } } }], year: 2021 } } };

describe('MangaDex exact hydration', () => {
  it('hydrates only the requested public identity and retains aliases', async () => {
    const fetcher = vi.fn(async () => Response.json(payload));
    const adapter = new MangaDexFavoriteProviderAdapter(fetcher);
    await expect(adapter.hydrate({ provider: 'mangadex', externalId: id })).resolves.toMatchObject({ provider: 'mangadex', externalId: id, mediaKind: 'MANHWA', editorialStatus: 'ONGOING', genres: ['Adventure'], startYear: 2021, chapterCount: 42, volumeCount: 6, titles: ['Synthetic Series', 'Synthetic Alias'] });
    expect(fetcher).toHaveBeenCalledWith(`https://api.mangadex.org/manga/${id}`, expect.objectContaining({ method: 'GET' }));
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
