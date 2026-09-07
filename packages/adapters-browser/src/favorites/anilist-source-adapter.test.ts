import { extractFavoriteSourceEvidence } from '@tobirink/application';
import { describe, expect, it } from 'vitest';
import { anilistSourceAdapter } from './anilist-source-adapter';

function evidence(url: string) {
  return extractFavoriteSourceEvidence({ sourceKey: 'bookmark-anilist', title: 'Fixture AniList', url }, [anilistSourceAdapter]);
}

describe('AniList exact-origin source adapter', () => {
  it.each([
    ['https://anilist.co/anime/1/Cowboy-Bebop', 'ANIME'],
    ['https://www.anilist.co/manga/2/Fixture-Manga', 'MANGA'],
    ['http://anilist.co/anime/3/Fixture-Anime', 'ANIME'],
  ] as const)('extracts the public ID from %s', (url, mediaKind) => {
    expect(evidence(url)).toMatchObject({ explicitProviderReference: { externalId: expect.any(String), provider: 'anilist' }, mediaKind, strategy: 'exact-origin' });
  });

  it('preserves an HTTP origin and removes only the optional title slug', () => {
    expect(evidence('http://anilist.co/anime/3/Fixture-Anime')).toMatchObject({ canonicalUrl: 'http://anilist.co/anime/3', origin: 'http://anilist.co' });
  });

  it.each([
    'https://fake.anilist.co/anime/1/Fixture',
    'https://anilist.co/anime/not-a-number/Fixture',
    'https://anilist.co/character/1/Fixture',
  ])('does not produce an exact provider reference for %s', (url) => {
    expect(evidence(url).explicitProviderReference).toBeUndefined();
  });
});
