import { createSourceEvidence } from '@tobirink/domain';
import type { FavoriteMediaKind, FavoriteUrlDisposition, SourceEvidence } from '@tobirink/domain';
import { qualifyFavoriteUrl } from './eligibility';
import type { EligibleFavoriteUrl } from './eligibility';
import { normalizeFavoriteTitle } from './title-normalization';
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
const releasePattern = /^(chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,-]\d+)?)$/iu;
const attachedReleasePattern = /^(.+?)[-_](chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,-]\d+)?)$/iu;
const numericReleasePattern = /^(\d{3,12})[-_.](chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,-]\d+)?)$/iu;
const localizedReleaseSuffixPattern = /(?:^|[-_.])(\d+(?:[.,]\d+)?)[-_.](?:vostfr|vf|vo|sub|dub)$/iu;
const titleIdentityOrigins = new Set(['https://www.adkami.com']);
const titleRouteOrigins = new Set(['https://mangakakalot.so', 'https://www.japscan.lol', 'https://www.japscan.me', 'https://arenascan.com']);

interface StructuralIdentity { readonly slug: string; readonly transformed: boolean }

function comparableIdentity(value: string): string {
  return normalizeFavoriteTitle(value).normalized;
}

function bookmarkCorroboratesSlug(observedTitle: string, stableSlug: string): boolean {
  const slugKey = comparableIdentity(stableSlug);
  return slugKey.length > 0 && segmentFavoriteTitle(observedTitle).segments
    .filter((segment) => !segment.excluded)
    .some((segment) => comparableIdentity(segment.cleaned) === slugKey);
}

