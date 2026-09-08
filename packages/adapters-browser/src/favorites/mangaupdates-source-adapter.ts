import type { EligibleFavoriteUrl, FavoriteSourceAdapter, FavoriteSourceEvidenceInput } from '@tobirink/application';
import { createSourceEvidence } from '@tobirink/domain';

const origins = Object.freeze(['http://mangaupdates.com', 'http://www.mangaupdates.com', 'https://mangaupdates.com', 'https://www.mangaupdates.com']);

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_.]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export const mangaUpdatesSourceAdapter: FavoriteSourceAdapter = Object.freeze({
  id: 'mangaupdates-url',
  origins,
  analyze(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl) {
    const [route, id, slug] = url.decodedSegments;
    if (route !== 'series' || id === undefined || url.decodedSegments.length > 3 || !/^[A-Za-z0-9]{1,13}$/u.test(id)) return undefined;
    const numericId = [...id.toLowerCase()].reduce((value, digit) => value * 36n + BigInt(parseInt(digit, 36)), 0n);
    if (numericId === 0n || numericId > 9_223_372_036_854_775_807n) return undefined;
    const base = {
      aliases: [], canonicalUrl: `${url.origin}/series/${id}`, diagnostics: [],
      explicitProviderReference: { externalId: numericId.toString(), provider: 'mangaupdates' as const },
      key: input.sourceKey, mediaKind: 'MANGA' as const, origin: url.origin, path: url.pathname,
      proofs: ['CATEGORY_PATH'] as const, sourceAdapter: 'mangaupdates-url', strategy: 'exact-origin' as const,
    };
    if (slug === undefined) return createSourceEvidence(base);
    const title = titleFromSlug(slug);
    if (title.length === 0) return createSourceEvidence(base);
    return createSourceEvidence({ ...base, aliases: [{ provenance: 'stable-url-slug', value: title }], proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], rawSlug: slug, stableSlug: slug, title });
  },
});
