import { createFavoriteParseArtifact } from '@tobirink/domain';
import type { FavoriteAliasProvenance, FavoriteObservation, FavoriteParseArtifact, FavoriteTransformation, SourceEvidence } from '@tobirink/domain';
import { extractFavoriteProgression } from './progression-extraction';
import { extractFavoriteSeason } from './season-extraction';
import { normalizeFavoriteTitle, readSafeParenthesizedFavoriteTitle } from './title-normalization';
import { segmentFavoriteTitle } from './title-segmentation';
import type { FavoriteTitleAnalysis } from './title-segmentation';
import { favoriteMatcherVersion } from './provider-matcher';

export const favoriteParserVersion = 'favorite-parser-v5';
interface MutableFavoriteAlias { provenance: FavoriteAliasProvenance; value: string }

function fingerprint(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  const framed = parts.map((part) => `${new TextEncoder().encode(part).length}:${part}`).join('|');
  for (const byte of new TextEncoder().encode(framed)) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

function hostname(evidence: SourceEvidence): string | undefined {
  if (evidence.origin === undefined) return undefined;
  return new URL(evidence.origin).hostname;
}

function containsRelease(value: string): boolean {
  return /\b(?:chapter|chapitre|ch|episode|ep|volume|vol)\s*[-:#.]?\s*\d/iu.test(value) || /\b\d+(?:[.,]\d+)?\s+(?:vostfr|vf|vo|sub|dub)\b/iu.test(value);
}

function containsRoutingIdentifier(value: string, evidence: SourceEvidence): boolean {
  if ((evidence.identityTransformations?.length ?? 0) === 0 || evidence.rawSlug === undefined) return false;
  const attachedRelease = /^(.+?)[-_](?:chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_]?\d+(?:[.,]\d+)?$/iu.exec(evidence.rawSlug);
  const identitySlug = evidence.releaseSuffix === undefined ? evidence.rawSlug : (attachedRelease?.[1] ?? evidence.rawSlug);
  const rawSlugTitle = identitySlug.replace(/[-_.]+/gu, ' ').trim();
  return normalizeFavoriteTitle(value).compact === normalizeFavoriteTitle(rawSlugTitle).compact;
}

function uniqueHumanSegments(analysis: FavoriteTitleAnalysis): readonly string[] {
  return [...new Map(analysis.segments
    .filter((segment) => !segment.excluded)
    .map((segment) => [normalizeFavoriteTitle(segment.cleaned).normalized, segment.cleaned] as const)).values()];
}

function alignedHumanSegment(slug: string, analysis: FavoriteTitleAnalysis): string | undefined {
  if (analysis.segments.length < 2) return undefined;
  const slugKey = normalizeFavoriteTitle(slug.replace(/[-_.]+/gu, ' ')).compact;
  const matches = uniqueHumanSegments(analysis).filter((segment) => normalizeFavoriteTitle(segment).compact === slugKey);
  return matches.length === 1 ? matches[0] : undefined;
}

function identityFrom(evidence: SourceEvidence, titleAnalysis: FavoriteTitleAnalysis, transformations: FavoriteTransformation[]): string | undefined {
  if (evidence.disposition !== undefined) return undefined;
  const slug = evidence.stableSlug ?? evidence.title;
  if (slug === undefined) return undefined;
  const slugTitle = slug.replace(/[-_.]+/gu, ' ').trim();
  const alignedHuman = alignedHumanSegment(slug, titleAnalysis);
  const humanSegments = uniqueHumanSegments(titleAnalysis);
  const human = alignedHuman ?? titleAnalysis.cleanedTitle.trim();
  const slugParts = slug.split(/[-_.]+/u).filter(Boolean);
  const opaqueToken = (value: string) => value.length >= 6 && /^[\p{L}\d]+$/u.test(value) && /\p{L}/u.test(value) && /\d/u.test(value)
    && !/^(?=.*\p{L}{4,})(?=.*\d{1,2}$)[\p{L}\d]+$/u.test(value);
  const opaque = /^[a-f\d]{8,}$/iu.test(slug.replace(/[-_.]/gu, '')) || opaqueToken(slug)
    || (slugParts.length > 1 && slugParts.slice(0, -1).every((part) => /^\p{L}{2,16}$/u.test(part)) && opaqueToken(slugParts.at(-1) ?? ''));
  if (opaque) {
    const corroboratedHuman = alignedHuman ?? (humanSegments.length === 1 ? humanSegments[0] : undefined);
    if (corroboratedHuman === undefined || normalizeFavoriteTitle(corroboratedHuman).compact === normalizeFavoriteTitle(slugTitle).compact) return undefined;
    transformations.push('opaque-url-slug-replaced'); return corroboratedHuman;
  }
  const bracket = human.match(/\[([^\]]+)\]\s*$/u)?.[1];
  let reconciled = alignedHuman ?? slugTitle;
  const withoutPrefix = reconciled.replace(/^\d+\s+(?:vostfr|vf|vo|sub|dub)\s+/iu, '');
  if (withoutPrefix !== reconciled && normalizeFavoriteTitle(withoutPrefix).compact.includes(normalizeFavoriteTitle(human.replace(/\s*\[[^\]]+\]\s*$/u, '')).compact)) {
    reconciled = withoutPrefix; transformations.push('numeric-routing-prefix', 'language-marker');
  }
  if (bracket !== undefined && normalizeFavoriteTitle(reconciled).normalized.endsWith(normalizeFavoriteTitle(bracket).normalized)) {
    reconciled = reconciled.slice(0, Math.max(0, reconciled.length - bracket.length)).trim(); transformations.push('reader-brand-suffix');
  }
  const numericPrefix = reconciled.match(/^(\d+)\s+(.+)$/u);
  if (numericPrefix !== null && !normalizeFavoriteTitle(human).normalized.startsWith(`${numericPrefix[1]} `) && normalizeFavoriteTitle(numericPrefix[2] ?? '').compact === normalizeFavoriteTitle(human).compact) {
    reconciled = numericPrefix[2] ?? reconciled; transformations.push('numeric-routing-prefix');
  }
  const routingTransformations = evidence.identityTransformations ?? [];
  let corroboratingHuman = human;
  if (routingTransformations.includes('numeric-routing-prefix')) corroboratingHuman = corroboratingHuman.replace(/^\d{6,12}\s+/u, '');
  if (routingTransformations.includes('numeric-routing-suffix')) corroboratingHuman = corroboratingHuman.replace(/\s+0\d{2,4}$/u, '');
  if (routingTransformations.length > 0 && normalizeFavoriteTitle(reconciled).compact === normalizeFavoriteTitle(corroboratingHuman).compact) return corroboratingHuman;
  return reconciled;
}

