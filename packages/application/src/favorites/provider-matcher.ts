import { createResolutionDecision, favoriteAliasLimit, providerCandidateLimit } from '@tobirink/domain';
import type { FavoriteMatchMethod, ProviderCandidate, ProviderCandidateEnvelope, ProviderCandidateReference, ResolutionDecision } from '@tobirink/domain';
import { isWithinFavoriteEditDistance, normalizeFavoriteTitle } from './title-normalization';

export interface FavoriteTitleMatchQuery {
  readonly blockedTaxonomy?: readonly string[];
  readonly explicitProviderReference?: ProviderCandidateReference;
  readonly explicitSeason?: number;
  readonly mediaKind?: ProviderCandidate['mediaKind'];
  readonly preSerialization?: boolean;
  readonly sourceCanonicalUrl?: string;
  readonly sourceFormat?: string;
  readonly sourceTitles: readonly string[];
}

export type FavoriteTitleMatchOutcome = ResolutionDecision | Readonly<{ kind: 'INCOMPLETE_CANDIDATE_SET' }>;

interface PreparedTitle {
  readonly compact: string;
  readonly normalized: string;
  readonly significantKey: string;
}

interface PreparedCandidate {
  readonly candidate: ProviderCandidate;
  readonly titles: readonly PreparedTitle[];
}

const blockedGenres = Object.freeze(['Adult', 'Erotica', 'Hentai', 'Smut']);
const blockedCategories = Object.freeze(['18+', 'Adult', 'Erotica', 'Explicit Sex', 'Explicit Sexual Content', 'Graphic Sex', 'Hardcore', 'Hentai', 'Lolicon', 'Pornographic Content', 'Pornography', 'Sexual Content', 'Shotacon', 'Smut']);

function normalizedTaxonomy(value: string): string {
  return normalizeFavoriteTitle(value).normalized;
}

function hasExactBlockedTaxonomy(candidate: ProviderCandidate, additions: readonly string[]): boolean {
  const genres = new Set([...blockedGenres, ...additions].map(normalizedTaxonomy));
  const categories = new Set([...blockedCategories, ...additions].map(normalizedTaxonomy));
  return candidate.genres?.some((value) => genres.has(normalizedTaxonomy(value))) === true
    || candidate.categories?.some((value) => categories.has(normalizedTaxonomy(value))) === true;
}

function isOva(value?: string): boolean {
  return value !== undefined && normalizeFavoriteTitle(value).normalized === 'ova';
}

export function isProviderCandidateCompatible(query: FavoriteTitleMatchQuery, candidate: ProviderCandidate): boolean {
  if (query.mediaKind !== undefined && query.mediaKind !== candidate.mediaKind) return false;
  if (query.sourceFormat !== undefined && isOva(query.sourceFormat) !== isOva(candidate.format)) return false;
  if (query.preSerialization !== undefined && query.preSerialization !== candidate.preSerialization) return false;
  return !hasExactBlockedTaxonomy(candidate, query.blockedTaxonomy ?? []);
}

function prepare(value: string): PreparedTitle {
  const normalized = normalizeFavoriteTitle(value);
  if (normalized.compact.length === 0) throw new TypeError('titles must contain at least one letter or number.');
  return Object.freeze({
    compact: normalized.compact,
    normalized: normalized.normalized,
    significantKey: [...normalized.significantTokens].sort().join('\u0000'),
  });
}

function reference(candidate: ProviderCandidate): ProviderCandidateReference {
  return Object.freeze({ externalId: candidate.externalId, provider: candidate.provider });
}

function referenceKey(value: ProviderCandidateReference): string {
  return `${value.provider}:${value.externalId}`;
}

function matchingReferences(sourceTitles: readonly PreparedTitle[], candidates: readonly PreparedCandidate[], method: FavoriteMatchMethod): readonly ProviderCandidateReference[] {
  const matches = new Map<string, ProviderCandidateReference>();
  for (const item of candidates) {
    const matched = item.titles.some((candidateTitle) => sourceTitles.some((sourceTitle) => {
      if (method === 'ordered-exact') return sourceTitle.normalized === candidateTitle.normalized || sourceTitle.compact === candidateTitle.compact;
      if (method === 'reordered-significant-words') return sourceTitle.significantKey.length > 0 && sourceTitle.significantKey === candidateTitle.significantKey;
      return isWithinFavoriteEditDistance(sourceTitle.compact, candidateTitle.compact);
    }));
    if (matched) {
      const value = reference(item.candidate);
      matches.set(referenceKey(value), value);
    }
  }
  return Object.freeze([...matches.values()].sort((left, right) => referenceKey(left).localeCompare(referenceKey(right))));
}

