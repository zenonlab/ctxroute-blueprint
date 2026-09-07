import { describe, expect, it, vi } from 'vitest';
import { AniListFavoriteProviderAdapter, anilistGraphqlEndpoint } from './anilist-provider-adapter';

const media = { format: 'TV', genres: ['Adventure'], id: 154587, siteUrl: 'https://anilist.co/anime/154587', synonyms: ['Sousou no Frieren'], title: { english: 'Frieren', native: '葬送のフリーレン', romaji: 'Sousou no Frieren' }, type: 'ANIME' };

describe('AniListFavoriteProviderAdapter', () => {
  it('maps a complete bounded search response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [media], pageInfo: { hasNextPage: false } } } }), { headers: { 'content-type': 'application/json' } }));
    const adapter = new AniListFavoriteProviderAdapter(fetcher);
    const result = await adapter.search({ limit: 10, provider: 'anilist', titles: ['Frieren'] });
    expect(fetcher).toHaveBeenCalledWith(anilistGraphqlEndpoint, expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }));
    expect(result).toMatchObject({ complete: true, provider: 'anilist', truncated: false });
    expect(result.candidates[0]).toMatchObject({ externalId: '154587', mediaKind: 'ANIME', titles: ['Sousou no Frieren', 'Frieren', '葬送のフリーレン'] });
  });

  it('fails closed on a malformed or oversized response', async () => {
    const malformed = new AniListFavoriteProviderAdapter(async () => new Response(JSON.stringify({ data: {} }), { headers: { 'content-type': 'application/json' } }));
    await expect(malformed.search({ limit: 1, provider: 'anilist', titles: ['Titre'] })).rejects.toThrow();
    const oversized = new AniListFavoriteProviderAdapter(async () => new Response('x', { headers: { 'content-length': '65537', 'content-type': 'application/json' } }));
    await expect(oversized.search({ limit: 1, provider: 'anilist', titles: ['Titre'] })).rejects.toThrow(/too large/u);
  });

  it('hydrates only an exact numeric reference', async () => {
    const adapter = new AniListFavoriteProviderAdapter(async () => new Response(JSON.stringify({ data: { Media: media } }), { headers: { 'content-type': 'application/json' } }));
    await expect(adapter.hydrate({ externalId: '154587', provider: 'anilist' })).resolves.toMatchObject({ externalId: '154587' });
    await expect(adapter.hydrate({ externalId: 'slug', provider: 'anilist' })).rejects.toThrow(/numeric/u);
  });

  it('hydrates an exact AniList manga reference without changing its media kind', async () => {
    const manga = { ...media, format: 'MANGA', id: 30013, type: 'MANGA' };
    const adapter = new AniListFavoriteProviderAdapter(async () => new Response(JSON.stringify({ data: { Media: manga } }), { headers: { 'content-type': 'application/json' } }));

    await expect(adapter.hydrate({ externalId: '30013', provider: 'anilist' })).resolves.toMatchObject({ externalId: '30013', mediaKind: 'MANGA' });
  });
});
