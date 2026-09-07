import { describe, expect, it } from 'vitest';
import { assertFavoriteProviderSearchQuery, favoriteProviderPolicy, routeFavoriteProviders } from './provider-ports';

describe('favorite provider ports', () => {
  it.each([
    ['ANIME', ['anilist']],
    ['MANGA', ['mangaupdates']],
    ['MANHWA', ['mangaupdates']],
    ['MANHUA', ['mangaupdates']],
    ['UNKNOWN', ['anilist', 'mangaupdates']],
  ] as const)('routes %s through its bounded lane', (mediaKind, providers) => {
    expect(routeFavoriteProviders(mediaKind)).toEqual(providers);
  });

  it('bounds candidate searches and freezes their title snapshot', () => {
    const query = assertFavoriteProviderSearchQuery({ limit: 20, provider: 'anilist', titles: ['Frieren'] });
    expect(Object.isFrozen(query.titles)).toBe(true);
    expect(() => assertFavoriteProviderSearchQuery({ limit: 21, provider: 'anilist', titles: ['Frieren'] })).toThrow(/between 1 and 20/u);
    expect(() => assertFavoriteProviderSearchQuery({ limit: 1, provider: 'anilist', titles: [] })).toThrow(/between 1 and 16/u);
  });

  it('keeps transport cadence and cache lifetimes explicit', () => {
    expect(favoriteProviderPolicy).toMatchObject({ anilist: { minimumIntervalMs: 2_200 }, mangaupdates: { minimumIntervalMs: 3_000 }, requestTimeoutMs: 8_000 });
    expect(favoriteProviderPolicy.negativeTtlMs).toBeLessThan(favoriteProviderPolicy.positiveTtlMs);
  });
});
