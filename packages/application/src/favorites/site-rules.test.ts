import { describe, expect, it } from 'vitest';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters, favoriteSiteRulesSchema } from './site-rules';
import { extractFavoriteSourceEvidence } from './source-evidence';

const adapters = createFavoriteSiteAdapters(bundledFavoriteSiteRules);
function evidence(url: string) { return extractFavoriteSourceEvidence({ sourceKey: 'synthetic-source', title: 'Synthetic Journey', url }, adapters); }

describe('declarative site routes', () => {
  it.each(['https://manhwaz.com', 'https://www.manhwaz.com'])('removes a proven Manhwaz routing suffix and keeps decimal chapter progress on %s', (origin) => {
    const result = evidence(`${origin}/webtoon/kage-no-jitsuryokusha-ni-naritakute-006/chapter-66.1`);
    expect(result).toMatchObject({
      canonicalUrl: `${origin}/webtoon/kage-no-jitsuryokusha-ni-naritakute-006`,
      identityTransformations: ['numeric-routing-suffix'], mediaKind: 'MANHWA',
      rawSlug: 'kage-no-jitsuryokusha-ni-naritakute-006', release: { kind: 'chapter', value: 66.1 },
      stableSlug: 'kage-no-jitsuryokusha-ni-naritakute', title: 'kage no jitsuryokusha ni naritakute',
    });
  });

  it.each(['https://manhwaz.com', 'https://www.manhwaz.com'])('accepts a real Manhwaz slug without a routing suffix on %s', (origin) => {
    const result = extractFavoriteSourceEvidence({
      sourceKey: 'manhwaz-real-source',
      title: 'The Strongest Magical Swordsman Ever Reborn As An F-Rank Adventurer. Chapter 88 - ManhwaZ',
      url: `${origin}/webtoon/the-strongest-magical-swordsman-ever-reborn-as-an-f-rank-adventurer-/chapter-88`,
    }, adapters);
    expect(result).toMatchObject({
      canonicalUrl: `${origin}/webtoon/the-strongest-magical-swordsman-ever-reborn-as-an-f-rank-adventurer-`,
      mediaKind: 'MANHWA', release: { kind: 'chapter', value: 88 },
      stableSlug: 'the-strongest-magical-swordsman-ever-reborn-as-an-f-rank-adventurer-',
      title: 'the strongest magical swordsman ever reborn as an f rank adventurer',
    });
  });

  it.each(['https://manhwaz.com', 'https://www.manhwaz.com'])('accepts Manhwaz public index routes and chapter zero on %s', (origin) => {
    const result = evidence(`${origin}/public/index.php/webtoon/dreaming-freedom/chapter-0`);
    expect(result).toMatchObject({ mediaKind: 'MANHWA', release: { kind: 'chapter', value: 0 }, stableSlug: 'dreaming-freedom' });
  });

  it('accepts Anime-Sama direct anime routes', () => {
    expect(evidence('https://anime-sama.fr/anime/kekkai-sensen/saison1')).toMatchObject({ mediaKind: 'ANIME', season: 1, stableSlug: 'kekkai-sensen' });
  });

  it.each(['', '/1234567-chapter-101', '/1234567-chapter-12.5', '/1234567-chapter-0'])('extracts a Comix manga identity with route %s', (tail) => {
    const result = evidence(`https://comix.to/title/ab123-synthetic-86-journey${tail}`);
    expect(result).toMatchObject({ mediaKind: 'MANGA', stableSlug: 'synthetic-86-journey', title: 'synthetic 86 journey', canonicalUrl: 'https://comix.to/title/ab123-synthetic-86-journey' });
    expect(result.release?.value).toBe(tail === '' ? undefined : Number(tail.split('chapter-')[1]));
  });

  it('accepts the four-character Comix identifiers used by real bookmarks', () => {
    const result = evidence('https://comix.to/title/2l25-moral-less-scandal/9059271-chapter-54');
    expect(result).toMatchObject({ mediaKind: 'MANGA', stableSlug: 'moral-less-scandal', title: 'moral less scandal', release: { kind: 'chapter', value: 54 } });
  });

  it.each(['https://comix.to/collections/123', 'https://comix.to/title/ab123-synthetic/123-chapter-no', 'https://comix.to/title/ab123-synthetic/123-chapter-100001', 'https://comix.to/title/ab123-synthetic/123-chapter-1/extra'])('rejects a non-work or malformed Comix route %s', (url) => {
    expect(evidence(url).disposition).toBe('URL_IDENTITY_UNRESOLVED');
  });

  it.each([
    ['saison2/vostfr', 'ANIME', 2],
    ['saison1', 'ANIME', 1],
    ['scans/vf', 'MANGA', undefined],
    ['scan', 'MANGA', undefined],
    ['', 'UNKNOWN', undefined],
  ])('classifies Anime-Sama by route %s', (route, mediaKind, season) => {
    const result = evidence(`https://anime-sama.fr/catalogue/synthetic-journey/${route}`);
    expect(result.mediaKind).toBe(mediaKind);
    expect(result.season).toBe(season);
    expect(result.stableSlug).toBe('synthetic-journey');
    expect(result.sourceAdapter).toContain(`site-rules-v${bundledFavoriteSiteRules.version}:`);
  });

  it('accepts Anime-Sama season routes with a hyphenated season marker', () => {
    const result = evidence('https://anime-sama.fr/catalogue/dead-mount-death-play/saison1-2/vostfr');
    expect(result).toMatchObject({ mediaKind: 'ANIME', stableSlug: 'dead-mount-death-play', season: 1 });
  });

  it.each(['https://www.youtube.com/watch?v=synthetic', 'https://youtube.com/shorts/synthetic', 'https://example.org/news/synthetic', 'https://anime-sama.fr/catalogue/synthetic/watch'])('keeps unsupported route %s out of identity resolution', (url) => {
    expect(evidence(url).disposition).toBe('URL_IDENTITY_UNRESOLVED');
  });

  it('rejects remote code, regexes, wildcard origins and unbounded routes', () => {
    const rule = bundledFavoriteSiteRules.rules[0];
    expect(favoriteSiteRulesSchema.safeParse({ ...bundledFavoriteSiteRules, code: 'return true' }).success).toBe(false);
    expect(favoriteSiteRulesSchema.safeParse({ ...bundledFavoriteSiteRules, rules: [{ ...rule, regex: '.*' }] }).success).toBe(false);
    expect(favoriteSiteRulesSchema.safeParse({ ...bundledFavoriteSiteRules, rules: [{ ...rule, origin: 'https://example.org/path' }] }).success).toBe(false);
    expect(favoriteSiteRulesSchema.safeParse({ ...bundledFavoriteSiteRules, rules: Array.from({ length: 257 }, () => rule) }).success).toBe(false);
  });

  it('fails closed when two different rules match the same route', () => {
    const rule = bundledFavoriteSiteRules.rules[0];
    if (!rule) throw new Error('Missing fixture rule.');
    const conflicting = createFavoriteSiteAdapters({ schemaVersion: 1, version: 2, rules: [rule, { ...rule, id: 'conflict' }] });
    expect(extractFavoriteSourceEvidence({ sourceKey: 'synthetic', title: 'Synthetic', url: `${rule.origin}/catalogue/synthetic` }, conflicting).disposition).toBe('URL_IDENTITY_UNRESOLVED');
  });
});