export function parseFavoriteObservation(observation: FavoriteObservation, evidence: SourceEvidence, sourceAdapterVersion = `source-adapter-v3:${evidence.sourceAdapter}`): FavoriteParseArtifact {
  const titleAnalysis = segmentFavoriteTitle(observation.title, hostname(evidence));
  const seasonEvidence = extractFavoriteSeason(observation.title, evidence);
  const transformations = [...titleAnalysis.transformations, ...(evidence.identityTransformations ?? [])];
  const identity = identityFrom(evidence, titleAnalysis, transformations);
  const structuredCleanedTitle = readSafeParenthesizedFavoriteTitle(titleAnalysis.cleanedTitle);
  const displayIdentity = identity !== undefined && structuredCleanedTitle !== undefined
    && normalizeFavoriteTitle(identity).compact === normalizeFavoriteTitle(titleAnalysis.cleanedTitle).compact
    ? titleAnalysis.cleanedTitle.trim()
    : identity;
  const diagnostics = [...evidence.diagnostics];
  if (identity === undefined) diagnostics.push(evidence.rawSlug === undefined ? 'URL_IDENTITY_MISSING' : 'OPAQUE_IDENTITY_UNCORROBORATED');
  const aliases: MutableFavoriteAlias[] = identity === undefined || containsRelease(identity) ? [] : [{ provenance: 'stable-url-slug', value: identity }];
  const cleanedTitle = titleAnalysis.cleanedTitle.trim();
  const structuredTitle = structuredCleanedTitle;
  if (identity !== undefined && !containsRelease(cleanedTitle) && !containsRoutingIdentifier(cleanedTitle, evidence)
    && (normalizeFavoriteTitle(identity).compact !== normalizeFavoriteTitle(cleanedTitle).compact || structuredTitle !== undefined)) aliases.push({ provenance: 'aligned-bookmark-segment', value: cleanedTitle });
  if (structuredTitle !== undefined && identity !== undefined && !containsRelease(identity)) {
    aliases.push({ provenance: 'parenthesized-base', value: structuredTitle.base });
    aliases.push({ provenance: 'parenthesized-alternate', value: structuredTitle.alternate });
  }
  const uniqueAliases = [...new Map(aliases.map((alias) => [`${alias.provenance}:${normalizeFavoriteTitle(alias.value).normalized}`, alias] as const)).values()];
  const progression = extractFavoriteProgression({ aliases: uniqueAliases.map((alias) => alias.value), evidence, mediaKind: evidence.mediaKind, season: seasonEvidence, title: observation.title, titleAnalysis });
  const artifactInput = {
    aliases: uniqueAliases,
    contractVersion: 2 as const,
    diagnostics,
    mediaKind: evidence.mediaKind,
    matcherVersion: favoriteMatcherVersion,
    parserVersion: favoriteParserVersion,
    progressionParserVersion: 'favorite-progression-v2',
    raw: { title: observation.title, url: observation.url },
    seasonEvidence,
    segments: titleAnalysis.segments,
    semanticFingerprint: fingerprint([observation.title, observation.url, favoriteParserVersion, favoriteMatcherVersion, sourceAdapterVersion]),
    sourceAdapterVersion,
    sourceEvidence: evidence,
    status: identity === undefined ? 'identity-missing' as const : 'parsed' as const,
    transformations,
  };
  if (displayIdentity !== undefined) Object.assign(artifactInput, { displayTitle: displayIdentity, identityKey: normalizeFavoriteTitle(displayIdentity).normalized });
  if (progression !== undefined) Object.assign(artifactInput, { progress: progression });
  if (seasonEvidence.canonicalSeason !== undefined) Object.assign(artifactInput, { season: seasonEvidence.canonicalSeason });
  if (titleAnalysis.year !== undefined) Object.assign(artifactInput, { year: titleAnalysis.year });
  return createFavoriteParseArtifact(artifactInput);
}
