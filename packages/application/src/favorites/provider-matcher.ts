import { createResolutionDecision, favoriteAliasLimit, providerCandidateLimit } from '@tobirink/domain';
import type { FavoriteMatchMethod, ProviderCandidate, ProviderCandidateEnvelope, ProviderCandidateReference, ResolutionDecision } from '@tobirink/domain';
import { isWithinFavoriteEditDistance, normalizeFavoriteTitle, readSafeParenthesizedFavoriteTitle } from './title-normalization';
import { readLabelledFavoriteSeason, stripFavoriteSeasonSuffix } from './season-extraction';

export const favoriteMatcherVersion = 'favorite-matcher-v4';
export const favoriteProviderInspectionLimit = 25;

export interface FavoriteTitleMatchQuery {
  readonly blockedTaxonomy?: readonly string[];
  readonly discoveryTitles?: readonly string[];
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
  readonly numbers: string;
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

export function hasExactBlockedProviderTaxonomy(candidate: ProviderCandidate, additions: readonly string[] = []): boolean {
  const genres = new Set([...blockedGenres, ...additions].map(normalizedTaxonomy));
  const categories = new Set([...blockedCategories, ...additions].map(normalizedTaxonomy));
  return candidate.genres?.some((value) => genres.has(normalizedTaxonomy(value))) === true
    || candidate.categories?.some((value) => categories.has(normalizedTaxonomy(value))) === true;
}

function isOva(value?: string): boolean {
  return value !== undefined && normalizeFavoriteTitle(value).normalized === 'ova';
}

export function isProviderCandidateCompatible(query: FavoriteTitleMatchQuery, candidate: ProviderCandidate): boolean {
  if (query.mediaKind !== undefined && query.mediaKind !== candidate.mediaKind) {
    const mangaFamily = query.mediaKind === 'MANGA' && candidate.mediaKind !== 'ANIME';
    const kitsuManga = query.mediaKind !== 'ANIME' && candidate.provider === 'kitsu-manga' && candidate.mediaKind === 'MANGA';
    if (!mangaFamily && !kitsuManga) return false;
  }
  if (query.sourceFormat !== undefined && isOva(query.sourceFormat) !== isOva(candidate.format)) return false;
  if (query.preSerialization !== undefined && query.preSerialization !== candidate.preSerialization) return false;
  return true;
}

function prepare(value: string): PreparedTitle {
  const normalized = normalizeFavoriteTitle(value);
  if (normalized.compact.length === 0) throw new TypeError('titles must contain at least one letter or number.');
  return Object.freeze({
    compact: normalized.compact,
    normalized: normalized.normalized,
    significantKey: [...normalized.significantTokens].sort().join('\u0000'),
    numbers: (normalized.normalized.match(/\d+/gu) ?? []).join('|'),
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
      if (sourceTitle.numbers !== candidateTitle.numbers) return false;
      return isWithinFavoriteEditDistance(sourceTitle.compact, candidateTitle.compact);
    }));
    if (matched) {
      const value = reference(item.candidate);
      matches.set(referenceKey(value), value);
    }
  }
  return Object.freeze([...matches.values()].sort((left, right) => referenceKey(left).localeCompare(referenceKey(right))));
}

function exactPrimaryReferences(primarySourceTitle: string, candidates: readonly PreparedCandidate[]): readonly ProviderCandidateReference[] {
  const source = prepare(primarySourceTitle);
  return matchingReferences([source], candidates, 'ordered-exact');
}

function parenthesizedExactReferences(sourceTitles: readonly PreparedTitle[], candidates: readonly PreparedCandidate[]): readonly ProviderCandidateReference[] {
  const expanded = candidates.map((item) => {
    const baseTitles = item.candidate.titles.flatMap((title) => {
      const value = readSafeParenthesizedFavoriteTitle(title);
      return value === undefined ? [] : [prepare(value.base)];
    });
    return Object.freeze({ candidate: item.candidate, titles: Object.freeze([...item.titles, ...baseTitles]) });
  });
  return matchingReferences(sourceTitles, expanded, 'ordered-exact');
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
  const compatible = candidates
    .filter((item) => corroboratesSeason(item.candidate, explicitSeason))
    .map((item) => Object.freeze({ candidate: item.candidate, titles: Object.freeze(item.candidate.titles.map((title) => stripFavoriteSeasonSuffix(title, explicitSeason)).filter((title) => title.length > 0).map(prepare)) }));
  const source = sourceTitles.map((title) => stripFavoriteSeasonSuffix(title.normalized, explicitSeason)).filter((title) => title.length > 0).map(prepare);
  return matchingReferences(source, compatible, 'ordered-exact');
}

