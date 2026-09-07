import type { EligibleFavoriteUrl, FavoriteSourceAdapter, FavoriteSourceEvidenceInput } from '@tobirink/application';
import { createSourceEvidence } from '@tobirink/domain';

const origins = Object.freeze([
  'http://anilist.co',
  'http://www.anilist.co',
  'https://anilist.co',
  'https://www.anilist.co',
]);

function titleFromSlug(slug: string): string {
  return slug.replace(/[-_.]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

export const anilistSourceAdapter: FavoriteSourceAdapter = Object.freeze({
  id: 'anilist-url',
  origins,
  analyze(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl) {
    const [kind, id, slug] = url.decodedSegments;
    if ((kind !== 'anime' && kind !== 'manga') || id === undefined || !/^\d+$/u.test(id)) return undefined;
    const mediaKind = kind === 'anime' ? 'ANIME' as const : 'MANGA' as const;
    const base = {
      aliases: [],
      canonicalUrl: `${url.origin}/${kind}/${id}`,
      diagnostics: [],
      explicitProviderReference: { externalId: id, provider: 'anilist' as const },
      key: input.sourceKey,
      mediaKind,
      origin: url.origin,
      path: url.pathname,
      proofs: ['CATEGORY_PATH'] as const,
      sourceAdapter: 'anilist-url',
      strategy: 'exact-origin' as const,
    };
    if (slug === undefined) return createSourceEvidence(base);
    const title = titleFromSlug(slug);
    if (title.length === 0) return createSourceEvidence(base);
    return createSourceEvidence({
      ...base,
      aliases: [{ provenance: 'stable-url-slug', value: title }],
      proofs: ['CATEGORY_PATH', 'TITLE_SLUG'],
      rawSlug: slug,
      stableSlug: slug,
      title,
    });
  },
});
