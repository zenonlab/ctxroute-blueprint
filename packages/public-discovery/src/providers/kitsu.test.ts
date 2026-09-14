import { describe, expect, it } from 'vitest';
import { KitsuFavoriteProviderAdapter } from './kitsu';

const anime = {
  attributes: {
    abbreviatedTitles: ['Frieren'], ageRating: 'PG', canonicalTitle: 'Sousou no Frieren', nsfw: false,
    endDate: '2024-03-22', episodeCount: 28, posterImage: { large: 'https://media.kitsu.app/anime/46474/poster_image/large-example.jpeg' }, slug: 'sousou-no-frieren', startDate: '2023-09-29', status: 'finished', subtype: 'TV', titles: { en: 'Frieren: Beyond Journey’s End', ja_jp: '葬送のフリーレン' }, userCount: 180000,
  },
  id: '46474',
  type: 'anime',
};
const manga = {
  attributes: {
    abbreviatedTitles: ['Genius of the Unique Lineage'], ageRating: null,
    canonicalTitle: 'The Perfect Hybrid', chapterCount: 130, endDate: null,
    posterImage: { large: 'https://media.kitsu.app/manga/64708/poster_image/large-example.jpeg' },
    slug: 'the-perfect-hybrid', startDate: '2022-01-01', status: 'current', subtype: 'manhwa',
    titles: { en: 'The Perfect Hybrid' }, userCount: 4200, volumeCount: null,
  },
  id: '64708',
  type: 'manga',
};

describe('KitsuFavoriteProviderAdapter', () => {
  it('reads a complete bounded JSON:API anime candidate set', async () => {
    let requested = '';
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ data: [anime], links: { next: null }, meta: { count: 1 } }), { headers: { 'content-type': 'application/vnd.api+json' } });
    });
    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });
    expect(requested).toContain('filter%5Btext%5D=Frieren');
    expect(requested).toContain('episodeCount');
    expect(requested).not.toContain('chapterCount');
    expect(envelope).toMatchObject({ complete: true, provider: 'kitsu-anime', truncated: false });
    expect(envelope.candidates[0]).toMatchObject({ cover: { attribution: 'Kitsu', url: anime.attributes.posterImage.large }, displayTitle: 'Frieren: Beyond Journey’s End', editorialStatus: 'COMPLETED', endYear: 2024, episodeCount: 28, externalId: '46474', mediaKind: 'ANIME', popularity: { kind: 'MEMBERS', value: 180000 }, provider: 'kitsu-anime', startYear: 2023, titleVariants: expect.arrayContaining([{ title: 'Sousou no Frieren' }, { language: 'en', title: 'Frieren: Beyond Journey’s End' }]) });
  });

  it('uses manga-only sparse fields and accepts a response without nsfw', async () => {
    let requested = '';
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-manga', async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ data: [manga], links: { next: null }, meta: { count: 1 } }), { headers: { 'content-type': 'application/vnd.api+json' } });
    });
    await expect(adapter.search({ limit: 20, provider: 'kitsu-manga', titles: ['Genius of the Unique Lineage'] })).resolves.toMatchObject({
      candidates: [{ chapterCount: 130, externalId: '64708', mediaKind: 'MANGA', provider: 'kitsu-manga' }], complete: true,
    });
    expect(requested).toContain('chapterCount');
    expect(requested).not.toContain('episodeCount');
    expect(requested).not.toContain('nsfw');
  });

  it('marks paginated responses incomplete and rejects cross-lane media', async () => {
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => new Response(JSON.stringify({ data: [anime], links: { next: 'https://kitsu.io/next' }, meta: { count: 2 } }), { headers: { 'content-type': 'application/vnd.api+json' } }));
    await expect(adapter.search({ limit: 1, provider: 'kitsu-anime', titles: ['Frieren'] })).resolves.toMatchObject({ complete: false, truncated: true });
    await expect(adapter.search({ limit: 1, provider: 'kitsu-manga', titles: ['Frieren'] })).rejects.toThrow(/requires provider/u);
  });

  it('hydrates the exact numeric identity', async () => {
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => new Response(JSON.stringify({ data: anime }), { headers: { 'content-type': 'application/vnd.api+json' } }));
    await expect(adapter.hydrate({ externalId: '46474', provider: 'kitsu-anime' })).resolves.toMatchObject({ externalId: '46474', provider: 'kitsu-anime' });
  });
});