function corroboratesSeason(candidate: ProviderCandidate, season: number): boolean {
  if (candidate.season !== undefined) return candidate.season === season;
  const seasons = new Set(candidate.titles.map(readLabelledFavoriteSeason).filter((value) => value !== undefined));
  return seasons.size === 1 && seasons.has(season);
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
  if (envelopes.length === 0) throw new TypeError('at least one provider envelope is required.');
  if (new Set(envelopes.map((envelope) => envelope.provider)).size !== envelopes.length) throw new TypeError('only one envelope per provider is allowed.');
  const candidateCount = envelopes.reduce((total, envelope) => total + envelope.candidates.length, 0);
  if (candidateCount > providerCandidateLimit) throw new RangeError(`matcher accepts at most ${providerCandidateLimit} candidates.`);
  if (envelopes.some((envelope) => !envelope.complete || envelope.truncated)) return Object.freeze({ kind: 'INCOMPLETE_CANDIDATE_SET' });
  const evidence = inspectFavoriteTitleCandidates(query, envelopes.flatMap((envelope) => envelope.candidates));
  return decisionFor(evidence.level, evidence.candidateReferences, envelopes)
    ?? createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'bounded-edit-distance', reasons: ['no-candidate-at-any-level'] }, envelopes);
}

export function inspectFavoriteTitleCandidates(query: FavoriteTitleMatchQuery, input: readonly ProviderCandidate[]): Readonly<{ level: FavoriteMatchMethod; candidateReferences: readonly ProviderCandidateReference[] }> {
  if (query.sourceTitles.length === 0) throw new TypeError('sourceTitles must contain at least one title.');
  if (query.sourceTitles.length > favoriteAliasLimit) throw new RangeError(`sourceTitles accepts at most ${favoriteAliasLimit} titles.`);
  if (query.discoveryTitles !== undefined && (query.discoveryTitles.length === 0 || query.discoveryTitles.length > 4)) throw new RangeError('discoveryTitles accepts between 1 and 4 titles.');
  if (input.length > favoriteProviderInspectionLimit) throw new RangeError(`candidate inspection accepts at most ${favoriteProviderInspectionLimit} candidates.`);
  if (query.explicitSeason !== undefined && (!Number.isSafeInteger(query.explicitSeason) || query.explicitSeason <= 0)) throw new TypeError('explicitSeason must be a positive safe integer.');
  if (query.sourceCanonicalUrl !== undefined) {
    const parsed = new URL(query.sourceCanonicalUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('sourceCanonicalUrl must use HTTP(S).');
    query = { ...query, sourceCanonicalUrl: parsed.href };
  }

  const sourceTitles = Object.freeze(query.sourceTitles.map(prepare));
  const candidates = Object.freeze(input.filter((candidate) => isProviderCandidateCompatible(query, candidate)).map((candidate) => Object.freeze({ candidate, titles: Object.freeze(candidate.titles.map(prepare)) })));
  const explicitSeason = query.explicitSeason;
  const titleCandidates = explicitSeason === undefined ? candidates : candidates.filter((item) => corroboratesSeason(item.candidate, explicitSeason));
  const exactPrimary = readSafeParenthesizedFavoriteTitle(query.sourceTitles[0] ?? '') === undefined
    ? Object.freeze([])
    : exactPrimaryReferences(query.sourceTitles[0] ?? '', titleCandidates);
  const levels = [
    ['source-id', () => directReferences(query, candidates, 'source-id')],
    ['source-url', () => directReferences(query, candidates, 'source-url')],
    ['ordered-exact', () => exactPrimary.length > 0 ? exactPrimary : parenthesizedExactReferences(sourceTitles, titleCandidates)],
    ['explicit-season', () => seasonReferences(sourceTitles, query.explicitSeason, candidates)],
    ['reordered-significant-words', () => matchingReferences(sourceTitles, titleCandidates, 'reordered-significant-words')],
    ['bounded-edit-distance', () => matchingReferences(sourceTitles, titleCandidates, 'bounded-edit-distance')],
  ] as const;
  for (const [method, findReferences] of levels) {
    const candidateReferences = findReferences();
    if (candidateReferences.length > 0) return Object.freeze({ candidateReferences, level: method });
  }
  return Object.freeze({ candidateReferences: [], level: 'bounded-edit-distance' });
}
