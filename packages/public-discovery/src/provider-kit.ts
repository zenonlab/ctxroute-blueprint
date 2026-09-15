import { publicDiscoveryCandidateSchema, publicDiscoveryProviderSchema } from './contracts.js';
import type { PublicDiscoveryCandidate, PublicDiscoveryReferenceV3 } from './contracts.js';

export type FavoriteProvider = PublicDiscoveryReferenceV3['provider'];
export type ResolutionProvider = FavoriteProvider;
export type FavoriteMediaKind = PublicDiscoveryCandidate['mediaKind'] | 'UNKNOWN';
export type ProviderCandidate = PublicDiscoveryCandidate;
export type FavoriteProviderReference = PublicDiscoveryReferenceV3;

export interface ProviderCandidateEnvelope {
  readonly candidates: readonly ProviderCandidate[];
  readonly complete: boolean;
  readonly digest: string;
  readonly nextCursor?: string;
  readonly provider: FavoriteProvider;
  readonly truncated: boolean;
}

export interface FavoriteProviderSearchQuery {
  readonly cursor?: string;
  readonly explicitProviderReference?: FavoriteProviderReference;
  readonly limit: number;
  readonly provider: ResolutionProvider;
  readonly titles: readonly string[];
}

export interface FavoriteProviderCandidatePort {
  search(query: FavoriteProviderSearchQuery): Promise<ProviderCandidateEnvelope>;
}

export interface FavoriteProviderHydrationPort {
  hydrate(reference: FavoriteProviderReference): Promise<ProviderCandidate | undefined>;
}

export type FavoriteProviderPort = FavoriteProviderCandidatePort & FavoriteProviderHydrationPort;
export const favoriteProviderInspectionLimit = 25;
export const favoriteProviderPolicy = Object.freeze({
  anilist: Object.freeze({ minimumIntervalMs: 2_200 }),
  'kitsu-anime': Object.freeze({ minimumIntervalMs: 1_000 }),
  'kitsu-manga': Object.freeze({ minimumIntervalMs: 1_000 }),
  mangadex: Object.freeze({ minimumIntervalMs: 1_000 }),
  mangaupdates: Object.freeze({ minimumIntervalMs: 3_000 }),
  requestTimeoutMs: 8_000,
});

export class FavoriteProviderRetryError extends Error {
  constructor(message: string, readonly retryAt: number) { super(message); }
}

export function assertFavoriteProviderSearchQuery(query: FavoriteProviderSearchQuery): FavoriteProviderSearchQuery {
  publicDiscoveryProviderSchema.parse(query.provider);
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 20) throw new RangeError('provider search limit must be between 1 and 20');
  if (query.titles.length < 1 || query.titles.length > 4 || query.titles.some((title) => title.trim().length === 0 || title.length > 200)) {
    throw new TypeError('provider search requires one to four bounded titles');
  }
  if (query.explicitProviderReference !== undefined && query.explicitProviderReference.provider !== query.provider) throw new TypeError('provider reference mismatch');
  return Object.freeze({ ...query, titles: Object.freeze([...query.titles]) });
}

export function favoriteProviderPage(cursor?: string): number {
  if (cursor === undefined) return 1;
  if (!/^[1-9]\d{0,4}$/u.test(cursor)) throw new TypeError('provider cursor must be a bounded positive integer');
  return Number(cursor);
}

export function createProviderCandidate(input: ProviderCandidate, provider: FavoriteProvider): ProviderCandidate {
  if (input.provider !== provider) throw new TypeError('candidate provider mismatch');
  if (input.cover !== undefined) {
    const allowedHosts: Readonly<Record<FavoriteProvider, readonly string[]>> = {
      anilist: ['s4.anilist.co'],
      mangaupdates: ['cdn.mangaupdates.com'],
      mangadex: ['uploads.mangadex.org'],
      'kitsu-anime': ['media.kitsu.app'],
      'kitsu-manga': ['media.kitsu.app'],
    };
    if (!allowedHosts[provider].includes(new URL(input.cover.url).hostname)) throw new TypeError(`cover origin is not allowed for ${provider}`);
  }
  return Object.freeze(publicDiscoveryCandidateSchema.parse(input));
}

