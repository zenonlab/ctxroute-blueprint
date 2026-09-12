import { createFavoriteParseArtifact } from '@tobirink/domain';
import type { FavoriteObservation, FavoriteParseArtifact, FavoriteTransformation, SourceEvidence } from '@tobirink/domain';
import { extractFavoriteProgression } from './progression-extraction';
import { extractFavoriteSeason } from './season-extraction';
import { normalizeFavoriteTitle } from './title-normalization';
import { segmentFavoriteTitle } from './title-segmentation';
import { favoriteMatcherVersion } from './provider-matcher';

export const favoriteParserVersion = 'favorite-parser-v3';
interface MutableFavoriteAlias { provenance: 'aligned-bookmark-segment' | 'stable-url-slug'; value: string }

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

function identityFrom(evidence: SourceEvidence, cleanedTitle: string, transformations: FavoriteTransformation[]): string | undefined {
  if (evidence.disposition !== undefined) return undefined;
  const slug = evidence.stableSlug ?? evidence.title;
  if (slug === undefined) return undefined;
  const human = cleanedTitle.trim();
  const slugTitle = slug.replace(/[-_.]+/gu, ' ').trim();
  const opaque = /^[a-f\d]{8,}$/iu.test(slug.replace(/[-_.]/gu, ''));
  if (opaque) {
    if (human.length === 0 || normalizeFavoriteTitle(human).compact === normalizeFavoriteTitle(slugTitle).compact) return undefined;
    transformations.push('opaque-url-slug-replaced'); return human;
  }
  const bracket = human.match(/\[([^\]]+)\]\s*$/u)?.[1];
  let reconciled = slugTitle;
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
  return reconciled;
}

export function parseFavoriteObservation(observation: FavoriteObservation, evidence: SourceEvidence, sourceAdapterVersion = `source-adapter-v3:${evidence.sourceAdapter}`): FavoriteParseArtifact {
  const titleAnalysis = segmentFavoriteTitle(observation.title, hostname(evidence));
  const seasonEvidence = extractFavoriteSeason(observation.title, evidence);
  const transformations = [...titleAnalysis.transformations];
  const identity = identityFrom(evidence, titleAnalysis.cleanedTitle, transformations);
  const diagnostics = [...evidence.diagnostics];
  if (identity === undefined) diagnostics.push(evidence.rawSlug === undefined ? 'URL_IDENTITY_MISSING' : 'OPAQUE_IDENTITY_UNCORROBORATED');
  const aliases: MutableFavoriteAlias[] = identity === undefined || containsRelease(identity) ? [] : [{ provenance: 'stable-url-slug', value: identity }];
  if (identity !== undefined && !containsRelease(titleAnalysis.cleanedTitle) && normalizeFavoriteTitle(identity).compact !== normalizeFavoriteTitle(titleAnalysis.cleanedTitle).compact) aliases.push({ provenance: 'aligned-bookmark-segment', value: titleAnalysis.cleanedTitle });
  const progression = extractFavoriteProgression({ aliases: aliases.map((alias) => alias.value), evidence, mediaKind: evidence.mediaKind, season: seasonEvidence, title: observation.title, titleAnalysis });
  const artifactInput = {
    aliases,
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
  if (identity !== undefined) Object.assign(artifactInput, { displayTitle: identity, identityKey: normalizeFavoriteTitle(identity).normalized });
  if (progression !== undefined) Object.assign(artifactInput, { progress: progression });
  if (seasonEvidence.canonicalSeason !== undefined) Object.assign(artifactInput, { season: seasonEvidence.canonicalSeason });
  if (titleAnalysis.year !== undefined) Object.assign(artifactInput, { year: titleAnalysis.year });
  return createFavoriteParseArtifact(artifactInput);
}
