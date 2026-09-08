import { describe, expect, it } from 'vitest';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters, favoriteSiteRulesSchema } from './site-rules';
import { extractFavoriteSourceEvidence } from './source-evidence';

const adapters = createFavoriteSiteAdapters(bundledFavoriteSiteRules);
function evidence(url: string) { return extractFavoriteSourceEvidence({ sourceKey: 'synthetic-source', title: 'Synthetic Journey', url }, adapters); }

describe('declarative site routes', () => {
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
    expect(result.sourceAdapter).toContain('site-rules-v1:');
  });

  it.each(['https://www.youtube.com/watch?v=synthetic', 'https://youtube.com/shorts/synthetic', 'https://example.org/news/synthetic', 'https://anime-sama.fr/catalogue/synthetic/watch', 'https://anime-sama.fr.evil.invalid/catalogue/synthetic/saison1'])('keeps unsupported route %s out of identity resolution', (url) => {
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