export function createProviderCandidateEnvelope(input: ProviderCandidateEnvelope): ProviderCandidateEnvelope {
  if (input.candidates.length > 20) throw new RangeError('provider envelope exceeds twenty candidates');
  if (input.complete && (input.truncated || input.nextCursor !== undefined)) throw new TypeError('complete envelope cannot be truncated');
  if (input.digest.length === 0 || input.digest.length > 128) throw new TypeError('provider digest is invalid');
  return Object.freeze({ ...input, candidates: Object.freeze(input.candidates.map((candidate) => createProviderCandidate(candidate, input.provider))) });
}

export type MatchLevel = 'source-id' | 'ordered-exact' | 'reordered-significant-words' | 'bounded-edit-distance';
export interface FavoriteTitleMatchQuery {
  readonly explicitProviderReference?: FavoriteProviderReference;
  readonly mediaKind?: ProviderCandidate['mediaKind'];
  readonly preSerialization?: boolean;
  readonly sourceTitles: readonly string[];
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}+/gu, '').toLocaleLowerCase('en-US').replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
}

function compact(value: string): string { return normalize(value).replaceAll(' ', ''); }
function tokens(value: string): string { return [...new Set(normalize(value).split(' ').filter(Boolean))].sort().join(' '); }

function boundedDistance(left: string, right: string): boolean {
  if (left === right) return true;
  const bound = left.length < 8 || right.length < 8 ? 1 : 2;
  if (Math.abs(left.length - right.length) > bound) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const value = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      current.push(value); rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > bound) return false;
    previous = current;
  }
  return (previous[right.length] ?? bound + 1) <= bound;
}

function compatible(query: FavoriteTitleMatchQuery, candidate: ProviderCandidate): boolean {
  if (query.preSerialization !== undefined && query.preSerialization !== candidate.preSerialization) return false;
  if (query.mediaKind === undefined || query.mediaKind === candidate.mediaKind) return true;
  return query.mediaKind !== 'ANIME' && candidate.mediaKind !== 'ANIME';
}

export function inspectFavoriteTitleCandidates(query: FavoriteTitleMatchQuery, candidates: readonly ProviderCandidate[]): Readonly<{ candidateReferences: readonly FavoriteProviderReference[]; level: MatchLevel }> {
  if (query.sourceTitles.length < 1 || query.sourceTitles.length > 16) throw new TypeError('matching requires one to sixteen source titles');
  if (candidates.length > favoriteProviderInspectionLimit) throw new RangeError('candidate inspection exceeds twenty-five candidates');
  const eligible = candidates.filter((candidate) => compatible(query, candidate));
  const explicit = query.explicitProviderReference === undefined ? [] : eligible.filter((candidate) => candidate.provider === query.explicitProviderReference?.provider && candidate.externalId === query.explicitProviderReference.externalId);
  const sourceCompact = query.sourceTitles.map(compact).filter(Boolean);
  const sourceTokens = query.sourceTitles.map(tokens).filter(Boolean);
  const levels: readonly [MatchLevel, (candidate: ProviderCandidate) => boolean][] = [
    ['source-id', (candidate) => explicit.includes(candidate)],
    ['ordered-exact', (candidate) => candidate.titles.some((title) => sourceCompact.includes(compact(title)))],
    ['reordered-significant-words', (candidate) => candidate.titles.some((title) => sourceTokens.includes(tokens(title)))],
    ['bounded-edit-distance', (candidate) => candidate.titles.some((title) => sourceCompact.some((source) => boundedDistance(source, compact(title))))],
  ];
  for (const [level, matches] of levels) {
    const references = eligible.filter(matches).map(({ provider, externalId }) => ({ provider, externalId }));
    const unique = [...new Map(references.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
    if (unique.length > 0) return Object.freeze({ candidateReferences: Object.freeze(unique), level });
  }
  return Object.freeze({ candidateReferences: Object.freeze([]), level: 'bounded-edit-distance' });
}
