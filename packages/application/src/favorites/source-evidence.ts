import { createSourceEvidence } from '@tobirink/domain';
import type { FavoriteMediaKind, FavoriteUrlDisposition, SourceEvidence } from '@tobirink/domain';
import { qualifyFavoriteUrl } from './eligibility';
import type { EligibleFavoriteUrl } from './eligibility';
import { segmentFavoriteTitle } from './title-segmentation';

export interface FavoriteSourceEvidenceInput {
  readonly sourceKey: string;
  readonly title: string;
  readonly url: string;
}

export interface FavoriteSourceAdapter {
  readonly id: string;
  readonly origins: readonly string[];
  analyze(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl): SourceEvidence | undefined;
}

const categoryKinds: Readonly<Record<string, FavoriteMediaKind>> = Object.freeze({
  anime: 'ANIME', comic: 'MANGA', manga: 'MANGA', manhua: 'MANHUA', manhwa: 'MANHWA', scan: 'MANGA', webtoon: 'MANHWA',
});
const routeCategorySegments = new Set([...Object.keys(categoryKinds), 'read', 'series', 'title']);
const structuralSegments = new Set([
  'anime', 'chapter', 'chapitre', 'comic', 'episode', 'manga', 'manhua', 'manhwa',
  'read', 'saison', 'scan', 'season', 'series', 'title', 'volume', 'watch', 'webtoon',
]);
const releasePattern = /^(chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,]\d+)?)$/iu;
const attachedReleasePattern = /^(.+?)[-_](chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,]\d+)?)$/iu;
const localizedReleaseSuffixPattern = /(?:^|[-_.])(\d+(?:[.,]\d+)?)[-_.](?:vostfr|vf|vo|sub|dub)$/iu;

interface StructuralIdentity { readonly slug: string; readonly transformed: boolean }

function stripLeadingRoutingIdentifier(slug: string, release: SourceEvidence['release']): StructuralIdentity {
  if (release === undefined) return { slug, transformed: false };
  const match = /^(0\d{5,11})[-_.]+(.+)$/u.exec(slug);
  const remainder = match?.[2];
  return remainder !== undefined && /\p{L}/u.test(remainder)
    ? { slug: remainder, transformed: true }
    : { slug, transformed: false };
}

function releaseKind(value: string): 'chapter' | 'episode' | 'volume' {
  if (['episode', 'ep'].includes(value.toLowerCase())) return 'episode';
  if (['volume', 'vol'].includes(value.toLowerCase())) return 'volume';
  return 'chapter';
}

