import { createSourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { extractFavoriteSourceEvidence } from './source-evidence';
import type { FavoriteSourceAdapter } from './source-evidence';

function input(caseId: string, url: string) {
  return { sourceKey: `bookmark-${caseId}`, title: `Fixture ${caseId}`, url };
}

const anilistAdapter: FavoriteSourceAdapter = {
  id: 'anilist-url',
  origins: ['https://anilist.co'],
  analyze(source, url) {
    const [kind, id, slug] = url.decodedSegments;
    if ((kind !== 'anime' && kind !== 'manga') || id === undefined || !/^\d+$/u.test(id)) return undefined;
    const title = slug?.replaceAll('-', ' ');
    const base = { aliases: [], canonicalUrl: `${url.origin}/${kind}/${id}`, diagnostics: [], explicitProviderReference: { externalId: id, provider: 'anilist' as const }, key: source.sourceKey, mediaKind: kind === 'anime' ? 'ANIME' as const : 'MANGA' as const, origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH'] as const, sourceAdapter: 'anilist-url', strategy: 'exact-origin' as const };
    return title === undefined ? createSourceEvidence(base) : createSourceEvidence({ ...base, aliases: [{ provenance: 'stable-url-slug', value: title }], proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], rawSlug: slug, stableSlug: slug, title });
  },
};

describe('favorite source evidence U-01…U-10', () => {
  it.each([
    ['not a URL', 'INVALID_URL'],
    ['ftp://fixtures.tobirink.invalid/anime/frieren', 'NON_WEB_URL'],
  ] as const)('keeps rejected raw URL %s non-actionable', (url, disposition) => {
    expect(extractFavoriteSourceEvidence(input('rejected', url))).toEqual({
      aliases: [], diagnostics: [], disposition, key: 'bookmark-rejected', mediaKind: 'UNKNOWN', proofs: [], sourceAdapter: 'generic-url', strategy: 'generic',
    });
  });

  it('U-01 derives identity and CATEGORY_PATH from a category route', () => {
    expect(extractFavoriteSourceEvidence(input('U-01', 'https://fixtures.tobirink.invalid/anime/frieren'))).toMatchObject({ mediaKind: 'ANIME', proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], stableSlug: 'frieren', strategy: 'generic' });
  });

  it('U-02 keeps a generic release route UNKNOWN until media proof exists', () => {
    expect(extractFavoriteSourceEvidence(input('U-02', 'https://fixtures.tobirink.invalid/read/frieren/chapter-12'))).toMatchObject({ mediaKind: 'UNKNOWN', release: { kind: 'chapter', provenance: 'URL_PATH', value: 12 }, stableSlug: 'frieren' });
  });

  it('U-03 refuses a purely numeric identity slug', () => {
    expect(extractFavoriteSourceEvidence(input('U-03', 'https://fixtures.tobirink.invalid/manga/12345'))).toMatchObject({ disposition: 'URL_IDENTITY_UNRESOLVED', proofs: [] });
  });

  it('U-04 extracts an exact official provider ID before title evidence', () => {
    expect(extractFavoriteSourceEvidence(input('U-04', 'https://anilist.co/anime/1/fixture-u-04'), [anilistAdapter])).toMatchObject({ explicitProviderReference: { externalId: '1', provider: 'anilist' }, mediaKind: 'ANIME', sourceAdapter: 'anilist-url', strategy: 'exact-origin' });
  });

  it('U-05 separates a release route from the preceding identity', () => {
    expect(extractFavoriteSourceEvidence(input('U-05', 'https://fixtures.tobirink.invalid/manga/frieren/chapter-12'))).toMatchObject({ canonicalUrl: 'https://fixtures.tobirink.invalid/manga/frieren', mediaKind: 'MANGA', proofs: ['CATEGORY_PATH', 'TITLE_SLUG', 'RELEASE_PATH'], rawSlug: 'frieren' });
  });

  it('U-06 removes an attached release suffix with provenance', () => {
    expect(extractFavoriteSourceEvidence(input('U-06', 'https://fixtures.tobirink.invalid/manga/frieren-chapter-12'))).toMatchObject({ canonicalUrl: 'https://fixtures.tobirink.invalid/manga/frieren', proofs: ['CATEGORY_PATH', 'TITLE_SLUG', 'RELEASE_SUFFIX'], releaseSuffix: 'chapter-12', stableSlug: 'frieren' });
  });

  it('U-07 lets a scan path override an anime-looking hostname', () => {
    expect(extractFavoriteSourceEvidence(input('U-07', 'https://anime-fixtures.tobirink.invalid/scan/frieren'))).toMatchObject({ mediaKind: 'MANGA', stableSlug: 'frieren' });
  });

  it.each([
    ['manhwa', 'MANHWA'],
    ['webtoon', 'MANHWA'],
    ['manhua', 'MANHUA'],
  ] as const)('preserves the exact illustrated-work kind for %s routes', (segment, mediaKind) => {
    expect(extractFavoriteSourceEvidence(input('kind', `https://fixtures.tobirink.invalid/${segment}/fixture`))).toMatchObject({ mediaKind });
  });

  it.each([
    ['https://fixtures.tobirink.invalid/', 'ROOT_PAGE'],
    ['https://fixtures.tobirink.invalid/catalogue/', 'UTILITY_PAGE'],
    ['https://fixtures.tobirink.invalid/index.html', 'UTILITY_PAGE'],
  ] as const)('U-08 excludes utility URL %s', (url, disposition) => {
    expect(extractFavoriteSourceEvidence(input('U-08', url))).toMatchObject({ disposition, proofs: [] });
  });

  it('U-09 excludes drama without a media marker', () => {
    expect(extractFavoriteSourceEvidence(input('U-09', 'https://fixtures.tobirink.invalid/drama/frieren'))).toMatchObject({ disposition: 'URL_IDENTITY_UNRESOLVED' });
  });

  it('U-10 preserves an observed valid HTTP origin in canonical evidence', () => {
    expect(extractFavoriteSourceEvidence(input('U-10', 'http://fixtures.tobirink.invalid/anime/frieren'))).toMatchObject({ canonicalUrl: 'http://fixtures.tobirink.invalid/anime/frieren', origin: 'http://fixtures.tobirink.invalid' });
  });
});

describe('exact-origin adapter registry', () => {
  it('fails closed when two adapters claim the same exact origin', () => {
    const adapter = (id: string): FavoriteSourceAdapter => ({
      id,
      origins: ['https://fixtures.tobirink.invalid'],
      analyze(source, url) {
        return createSourceEvidence({ aliases: [], diagnostics: [], key: source.sourceKey, mediaKind: 'UNKNOWN', origin: url.origin, path: url.pathname, proofs: [], sourceAdapter: id, strategy: 'exact-origin' });
      },
    });
    expect(extractFavoriteSourceEvidence(input('conflict', 'https://fixtures.tobirink.invalid/anime/frieren'), [adapter('a'), adapter('b')])).toMatchObject({ diagnostics: ['SOURCE_ADAPTER_CONFLICT'], sourceAdapter: 'conflict' });
  });

  it('does not fall back to generic evidence when an exact adapter rejects its route', () => {
    expect(extractFavoriteSourceEvidence(input('invalid-provider', 'https://anilist.co/anime/not-an-id/title'), [anilistAdapter])).toMatchObject({ disposition: 'URL_IDENTITY_UNRESOLVED', sourceAdapter: 'anilist-url', strategy: 'exact-origin' });
  });
});