function directReferences(query: FavoriteTitleMatchQuery, candidates: readonly PreparedCandidate[], method: Extract<FavoriteMatchMethod, 'source-id' | 'source-url'>): readonly ProviderCandidateReference[] {
  const matches = new Map<string, ProviderCandidateReference>();
  for (const item of candidates) {
    const matched = method === 'source-id'
      ? query.explicitProviderReference !== undefined && referenceKey(query.explicitProviderReference) === referenceKey(reference(item.candidate))
      : query.sourceCanonicalUrl !== undefined && item.candidate.canonicalUrl === query.sourceCanonicalUrl;
    if (matched) {
      const value = reference(item.candidate);
      matches.set(referenceKey(value), value);
    }
  }
  return Object.freeze([...matches.values()].sort((left, right) => referenceKey(left).localeCompare(referenceKey(right))));
}

function seasonReferences(sourceTitles: readonly PreparedTitle[], explicitSeason: number | undefined, candidates: readonly PreparedCandidate[]): readonly ProviderCandidateReference[] {
  if (explicitSeason === undefined) return Object.freeze([]);
  const seasonSuffix = new RegExp(`\\s+(?:saison|season)\\s*${explicitSeason}\\s*$`, 'iu');
  const compatible = candidates
    .filter((item) => item.candidate.season === explicitSeason)
    .map((item) => Object.freeze({ candidate: item.candidate, titles: Object.freeze(item.candidate.titles.map((title) => prepare(title.replace(seasonSuffix, '')))) }));
  return matchingReferences(sourceTitles, compatible, 'ordered-exact');
}

function decisionFor(method: FavoriteMatchMethod, references: readonly ProviderCandidateReference[], envelopes: readonly ProviderCandidateEnvelope[]): ResolutionDecision | undefined {
  if (references.length === 0) return undefined;
  if (references.length === 1) {
    const matchedReference = references[0];
    if (matchedReference === undefined) return undefined;
    return createResolutionDecision({ candidateReferences: references, kind: 'MATCH', level: method, matchedReference, reasons: ['unique-candidate-at-level'] }, envelopes);
  }
  return createResolutionDecision({ candidateReferences: references, kind: 'AMBIGUOUS', level: method, reasons: ['multiple-candidates-at-level'] }, envelopes);
}

export function matchFavoriteTitles(query: FavoriteTitleMatchQuery, envelopes: readonly ProviderCandidateEnvelope[]): FavoriteTitleMatchOutcome {
  if (query.sourceTitles.length === 0) throw new TypeError('sourceTitles must contain at least one title.');
  if (query.sourceTitles.length > favoriteAliasLimit) throw new RangeError(`sourceTitles accepts at most ${favoriteAliasLimit} titles.`);
  if (envelopes.length === 0) throw new TypeError('at least one provider envelope is required.');
  if (new Set(envelopes.map((envelope) => envelope.provider)).size !== envelopes.length) throw new TypeError('only one envelope per provider is allowed.');
  const candidateCount = envelopes.reduce((total, envelope) => total + envelope.candidates.length, 0);
  if (candidateCount > providerCandidateLimit) throw new RangeError(`matcher accepts at most ${providerCandidateLimit} candidates.`);
  if (envelopes.some((envelope) => !envelope.complete || envelope.truncated)) return Object.freeze({ kind: 'INCOMPLETE_CANDIDATE_SET' });
  if (query.explicitSeason !== undefined && (!Number.isSafeInteger(query.explicitSeason) || query.explicitSeason <= 0)) throw new TypeError('explicitSeason must be a positive safe integer.');
  if (query.sourceCanonicalUrl !== undefined) {
    const parsed = new URL(query.sourceCanonicalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('sourceCanonicalUrl must use HTTP(S).');
    query = { ...query, sourceCanonicalUrl: parsed.href };
  }

  const sourceTitles = Object.freeze(query.sourceTitles.map(prepare));
  const candidates = Object.freeze(envelopes.flatMap((envelope) => envelope.candidates).filter((candidate) => isProviderCandidateCompatible(query, candidate)).map((candidate) => Object.freeze({ candidate, titles: Object.freeze(candidate.titles.map(prepare)) })));
  const levels = [
    ['source-id', () => directReferences(query, candidates, 'source-id')],
    ['source-url', () => directReferences(query, candidates, 'source-url')],
    ['ordered-exact', () => matchingReferences(sourceTitles, candidates, 'ordered-exact')],
    ['explicit-season', () => seasonReferences(sourceTitles, query.explicitSeason, candidates)],
    ['reordered-significant-words', () => matchingReferences(sourceTitles, candidates, 'reordered-significant-words')],
    ['bounded-edit-distance', () => matchingReferences(sourceTitles, candidates, 'bounded-edit-distance')],
  ] as const;
  for (const [method, findReferences] of levels) {
    const decision = decisionFor(method, findReferences(), envelopes);
    if (decision !== undefined) return decision;
  }
  return createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'bounded-edit-distance', reasons: ['no-candidate-at-any-level'] }, envelopes);
}
