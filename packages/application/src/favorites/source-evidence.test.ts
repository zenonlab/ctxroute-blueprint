import { createSourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { extractFavoriteSourceEvidence } from './source-evidence';
import type { FavoriteSourceAdapter } from './source-evidence';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';

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
    ['/manga/synthetic-harbor/42', 'MANGA'],
    ['/anime/synthetic-harbor/vostfr', 'ANIME'],
    ['/library/synthetic-harbor/reader', 'UNKNOWN'],
  ])('recovers a corroborated identity before a routing tail: %s', (path, mediaKind) => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'raw-recovery', title: 'Synthetic Harbor', url: `https://reader.invalid${path}` })).toMatchObject({ stableSlug: 'synthetic-harbor', mediaKind });
  });
  it('keeps a usable title on an unknown route as an unverified query', () => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'raw-query', title: 'Synthetic Harbor', url: 'https://reader.invalid/library/zx731904' })).toMatchObject({ title: 'Synthetic Harbor', mediaKind: 'UNKNOWN', proofs: [] });
  });
  it('requeues a previously rejected source after corroborated route recognition', async () => {
    const storage = new MemoryStoragePort();
    const favorite = { bookmarkId: 'recovered', folderPath: [], order: 0, state: 'eligible' as const, title: 'Synthetic Journey', url: 'https://reader.example/library/synthetic-journey' };
    const legacy: FavoriteSourceAdapter = { id: 'legacy-rejected', origins: ['https://reader.example'], analyze: () => undefined };
    await importFavoriteSources([favorite], storage, '2026-09-18T18:00:00.000Z', [legacy]);
    const [before] = await storage.listFavoriteSources({ limit: 1 });
    expect(before?.resolution).toEqual({ kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' });
    await importFavoriteSources([favorite], storage, '2026-09-18T18:01:00.000Z');
    const [after] = await storage.listFavoriteSources({ limit: 1 });
    expect(after).toMatchObject({ id: before?.id, url: favorite.url, title: favorite.title });
    expect(after?.resolution).toBeUndefined();
    expect(after && await storage.getFavoriteResolutionTask(after.id.replace(/^source_/u, 'favorite-resolution_'))).toMatchObject({ state: 'READY' });
    expect(after && (await storage.getFavoriteParseArtifact(after.id))?.artifact).toMatchObject({ mediaKind: 'UNKNOWN', status: 'parsed', sourceAdapterVersion: 'source-adapter-v3:generic-url-corroborated-v1' });
  });
  it.each(['synthetic-journey', 'library/synthetic-journey'])('keeps corroborated work titles on unknown routes: %s', path => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'unknown-route', title: 'Synthetic Journey', url: `https://reader.example/${path}` })).toMatchObject({
      mediaKind: 'UNKNOWN', stableSlug: 'synthetic-journey', title: 'synthetic journey', proofs: ['TITLE_SLUG'],
    });
  });
  it.each(['search/synthetic-journey', 'account/synthetic-journey', ''])('does not use title corroboration to bypass excluded routes: %s', path => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'excluded-route', title: 'Synthetic Journey', url: `https://reader.example/${path}` }).disposition).toBeDefined();
  });
  it('separates an attached chapter and a long routing prefix from a root work slug', () => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'bookmark-routing-prefix', title: '0906168628 Genius of the Unique Lineage', url: 'https://www.asurascans.com/0906168628-genius-of-the-unique-lineage-chapter-31/' })).toMatchObject({
      canonicalUrl: 'https://www.asurascans.com/0906168628-genius-of-the-unique-lineage',
      identityTransformations: ['numeric-routing-prefix'],
      rawSlug: '0906168628-genius-of-the-unique-lineage-chapter-31',
      release: { kind: 'chapter', provenance: 'URL_SLUG_SUFFIX', value: 31 },
      stableSlug: 'genius-of-the-unique-lineage',
      title: 'genius of the unique lineage',
    });
  });

  it('removes a non-zero long routing prefix only when the same route proves a release', () => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'bookmark-nonzero-routing-prefix', title: '1674484774 Skeleton Soldier Couldnt Protect the Dungeon', url: 'https://reader.invalid/1674484774-skeleton-soldier-couldnt-protect-the-dungeon-chapter-51' })).toMatchObject({
      identityTransformations: ['numeric-routing-prefix'],
      release: { kind: 'chapter', value: 51 },
      stableSlug: 'skeleton-soldier-couldnt-protect-the-dungeon',
    });
    expect(extractFavoriteSourceEvidence(input('unproven-numeric-title', 'https://reader.invalid/1674484774-skeleton-soldier-couldnt-protect-the-dungeon'))).toMatchObject({ proofs: [], mediaKind: 'UNKNOWN', sourceAdapter: 'generic-bookmark-query-v1' });
  });

  it.each(['86-eighty-six', '91-days', 'area-88', '100000-money-game'])('preserves an intrinsic numeric work identity: %s', (slug) => {
    expect(extractFavoriteSourceEvidence(input('intrinsic-number', `https://fixtures.tobirink.invalid/manga/${slug}/chapter-1`))).toMatchObject({ stableSlug: slug });
  });

  it.each(['synthetic-series/chapter-12', 'synthetic-series-chapter-12', 'synthetic-series/chapter/12'])('recognizes root release evidence without inventing a media type: %s', path => {
    expect(extractFavoriteSourceEvidence(input('root-release', `https://fixtures.tobirink.invalid/${path}`))).toMatchObject({ mediaKind: 'UNKNOWN', stableSlug: 'synthetic-series', release: { value: 12, kind: 'chapter' } });
  });
  it.each([
    ['https://mangaclash.com/manga/quest-supremacy/chapter-70-1', 'quest-supremacy', 70.1],
    ['https://mangaeffect.com/manga/oshi-no-ko/chapter-145', 'oshi-no-ko', 145],
    ['https://shieldmanga.net/manga/bones/chapter-3-5/', 'bones', 3.5],
  ])('recognizes a hyphenated chapter number used by manga readers: %s', (url, stableSlug, value) => {
    expect(extractFavoriteSourceEvidence(input('hyphenated-chapter', url))).toMatchObject({ mediaKind: 'MANGA', stableSlug, release: { kind: 'chapter', value } });
  });
  it('uses the bookmark title only for ADKami numeric anime routes', () => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'adkami-anime', title: 'Kakushigoto - Episode 1 vostfr - ADKami', url: 'https://www.adkami.com/anime/3759/1/1/2/1/' })).toMatchObject({
      mediaKind: 'ANIME', proofs: ['CATEGORY_PATH'], sourceAdapter: 'known-numeric-route-v1', title: 'Kakushigoto',
    });
    expect(extractFavoriteSourceEvidence(input('numeric-generic', 'https://fixtures.tobirink.invalid/anime/3759'))).toMatchObject({ disposition: 'URL_IDENTITY_UNRESOLVED' });
  });
  it.each(['watch?v=synthetic', 'blog/ordinary-link'])('still rejects explicitly excluded links: %s', path => {
    expect(extractFavoriteSourceEvidence(input('ordinary', `https://fixtures.tobirink.invalid/${path}`)).disposition).toBe('URL_IDENTITY_UNRESOLVED');
  });
  it('uses a cleaned bookmark title only when a generic route proves a media release', () => {
    expect(extractFavoriteSourceEvidence({ sourceKey: 'bookmark-release-title', title: 'Genius of the Unique Lineage Chapter 31', url: 'https://reader.example/view/9384/chapter/31' })).toMatchObject({
      mediaKind: 'UNKNOWN', proofs: ['RELEASE_PATH'], release: { kind: 'chapter', value: 31 }, sourceAdapter: 'generic-bookmark-release-v1', title: 'Genius of the Unique Lineage',
    });
  });
  it('accepts a bounded numeric route only when the bookmark corroborates its release-bearing slug', () => {
    const url = 'https://void-scans.com/1/artifact-reading-appraiser-chapter-18/';
    expect(extractFavoriteSourceEvidence({ sourceKey: 'bookmark-void', title: 'Artifact Reading Appraiser | Chapter 18 | Void Scans', url })).toMatchObject({
      canonicalUrl: 'https://void-scans.com/1/artifact-reading-appraiser',
      release: { kind: 'chapter', provenance: 'URL_SLUG_SUFFIX', value: 18 },
      stableSlug: 'artifact-reading-appraiser',
      title: 'artifact reading appraiser',
    });
    expect(extractFavoriteSourceEvidence({ sourceKey: 'bookmark-uncorroborated', title: 'Unrelated page', url })).toMatchObject({
      sourceAdapter: 'generic-bookmark-release-v1',
      title: 'Unrelated page',
    });
  });
  it('infers a clean title from an identifier slug followed by a generic release marker', () => {
    expect(extractFavoriteSourceEvidence({
      sourceKey: 'bookmark-bato',
      title: 'A Wannabe Golden Gangster | Special Episode 2 [END] | Read Free Manga Online',
      url: 'https://bato.si/title/141645-en-a-wannabe-golden-gangster/3083720-ch_67',
    })).toMatchObject({
      canonicalUrl: 'https://bato.si/title/141645-en-a-wannabe-golden-gangster',
      identityTransformations: ['numeric-routing-prefix'],
      mediaKind: 'UNKNOWN',
      release: { kind: 'chapter', value: 67 },
      stableSlug: 'a-wannabe-golden-gangster',
      title: 'a wannabe golden gangster',
    });
  });
  it('recognizes a numeric reader tail after a chapter route', () => {
    expect(extractFavoriteSourceEvidence({
      sourceKey: 'bookmark-mangabtt',
      title: 'Read Ikitsuku Saki wa Yuusha ka Maou ka Chapter 7-eng-li Online | MangaBTT',
      url: 'https://mangabtt.com/manga/ikitsuku-saki-wa-yuusha-ka-maou-ka/chapter-7-eng-li/411818',
    })).toMatchObject({
      mediaKind: 'MANGA', release: { kind: 'chapter', value: 7 }, stableSlug: 'ikitsuku-saki-wa-yuusha-ka-maou-ka',
      title: 'ikitsuku saki wa yuusha ka maou ka',
    });
  });
  it('falls back to the human title when a routing-prefixed slug is not corroborated', () => {
    expect(extractFavoriteSourceEvidence({
      sourceKey: 'bookmark-uncorroborated-routing-prefix',
      title: 'Synthetic Journey Chapter 101',
      url: 'https://reader.example/title/141645-en-another-series/3083720-ch_101',
    })).toMatchObject({
      mediaKind: 'UNKNOWN',
      release: { kind: 'chapter', value: 101 },
      sourceAdapter: 'generic-bookmark-release-v1',
      title: 'Synthetic Journey',
    });
  });
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

  it.each(['season4', 'season/4', 'saison-4/episode-12'])('preserves the identity preceding a labelled season route %s', (tail) => {
    expect(extractFavoriteSourceEvidence(input('season-route', `https://fixtures.tobirink.invalid/anime/fixture-series/${tail}`))).toMatchObject({ canonicalUrl: 'https://fixtures.tobirink.invalid/anime/fixture-series', stableSlug: 'fixture-series', mediaKind: 'ANIME' });
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

  it('keeps the identity route before a localized release slug', () => {
    expect(extractFavoriteSourceEvidence(input('nested-release', 'https://anime-sama.example/anime/remonster/re-monster-02-vostfr'))).toMatchObject({
      canonicalUrl: 'https://anime-sama.example/anime/remonster',
      mediaKind: 'ANIME',
      release: { kind: 'episode', provenance: 'URL_SLUG_SUFFIX', value: 2 },
      stableSlug: 'remonster',
    });
  });

  it('does not treat a YouTube watch route as a media identity', () => {
    expect(extractFavoriteSourceEvidence(input('youtube', 'https://www.youtube.com/watch?v=fixture'))).toMatchObject({
      disposition: 'URL_IDENTITY_UNRESOLVED',
      proofs: [],
    });
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
