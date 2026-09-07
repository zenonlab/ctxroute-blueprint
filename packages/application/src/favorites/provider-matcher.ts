import { createResolutionDecision, favoriteAliasLimit, providerCandidateLimit } from '@tobirink/domain';
import type { FavoriteMatchMethod, ProviderCandidate, ProviderCandidateEnvelope, ProviderCandidateReference, ResolutionDecision } from '@tobirink/domain';
import { isWithinFavoriteEditDistance, normalizeFavoriteTitle } from './title-normalization';

export interface FavoriteTitleMatchQuery {
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

  const sourceTitles = Object.freeze(query.sourceTitles.map(prepare));
  const candidates = Object.freeze(envelopes.flatMap((envelope) => envelope.candidates).map((candidate) => Object.freeze({ candidate, titles: Object.freeze(candidate.titles.map(prepare)) })));
  for (const method of ['ordered-exact', 'reordered-significant-words', 'bounded-edit-distance'] as const) {
    const decision = decisionFor(method, matchingReferences(sourceTitles, candidates, method), envelopes);
    if (decision !== undefined) return decision;
  }
  return createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'bounded-edit-distance', reasons: ['no-candidate-at-any-level'] }, envelopes);
}