function stripLeadingRoutingIdentifier(slug: string, release: SourceEvidence['release'], observedTitle: string): StructuralIdentity {
  if (release === undefined) return { slug, transformed: false };
  const match = /^(\d{6,12})[-_.]+(.+)$/u.exec(slug);
  const prefix = match?.[1];
  const remainder = match?.[2];
  if (prefix === undefined || remainder === undefined) return { slug, transformed: false };
  const candidates = [remainder, remainder.replace(/^[a-z]{2}[-_.]+/iu, '')];
  const humanKeys = segmentFavoriteTitle(observedTitle).segments
    .filter((segment) => !segment.excluded)
    .flatMap((segment) => {
      const value = segment.cleaned;
      return [comparableIdentity(value), comparableIdentity(value.replace(new RegExp(`^${prefix}[-_. ]+`, 'u'), ''))];
    });
  const corroborated = candidates.find((candidate) => humanKeys.includes(comparableIdentity(candidate)) && /\p{L}/u.test(candidate));
  return corroborated === undefined ? { slug, transformed: false } : { slug: corroborated, transformed: true };
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

function knownNumericRouteEvidence(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl): SourceEvidence | undefined {
  if (!titleIdentityOrigins.has(url.origin) || url.decodedSegments[0]?.toLowerCase() !== 'anime' || !/^\d+$/u.test(url.decodedSegments[1] ?? '')) return undefined;
  const title = segmentFavoriteTitle(input.title, new URL(url.origin).hostname).cleanedTitle.replace(/\s*[|·-]\s*episode$/iu, '').trim();
  if (!/\p{L}{2}/u.test(title) || /^(?:episode|épisode|watch|read)$/iu.test(title)) return undefined;
  return createSourceEvidence({
    ...common(input, url), aliases: [{ provenance: 'aligned-bookmark-segment', value: title }], diagnostics: [],
    mediaKind: 'ANIME', proofs: ['CATEGORY_PATH'], sourceAdapter: 'known-numeric-route-v1', strategy: 'exact-origin', title,
  });
}

function knownTitleRouteEvidence(input: FavoriteSourceEvidenceInput, url: EligibleFavoriteUrl): SourceEvidence | undefined {
  if (!titleRouteOrigins.has(url.origin)) return undefined;
  const segments = url.decodedSegments;
  const isJapScan = (url.origin === 'https://www.japscan.lol' || url.origin === 'https://www.japscan.me') && segments[0] === 'lecture-en-ligne';
  const isMangaKakalot = url.origin === 'https://mangakakalot.so' && segments[0] === 'reading';
  const isArenaScan = url.origin === 'https://arenascan.com' && (segments[0] === 'manga' || segments.length === 1);
  if (!isJapScan && !isMangaKakalot && !isArenaScan) return undefined;
  const rawSlug = isJapScan || isMangaKakalot ? segments[1] : segments[0] === 'manga' ? segments[1] : segments[0];
  if (rawSlug === undefined) return undefined;
  const stableSlug = isArenaScan ? rawSlug.replace(/-\d+(?:-\d+)?$/u, '') : rawSlug;
  if (stableSlug.length < 3 || !/\p{L}{2}/u.test(stableSlug) || !bookmarkCorroboratesSlug(input.title, stableSlug)) return undefined;
  const title = displayTitle(stableSlug);
  return createSourceEvidence({
    ...common(input, url), aliases: [{ provenance: 'stable-url-slug', value: title }], canonicalUrl: `${url.origin}/${(isJapScan || isMangaKakalot ? segments.slice(0, 2) : isArenaScan && segments[0] === 'manga' ? segments.slice(0, 2) : [stableSlug]).join('/')}`,
    diagnostics: [], mediaKind: 'MANGA', proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], rawSlug, sourceAdapter: 'known-title-route-v1', stableSlug, strategy: 'exact-origin', title,
  });
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
    release = { kind: releaseKind(label), provenance: 'URL_PATH', raw: releaseSuffix, value: Number(rawNumber.replace(/[,-]/gu, '.')) };
    identityIndex -= 2;
  }
  const numericRelease = numericReleasePattern.exec(decoded[identityIndex] ?? '');
  if (numericRelease !== null) {
    const label = numericRelease[2] ?? '';
    const rawNumber = numericRelease[3] ?? '';
    releaseSuffix = numericRelease[0];
    release = { kind: releaseKind(label), provenance: 'URL_PATH', raw: releaseSuffix, value: Number(rawNumber.replace(/[,-]/gu, '.')) };
    identityIndex -= 1;
  }
  const separated = releasePattern.exec(decoded[identityIndex] ?? '');
  if (separated !== null) {
    identityIndex -= 1;
    releaseSuffix = separated[0];
    release = { kind: releaseKind(separated[1] ?? ''), provenance: 'URL_PATH', raw: separated[0], value: Number((separated[2] ?? '').replace(/[,-]/gu, '.')) };
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
  const nestedNumericId = /^\d{1,12}$/u.test(decoded.at(-1) ?? '');
  const nestedCategory = decoded[decoded.length - 4]?.toLowerCase();
  const nestedRelease = /^(chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?(\d+(?:[.,-]\d+)?)(?:[-_].+)?$/iu.exec(decoded.at(-2) ?? '');
  if (nestedNumericId && nestedCategory !== undefined && categoryKinds[nestedCategory] !== undefined && nestedRelease !== null) {
    const label = nestedRelease[1] ?? '';
    const rawNumber = nestedRelease[2] ?? '';
    releaseSuffix = nestedRelease[0];
    release = { kind: releaseKind(label), provenance: 'URL_PATH', raw: releaseSuffix, value: Number(rawNumber.replace(/[,-]/gu, '.')) };
    identityIndex = decoded.length - 3;
  }
  const corroborated = decoded.slice(0, identityIndex + 1)
    .map((slug, index) => ({ slug, index }))
    .filter(({ slug }) => !structuralSegments.has(slug.toLowerCase()) && /\p{L}{2}/u.test(slug) && bookmarkCorroboratesSlug(input.title, slug));
  const compared = corroborated.length === 1 ? corroborated[0] : undefined;
  const comparativeRoute = compared !== undefined && compared.index < identityIndex;
  if (comparativeRoute) identityIndex = compared.index;
  const observedSlug = decoded[identityIndex];
  let stableSlug = observedSlug;
  const attached = attachedReleasePattern.exec(stableSlug ?? '');
  if (attached !== null) {
    stableSlug = attached[1];
    releaseSuffix = `${attached[2] ?? ''}-${attached[3] ?? ''}`;
    release = { kind: releaseKind(attached[2] ?? ''), provenance: 'URL_SLUG_SUFFIX', raw: releaseSuffix, value: Number((attached[3] ?? '').replace(/[,-]/gu, '.')) };
    raw[identityIndex] = encodeURIComponent(stableSlug ?? '');
  }
  const structuralIdentity = stableSlug === undefined
    ? { slug: '', transformed: false }
    : stripLeadingRoutingIdentifier(stableSlug, release, input.title);
  stableSlug = structuralIdentity.slug || stableSlug;
  const hasUnverifiedRoutingPrefix = stableSlug !== undefined
    && /^(?:\d{7,12}|\d{6}[-_.]+[a-z]{2}|[a-z]{2}\d{3,12})[-_.]+/iu.test(stableSlug)
    && !structuralIdentity.transformed;
  if (release !== undefined && hasUnverifiedRoutingPrefix) {
    return bookmarkTitleReleaseEvidence(input, url, release) ?? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED');
  }
  const normalizedSlug = stableSlug?.toLowerCase();
  if (stableSlug === undefined || observedSlug === undefined || normalizedSlug === undefined || /^\d+$/u.test(normalizedSlug) || structuralSegments.has(normalizedSlug)) {
    return release === undefined ? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED')
      : (bookmarkTitleReleaseEvidence(input, url, release) ?? rejectedEvidence(input, 'URL_IDENTITY_UNRESOLVED'));
  }
  const category = decoded[identityIndex - 1]?.toLowerCase();
  const categoryRoute = category !== undefined && routeCategorySegments.has(category);
  const rootReleaseRoute = identityIndex === 0 && release !== undefined;
  const boundedNumericReleaseRoute = identityIndex === 1
    && release !== undefined
    && /^\d{1,4}$/u.test(decoded[0] ?? '')
    && bookmarkCorroboratesSlug(input.title, stableSlug);
  const corroboratedUnknownRoute = bookmarkCorroboratesSlug(input.title, stableSlug)
    && /\p{L}{2}/u.test(stableSlug) && !hasUnverifiedRoutingPrefix;
  if (!categoryRoute && !rootReleaseRoute && !boundedNumericReleaseRoute && !corroboratedUnknownRoute) {
    const segments = segmentFavoriteTitle(input.title, new URL(url.origin).hostname).segments.filter(segment => !segment.excluded);
    if (release === undefined && input.title.trim() !== input.url && !/^https?:\/\//iu.test(input.title.trim()) && segments.length === 1 && /\p{L}{2}/u.test(segments[0]?.cleaned ?? '')) {
      const title = segments[0]?.cleaned ?? '';
      return createSourceEvidence({ ...common(input, url), aliases: [{ provenance: 'aligned-bookmark-segment', value: title }], diagnostics: [], mediaKind: 'UNKNOWN', proofs: [], sourceAdapter: 'generic-bookmark-query-v1', strategy: 'generic', title });
    }
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
    sourceAdapter: comparativeRoute ? 'generic-url-comparative-v1' : structuralIdentity.transformed ? 'generic-url-structural-v1'
      : !categoryRoute && !rootReleaseRoute && !boundedNumericReleaseRoute ? 'generic-url-corroborated-v1' : 'generic-url',
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
  const knownNumericRoute = knownNumericRouteEvidence(input, qualification);
  if (knownNumericRoute !== undefined) return knownNumericRoute;
  const knownTitleRoute = knownTitleRouteEvidence(input, qualification);
  if (knownTitleRoute !== undefined) return knownTitleRoute;
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
