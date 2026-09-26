import { describe, expect, it, vi } from 'vitest';
import { AniListFavoriteProviderAdapter, anilistGraphqlEndpoint } from './anilist';

const media = { chapters: null, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg', large: null, medium: null }, endDate: { year: null }, episodes: 28, format: 'TV', genres: ['Adventure'], id: 154587, popularity: 250000, siteUrl: 'https://anilist.co/anime/154587', startDate: { year: 2023 }, status: 'FINISHED', synonyms: ['Sousou no Frieren'], title: { english: 'Frieren', native: '葬送のフリーレン', romaji: 'Sousou no Frieren' }, type: 'ANIME', volumes: null };

describe('AniListFavoriteProviderAdapter', () => {
  it('maps a complete bounded search response', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { Page: { media: [media], pageInfo: { hasNextPage: false } } } }), { headers: { 'content-type': 'application/json' } }));
    const adapter = new AniListFavoriteProviderAdapter(fetcher);
    const result = await adapter.search({ limit: 10, provider: 'anilist', titles: ['Frieren'] });
    expect(fetcher).toHaveBeenCalledWith(anilistGraphqlEndpoint, expect.objectContaining({
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: 'https://tobirink.com',
        Referer: 'https://tobirink.com/',
        'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)',
      },
      method: 'POST',
      signal: expect.any(AbortSignal),
    }));
    expect(result).toMatchObject({ complete: true, provider: 'anilist', truncated: false });
    expect(result.candidates[0]).toMatchObject({ cover: { attribution: 'AniList', url: media.coverImage.extraLarge }, displayTitle: 'Frieren', editorialStatus: 'COMPLETED', episodeCount: 28, externalId: '154587', mediaKind: 'ANIME', metadataVersion: 2, popularity: { kind: 'MEMBERS', value: 250000 }, startYear: 2023, titleVariants: expect.arrayContaining([{ language: 'en', title: 'Frieren' }]), titles: ['Sousou no Frieren', 'Frieren', '葬送のフリーレン'] });
  });

  it('fails closed on a malformed or oversized response', async () => {
    const malformed = new AniListFavoriteProviderAdapter(async () => new Response(JSON.stringify({ data: {} }), { headers: { 'content-type': 'application/json' } }));
    await expect(malformed.search({ limit: 1, provider: 'anilist', titles: ['Titre'] })).rejects.toThrow();
    const oversized = new AniListFavoriteProviderAdapter(async () => new Response('x', { headers: { 'content-length': '524289', 'content-type': 'application/json' } }));
    await expect(oversized.search({ limit: 1, provider: 'anilist', titles: ['Titre'] })).rejects.toThrow(/too large/u);
  });

  it('hydrates only an exact numeric reference', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { Media: media } }), { headers: { 'content-type': 'application/json' } }));
    const adapter = new AniListFavoriteProviderAdapter(fetcher);
    await expect(adapter.hydrate({ externalId: '154587', provider: 'anilist' })).resolves.toMatchObject({ externalId: '154587' });
    expect(fetcher).toHaveBeenCalledWith(anilistGraphqlEndpoint, expect.objectContaining({
      headers: expect.objectContaining({ Origin: 'https://tobirink.com', Referer: 'https://tobirink.com/', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' }),
    }));
    await expect(adapter.hydrate({ externalId: 'slug', provider: 'anilist' })).rejects.toThrow(/numeric/u);
  });

  it('hydrates an exact AniList manga reference without changing its media kind', async () => {
    const manga = { ...media, format: 'MANGA', id: 30013, type: 'MANGA' };
    const adapter = new AniListFavoriteProviderAdapter(async () => new Response(JSON.stringify({ data: { Media: manga } }), { headers: { 'content-type': 'application/json' } }));

    await expect(adapter.hydrate({ externalId: '30013', provider: 'anilist' })).resolves.toMatchObject({ externalId: '30013', mediaKind: 'MANGA' });
  });

  it('does not request or expose seasons, sequels or adaptations', async () => {
    const related = { ...media, relations: { edges: [{
      node: { id: 30013, title: { english: 'Frieren', native: '葬送のフリーレン', romaji: 'Sousou no Frieren' }, type: 'MANGA' },
      relationType: 'SOURCE',
    }] } };
    let body = '';
    const adapter = new AniListFavoriteProviderAdapter(async (_input, init) => {
      body = String(init?.body);
      const { relations: _relations, ...withoutRelations } = related;
      return Response.json({ data: { Media: withoutRelations } });
    });
    const candidate = await adapter.hydrate({ externalId: '154587', provider: 'anilist' });
    expect(body).not.toContain('relations');
    expect(candidate).not.toHaveProperty('relations');
  });

  it.each([
    'https://images.invalid/cover.jpg',
    'http://s4.anilist.co/cover.jpg',
    'https://s4.anilist.co:444/cover.jpg',
    'javascript://s4.anilist.co/alert',
    'blob:https://s4.anilist.co/00000000-0000-0000-0000-000000000000',
    'https://user:password@s4.anilist.co/cover.jpg',
  ])('rejects a cover outside the exact AniList HTTPS origin: %s', async (coverUrl) => {
    const adapter = new AniListFavoriteProviderAdapter(async () => Response.json({ data: { Media: { ...media, coverImage: { extraLarge: coverUrl, large: null, medium: null } } } }));
    await expect(adapter.hydrate({ externalId: '154587', provider: 'anilist' })).rejects.toThrow(/not allowed/u);
  });
});
