import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRateGate } from '../provider-http';
import { KitsuFavoriteProviderAdapter } from './kitsu';

const anime = {
  attributes: {
    abbreviatedTitles: ['Frieren'], ageRating: 'PG', canonicalTitle: 'Sousou no Frieren', nsfw: false,
    endDate: '2024-03-22', episodeCount: 28, posterImage: { large: 'https://media.kitsu.app/anime/46474/poster_image/large-example.jpeg' }, slug: 'sousou-no-frieren', startDate: '2023-09-29', status: 'finished', subtype: 'TV', titles: { en: 'Frieren: Beyond Journey’s End', ja_jp: '葬送のフリーレン' }, userCount: 180000,
  },
  id: '46474',
  type: 'anime',
};

const animeMapping = { id: 'mapping-1', type: 'mappings', attributes: { externalSite: 'anilist/anime', externalId: '154587' } };

describe('Kitsu exact cross-provider evidence', () => {
  it.each(['search', 'hydrate'] as const)('retains only the mapping related to the %s resource', async (operation) => {
    const resource = { ...anime, relationships: { mappings: { data: [{ id: animeMapping.id, type: 'mappings' }] } } };
    const fetcher = vi.fn(async (_url: string) => Response.json(operation === 'search'
      ? { data: [resource], included: [animeMapping], links: { next: null }, meta: { count: 1 } }
      : { data: resource, included: [animeMapping] }));
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', fetcher);
    const result = operation === 'search' ? (await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] })).candidates[0]
      : await adapter.hydrate({ provider: 'kitsu-anime', externalId: anime.id });
    expect(result?.linkedReferences).toEqual([{ provider: 'anilist', externalId: '154587' }]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(fetcher.mock.calls[0]![0]).searchParams.get('include')).toBe('mappings');
  });

  it.each(['detached', 'wrong-kind', 'invalid-id', 'conflicting'] as const)('does not trust a %s mapping', async (mode) => {
    const mapping = mode === 'wrong-kind' ? { ...animeMapping, attributes: { ...animeMapping.attributes, externalSite: 'anilist/manga' } }
      : mode === 'invalid-id' ? { ...animeMapping, attributes: { ...animeMapping.attributes, externalId: '../154587' } } : animeMapping;
    const included = mode === 'conflicting' ? [mapping, { ...mapping, id: 'mapping-2', attributes: { ...mapping.attributes, externalId: '999' } }] : [mapping];
    const resource = { ...anime, relationships: { mappings: { data: mode === 'detached' ? [] : included.map(item => ({ id: item.id, type: item.type })) } } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: resource, included }));
    expect((await adapter.hydrate({ provider: 'kitsu-anime', externalId: anime.id }))?.linkedReferences).toBeUndefined();
  });
});
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
    expect(envelope.candidates[0]).toMatchObject({ contentClassification: 'non-adult', cover: { attribution: 'Kitsu', url: anime.attributes.posterImage.large }, displayTitle: 'Frieren: Beyond Journey’s End', editorialStatus: 'COMPLETED', endYear: 2024, episodeCount: 28, externalId: '46474', mediaKind: 'ANIME', popularity: { kind: 'MEMBERS', value: 180000 }, provider: 'kitsu-anime', startYear: 2023, titleVariants: expect.arrayContaining([{ title: 'Sousou no Frieren' }, { language: 'en', title: 'Frieren: Beyond Journey’s End' }]) });
  });

  it('uses manga-only sparse fields and accepts a response without nsfw', async () => {
    let requested = '';
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-manga', async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ data: [manga], links: { next: null }, meta: { count: 1 } }), { headers: { 'content-type': 'application/vnd.api+json' } });
    });
    await expect(adapter.search({ limit: 20, provider: 'kitsu-manga', titles: ['Genius of the Unique Lineage'] })).resolves.toMatchObject({
      candidates: [{ chapterCount: 130, contentClassification: 'unknown', externalId: '64708', mediaKind: 'MANGA', provider: 'kitsu-manga' }], complete: true,
    });
    expect(requested).toContain('chapterCount');
    expect(requested).not.toContain('episodeCount');
    expect(requested).not.toContain('nsfw');
  });

  it('ignores null translated titles without losing valid aliases', async () => {
    const attributes = { ...manga.attributes, titles: { en: null, en_jp: 'Naruto' } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-manga', async () => Response.json({ data: [{ ...manga, attributes }], links: { next: null }, meta: { count: 1 } }));
    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-manga', titles: ['Naruto'] });
    expect(envelope.candidates[0]).toMatchObject({ displayTitle: manga.attributes.canonicalTitle, titles: expect.arrayContaining([manga.attributes.canonicalTitle, 'Naruto']), titleVariants: expect.arrayContaining([{ language: 'en-jp', title: 'Naruto' }]) });
    expect(envelope.candidates[0]?.titleVariants).not.toContainEqual({ language: 'en', title: null });
    const hydration = new KitsuFavoriteProviderAdapter('kitsu-manga', async () => Response.json({ data: { ...manga, attributes } }));
    await expect(hydration.hydrate({ externalId: manga.id, provider: 'kitsu-manga' })).resolves.toMatchObject({ displayTitle: manga.attributes.canonicalTitle, externalId: manga.id });
  });

  it('rejects malformed non-null translated titles', async () => {
    const attributes = { ...manga.attributes, titles: { en: 42 } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-manga', async () => Response.json({ data: [{ ...manga, attributes }], links: { next: null }, meta: { count: 1 } }));
    await expect(adapter.search({ limit: 20, provider: 'kitsu-manga', titles: ['Naruto'] })).rejects.toThrow();
  });

  it('ignores empty translated titles and bounds a long abbreviation list', async () => {
    const mangaAttributes = { ...manga.attributes, titles: { en: '', en_jp: 'Naruto' } };
    const mangaAdapter = new KitsuFavoriteProviderAdapter('kitsu-manga', async () => Response.json({ data: [{ ...manga, attributes: mangaAttributes }], links: { next: null }, meta: { count: 1 } }));
    const mangaResult = await mangaAdapter.search({ limit: 20, provider: 'kitsu-manga', titles: ['Naruto'] });
    expect(mangaResult.candidates[0]).toMatchObject({ displayTitle: manga.attributes.canonicalTitle, titles: expect.arrayContaining([manga.attributes.canonicalTitle, 'Naruto']) });
    expect(mangaResult.candidates[0]?.titleVariants).not.toContainEqual({ language: 'en', title: '' });

    const animeAttributes = { ...anime.attributes, abbreviatedTitles: Array.from({ length: 20 }, (_value, index) => `Alias ${index}`) };
    const animeAdapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes: animeAttributes }], links: { next: null }, meta: { count: 1 } }));
    const animeResult = await animeAdapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });
    expect(animeResult.candidates[0]?.titles.length).toBeLessThanOrEqual(16);
    expect(animeResult.candidates[0]?.titleVariants?.length).toBeLessThanOrEqual(16);
    const longAttributes = { ...animeAttributes, abbreviatedTitles: Array.from({ length: 65 }, (_value, index) => `Alias ${index}`) };
    const longAdapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes: longAttributes }], links: { next: null }, meta: { count: 1 } }));
    const longResult = await longAdapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });
    expect(longResult.candidates[0]?.titles.length).toBeLessThanOrEqual(16);
    expect(longResult.candidates[0]?.titleVariants?.length).toBeLessThanOrEqual(16);
    const excessive = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes: { ...animeAttributes, abbreviatedTitles: Array.from({ length: 257 }, (_value, index) => `Alias ${index}`) } }], links: { next: null }, meta: { count: 1 } }));
    await expect(excessive.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] })).rejects.toThrow();
  });

  it('marks paginated responses incomplete and rejects cross-lane media', async () => {
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => new Response(JSON.stringify({ data: [anime], links: { next: 'https://kitsu.io/next' }, meta: { count: 2 } }), { headers: { 'content-type': 'application/vnd.api+json' } }));
    await expect(adapter.search({ limit: 1, provider: 'kitsu-anime', titles: ['Frieren'] })).resolves.toMatchObject({ complete: false, truncated: true });
    await expect(adapter.search({ limit: 1, provider: 'kitsu-manga', titles: ['Frieren'] })).rejects.toThrow(/requires provider/u);
  });

  it('preserves a Kitsu identity when its cover host is not allowlisted', async () => {
    const attributes = { ...anime.attributes, posterImage: { large: 'https://images.example.test/anime/46474.jpeg' } };
    const search = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes }], links: { next: null }, meta: { count: 1 } }));
    const searchResult = await search.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });
    expect(searchResult).toMatchObject({ candidates: [{ externalId: anime.id }], complete: true, truncated: false });
    expect(searchResult).not.toHaveProperty('nextCursor');
    expect(searchResult.candidates[0]).not.toHaveProperty('cover');

    const hydration = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: { ...anime, attributes } }));
    const hydrated = await hydration.hydrate({ externalId: anime.id, provider: 'kitsu-anime' });
    expect(hydrated).toMatchObject({ externalId: anime.id });
    expect(hydrated).not.toHaveProperty('cover');
  });

  it.each([
    'javascript://media.kitsu.app/alert',
    'http://media.kitsu.app/anime/46474.jpeg',
    'https://media.kitsu.app:8443/anime/46474.jpeg',
    'blob:https://media.kitsu.app/00000000-0000-0000-0000-000000000000',
    'https://user:password@media.kitsu.app/anime/46474.jpeg',
  ])('rejects a non-exact Kitsu cover origin without losing the identity: %s', async (large) => {
    const attributes = { ...anime.attributes, posterImage: { large } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes }], links: { next: null }, meta: { count: 1 } }));

    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ externalId: anime.id }], complete: true, truncated: false });
    expect(envelope.candidates[0]).not.toHaveProperty('cover');
  });

  it('uses the first safe Kitsu cover fallback without truncating identities', async () => {
    const medium = 'https://media.kitsu.app/anime/46474/poster_image/medium-example.jpeg';
    const attributes = { ...anime.attributes, posterImage: { large: 'https://images.example.test/anime/46474.jpeg', medium } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes }], links: { next: null }, meta: { count: 1 } }));

    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ cover: { attribution: 'Kitsu', url: medium }, externalId: anime.id }], complete: true, truncated: false });
  });

  it('keeps a safe preferred cover without truncating identities for a malformed later variant', async () => {
    const attributes = { ...anime.attributes, posterImage: { large: anime.attributes.posterImage.large, tiny: 'not a URL' } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes }], links: { next: null }, meta: { count: 1 } }));

    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ cover: { attribution: 'Kitsu', url: anime.attributes.posterImage.large }, externalId: anime.id }], complete: true, truncated: false });
  });

  it('keeps the identity when an optional Kitsu poster variant exceeds its bound', async () => {
    const attributes = { ...anime.attributes, posterImage: { large: `https://media.kitsu.app/${'x'.repeat(2049)}` } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [{ ...anime, attributes }], links: { next: null }, meta: { count: 1 } }));

    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ externalId: anime.id }], complete: true, truncated: false });
    expect(envelope.candidates[0]).not.toHaveProperty('cover');
  });

  it('retains the next page when an optional cover is rejected after a checkpoint', async () => {
    const attributes = { ...anime.attributes, posterImage: { large: 'https://images.example.test/cover.jpeg' } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({
      data: [{ ...anime, attributes }], links: { next: 'https://kitsu.io/api/edge/anime?page%5Boffset%5D=260' }, meta: { count: 276 },
    }));
    const envelope = await adapter.search({ cursor: '13', limit: 20, provider: 'kitsu-anime', titles: ['Unrelated title'] });
    expect(envelope).toMatchObject({ candidates: [{ externalId: anime.id }], complete: false, truncated: true, nextCursor: '14' });
    expect(envelope.candidates[0]).not.toHaveProperty('cover');
  });

  it('omits unusable search identities and marks the exhausted page incomplete', async () => {
    const invalidId = { ...anime, id: '\ud800' };
    const invalidSlug = { ...anime, attributes: { ...anime.attributes, slug: '\ud800' } };
    const wrongType = { ...manga, attributes: { ...manga.attributes, canonicalTitle: 'Wrong lane' } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: [wrongType, invalidId, invalidSlug, anime], links: { next: null }, meta: { count: 4 } }));

    const envelope = await adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ externalId: anime.id }], complete: false, truncated: true });
    expect(envelope).not.toHaveProperty('nextCursor');
  });

  it('keeps the upstream cursor and marks local projection omissions', async () => {
    const wrongType = { ...manga, attributes: { ...manga.attributes, canonicalTitle: 'Wrong lane' } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({
      data: [wrongType, anime],
      links: { next: 'https://kitsu.io/api/edge/anime?page%5Boffset%5D=2' },
      meta: { count: 3 },
    }));

    const envelope = await adapter.search({ limit: 2, provider: 'kitsu-anime', titles: ['Frieren'] });

    expect(envelope).toMatchObject({ candidates: [{ externalId: anime.id }], complete: false, truncated: true, nextCursor: '2', projectionIncomplete: true });
  });

  it.each(['search', 'hydrate'] as const)('records remaining %s projection failures inside the rate gate', async (operation) => {
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async () => ({ notBefore: 10_000, probeOnly: false })),
    };
    const gate = new FavoriteProviderRateGate('kitsu-anime', controls, () => 10_000, async () => undefined);
    const invalid = { ...anime, attributes: { ...anime.attributes, canonicalTitle: 'x'.repeat(201) } };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json(operation === 'search'
      ? { data: [invalid], links: { next: null }, meta: { count: 1 } }
      : { data: invalid }), gate);

    const result = operation === 'search'
      ? adapter.search({ limit: 20, provider: 'kitsu-anime', titles: ['Frieren'] })
      : adapter.hydrate({ externalId: anime.id, provider: 'kitsu-anime' });
    await expect(result).rejects.toThrow();
    expect(controls.recordFailure).toHaveBeenCalledOnce();
    expect(controls.recordSuccess).not.toHaveBeenCalled();
  });

  it('hydrates the exact numeric identity', async () => {
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => new Response(JSON.stringify({ data: anime }), { headers: { 'content-type': 'application/vnd.api+json' } }));
    await expect(adapter.hydrate({ externalId: '46474', provider: 'kitsu-anime' })).resolves.toMatchObject({ externalId: '46474', provider: 'kitsu-anime' });
  });

  it.each([
    [{ ageRating: 'R18', nsfw: false }, 'adult'],
    [{ ageRating: 'R', nsfw: undefined }, 'non-adult'],
    [{ ageRating: 'TV-MA', nsfw: undefined }, 'unknown'],
  ] as const)('classifies only documented Kitsu signals %o', async (signals, expected) => {
    const attributes = { ...anime.attributes, ...signals };
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', async () => Response.json({ data: { ...anime, attributes } }));
    await expect(adapter.hydrate({ externalId: '46474', provider: 'kitsu-anime' })).resolves.toMatchObject({ contentClassification: expected });
  });
});
