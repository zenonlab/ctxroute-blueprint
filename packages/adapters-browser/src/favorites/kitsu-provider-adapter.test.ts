import { describe, expect, it } from 'vitest';
import { KitsuFavoriteProviderAdapter } from './kitsu-provider-adapter';

const anime = {
  attributes: {
    abbreviatedTitles: ['Frieren'], ageRating: 'PG', canonicalTitle: 'Sousou no Frieren', nsfw: false,
    slug: 'sousou-no-frieren', subtype: 'TV', titles: { en: 'Frieren: Beyond Journey’s End', ja_jp: '葬送のフリーレン' },
  },
  id: '46474',
  type: 'anime',
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
    expect(envelope).toMatchObject({ complete: true, provider: 'kitsu-anime', truncated: false });
    expect(envelope.candidates[0]).toMatchObject({ externalId: '46474', mediaKind: 'ANIME', provider: 'kitsu-anime' });
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