function displayTitle(slug: string): string {
  return slug.replace(/[-_.]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

function common(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl) {
  return { key: input.sourceKey, origin: url.origin, path: url.pathname } as const;
}

function rejectedEvidence(input: FavoriteSourceEvidenceInput, disposition: FavoriteUrlDisposition, sourceAdapter = 'generic-url', strategy: SourceEvidence['strategy'] = 'generic'): SourceEvidence {
  return createSourceEvidence({ aliases: [], diagnostics: [], disposition, key: input.sourceKey, mediaKind: 'UNKNOWN', proofs: [], sourceAdapter, strategy });
}

function bookmarkTitleReleaseEvidence(
  input: FavoriteSourceEvidenceInput,
  url: EligibleFavoriteUrl,
  release: NonNullable<SourceEvidence['release']>,
): SourceEvidence | undefined {
  const title = segmentFavoriteTitle(input.title, new URL(url.origin).hostname).cleanedTitle;
  if (!/\p{L}{2}/u.test(title) || /^(?:chapter|chapitre|episode|épisode|volume|watch|read)$/iu.test(title)) return undefined;
  return createSourceEvidence({
    ...common(input, url), aliases: [{ provenance: 'aligned-bookmark-segment', value: title }], diagnostics: [],
    mediaKind: 'UNKNOWN', proofs: [release.provenance === 'URL_PATH' ? 'RELEASE_PATH' : 'RELEASE_SUFFIX'], release,
    sourceAdapter: 'generic-bookmark-release-v1', strategy: 'generic', title,
  });
}

function genericEvidence(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl): SourceEvidence {
  const decoded = [...url.decodedSegments];
  const raw = [...url.rawSegments];
  let identityIndex = decoded.length - 1;
  let release: SourceEvidence['release'];
  let releaseSuffix: string | undefined;
  const labelledNumber = /^\d+(?:[.,]\d+)?$/u.test(decoded[identityIndex] ?? '')
    && /^(chapter|chapitre|chap|ch|episode|ep|volume|vol)$/iu.test(decoded[identityIndex - 1] ?? '');
  if (labelledNumber) {
    const label = decoded[identityIndex - 1] ?? '';
    const rawNumber = decoded[identityIndex] ?? '';
    releaseSuffix = `${label}/${rawNumber}`;
    release = { kind: releaseKind(label), provenance: 'URL_PATH', raw: releaseSuffix, value: Number(rawNumber.replace(',', '.')) };
    identityIndex -= 2;
  }
  const separated = releasePattern.exec(decoded[identityIndex] ?? '');
  if (separated !== null) {
    identityIndex -= 1;
    releaseSuffix = separated[0];
    release = { kind: releaseKind(separated[1] ?? ''), provenance: 'URL_PATH', raw: separated[0], value: Number((separated[2] ?? '').replace(',', '.')) };
  }
  const seasonTail = /^(?:season|saison|s)[-_]?([1-9]\d?)$/iu.exec(decoded[identityIndex] ?? '');
  if (seasonTail !== null) identityIndex -= 1;
  else if (/^[1-9]\d?$/u.test(decoded[identityIndex] ?? '') && /^(?:season|saison)$/iu.test(decoded[identityIndex - 1] ?? '')) identityIndex -= 2;
  const localizedRelease = localizedReleaseSuffixPattern.exec(decoded[identityIndex] ?? '');
  const precedingCategory = decoded[identityIndex - 2]?.toLowerCase();
  if (localizedRelease !== null && precedingCategory !== undefined && categoryKinds[precedingCategory] !== undefined) {
    const value = localizedRelease[1] ?? '';
    releaseSuffix = localizedRelease[0].replace(/^[-_.]/u, '');
    release = {
      kind: categoryKinds[precedingCategory] === 'ANIME' ? 'episode' : 'chapter',
      provenance: 'URL_SLUG_SUFFIX',
      raw: releaseSuffix,
      value: Number(value.replace(',', '.')),
    };
    identityIndex -= 1;
  }
  const observedSlug = decoded[identityIndex];
  let stableSlug = observedSlug;
  const attached = attachedReleasePattern.exec(stableSlug ?? '');
  if (attached !== null) {
    stableSlug = attached[1];
    releaseSuffix = `${attached[2] ?? ''}-${attached[3] ?? ''}`;
    release = { kind: releaseKind(attached[2] ?? ''), provenance: 'URL_SLUG_SUFFIX', raw: releaseSuffix, value: Number((attached[3] ?? '').replace(',', '.')) };
    raw[identityIndex] = encodeURIComponent(stableSlug ?? '');
  }
  const structuralIdentity = stableSlug === undefined
    ? { slug: '', transformed: false }
    : stripLeadingRoutingIdentifier(stableSlug, release);
  stableSlug = structuralIdentity.slug || stableSlug;
  const normalizedSlug = stableSlug?.toLowerCase();
  if (stableSlug === undefined || observedSlug === undefined || normalizedSlug === undefined || /^\d+$/u.test(normalizedSlug) || structuralSegments.has(normalizedSlug)) {
    return release === undefined ? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED')
      : (bookmarkTitleReleaseEvidence(input, url, release) ?? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED'));
  }
  const category = decoded[identityIndex - 1]?.toLowerCase();
  const categoryRoute = category !== undefined && routeCategorySegments.has(category);
  const rootReleaseRoute = identityIndex === 0 && release !== undefined;
  if (!categoryRoute && !rootReleaseRoute) {
    return release === undefined ? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED')
      : (bookmarkTitleReleaseEvidence(input, url, release) ?? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED'));
  }
  const mediaKind = category === undefined ? 'UNKNOWN' : (categoryKinds[category] ?? 'UNKNOWN');
  const title = displayTitle(stableSlug);
  const proofs: SourceEvidence['proofs'] = [
    ...(category !== undefined && routeCategorySegments.has(category) ? ['CATEGORY_PATH'] as const : []),
    'TITLE_SLUG',
    ...(release?.provenance === 'URL_PATH' ? ['RELEASE_PATH'] as const : []),
    ...(release?.provenance === 'URL_SLUG_SUFFIX' ? ['RELEASE_SUFFIX'] as const : []),
  ];
  const evidence = {
    ...common(input, url),
    aliases: [{ provenance: 'stable-url-slug', value: title }],
    canonicalUrl: `${url.origin}/${raw.slice(0, identityIndex + 1).join('/')}`,
    diagnostics: [],
    key: input.sourceKey,
    mediaKind,
    proofs,
    rawSlug: observedSlug,
    sourceAdapter: structuralIdentity.transformed ? 'generic-url-structural-v1' : 'generic-url',
    stableSlug,
    strategy: 'generic',
    title,
  } as const;
  const transformedEvidence = structuralIdentity.transformed
    ? { ...evidence, identityTransformations: ['numeric-routing-prefix'] as const }
    : evidence;
  if (release === undefined) return createSourceEvidence(transformedEvidence);
  if (releaseSuffix === undefined) return createSourceEvidence({ ...transformedEvidence, release });
  return createSourceEvidence({ ...transformedEvidence, release, releaseSuffix });
}

export function extractFavoriteSourceEvidence(input: FavoriteSourceEvidenceInput, adapters: readonly FavoriteSourceAdapter[] = []): SourceEvidence {
  const qualification = qualifyFavoriteUrl(input.url);
  if (qualification.kind === 'REJECTED') return rejectedEvidence(input, qualification.disposition);
  const applicable = adapters.filter((adapter) => adapter.origins.includes(qualification.origin));
  if (applicable.length > 1) {
    return createSourceEvidence({ ...common(input, qualification), aliases: [], diagnostics: ['SOURCE_ADAPTER_CONFLICT'], key: input.sourceKey, mediaKind: 'UNKNOWN', proofs: [], sourceAdapter: 'conflict', strategy: 'exact-origin' });
  }
  if (applicable.length === 1) {
    const adapter = applicable[0];
    if (adapter === undefined) return rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED');
    return adapter.analyze(input, qualification) ?? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED', adapter.id, 'exact-origin');
  }
  return genericEvidence(input, qualification);
}
