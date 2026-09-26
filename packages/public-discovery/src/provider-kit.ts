import { publicDiscoveryCandidateSchema, publicDiscoveryProviderSchema } from './contracts';
import type { PublicDiscoveryCandidate, PublicDiscoveryReferenceV3 } from './contracts';

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
  anilist: Object.freeze({ minimumIntervalMs: 3_000 }),
  'kitsu-anime': Object.freeze({ minimumIntervalMs: 1_000 }),
  'kitsu-manga': Object.freeze({ minimumIntervalMs: 1_000 }),
  mangadex: Object.freeze({ minimumIntervalMs: 1_000 }),
  mangaupdates: Object.freeze({ minimumIntervalMs: 6_000 }),
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
    const allowedOrigins: Readonly<Record<FavoriteProvider, readonly string[]>> = {
      anilist: ['https://s4.anilist.co'],
      mangaupdates: ['https://cdn.mangaupdates.com'],
      mangadex: ['https://uploads.mangadex.org'],
      'kitsu-anime': ['https://media.kitsu.app'],
      'kitsu-manga': ['https://media.kitsu.app'],
    };
    const coverUrl = new URL(input.cover.url);
    if (coverUrl.protocol !== 'https:' || coverUrl.username !== '' || coverUrl.password !== '' || !allowedOrigins[provider].includes(coverUrl.origin)) {
      throw new TypeError(`cover origin is not allowed for ${provider}`);
    }
  }
  return Object.freeze(publicDiscoveryCandidateSchema.parse(input));
}

export function createProviderCandidateEnvelope(input: ProviderCandidateEnvelope): ProviderCandidateEnvelope {
  if (input.candidates.length > 20) throw new RangeError('provider envelope exceeds twenty candidates');
  if (input.complete && (input.truncated || input.nextCursor !== undefined)) throw new TypeError('complete envelope cannot be truncated');
  if (input.digest.length === 0 || input.digest.length > 128) throw new TypeError('provider digest is invalid');
  return Object.freeze({ ...input, candidates: Object.freeze(input.candidates.map((candidate) => createProviderCandidate(candidate, input.provider))) });
}

export type MatchLevel = 'source-id' | 'ordered-exact' | 'explicit-season' | 'reordered-significant-words' | 'bounded-edit-distance';
export interface FavoriteTitleMatchQuery {
  readonly explicitProviderReference?: FavoriteProviderReference;
  readonly explicitSeason?: number;
  readonly mediaKind?: ProviderCandidate['mediaKind'];
  readonly preSerialization?: boolean;
  readonly sourceFormat?: string;
  readonly sourceTitles: readonly string[];
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{Mark}+/gu, '').toLocaleLowerCase('en-US').replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim();
}

function compact(value: string): string { return normalize(value).replaceAll(' ', ''); }
function tokens(value: string): string { return [...new Set(normalize(value).split(' ').filter(Boolean))].sort().join(' '); }
const labelledSeason = /(?:\b(?:s|season|saison|temporada|stagione|staffel|seizoen|sesong|säsong|kausi|sezon|sezona|sezonas|сезон)[\s._-]*([1-9]\d?)\b)|(?:\b([1-9]\d?)(?:st|nd|rd|th|er|e|eme|ème)[\s._-]+season\b)/giu;

function titleSeason(value: string): number | undefined {
  let season: number | undefined;
  for (const match of value.matchAll(labelledSeason)) season = Number(match[1] ?? match[2]);
  return season;
}

function seasonTitle(value: string, season: number): string {
  const trimmed = value.trim();
  for (const match of trimmed.matchAll(labelledSeason)) {
    if (Number(match[1] ?? match[2]) === season && match.index + match[0].length === trimmed.length) return compact(trimmed.slice(0, match.index));
  }
  return compact(trimmed);
}

function corroboratesSeason(candidate: ProviderCandidate, season: number): boolean {
  if (candidate.season !== undefined) return candidate.season === season;
  const seasons = new Set(candidate.titles.map(titleSeason).filter((value) => value !== undefined));
  return seasons.size === 1 && seasons.has(season);
}

export function isFavoriteMediaKindCompatible(mediaKind: FavoriteMediaKind | undefined, candidateKind: ProviderCandidate['mediaKind']): boolean {
  return mediaKind === undefined || mediaKind === 'UNKNOWN' || mediaKind === candidateKind
    || mediaKind !== 'ANIME' && candidateKind !== 'ANIME';
}

function boundedDistance(left: string, right: string): boolean {
  if ((left.match(/\d+/gu) ?? []).join('|') !== (right.match(/\d+/gu) ?? []).join('|')) return false;
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
  if (query.sourceFormat !== undefined && (normalize(query.sourceFormat) === 'ova') !== (candidate.format !== undefined && normalize(candidate.format) === 'ova')) return false;
  return isFavoriteMediaKindCompatible(query.mediaKind, candidate.mediaKind);
}

export function isPublicDiscoveryCandidateCompatible(query: FavoriteTitleMatchQuery, candidate: ProviderCandidate, searchEvidence?: ProviderCandidate): boolean {
  if (searchEvidence !== undefined && (searchEvidence.provider !== candidate.provider || searchEvidence.externalId !== candidate.externalId
    || !isFavoriteMediaKindCompatible(searchEvidence.mediaKind, candidate.mediaKind))) return false;
  const formatEvidence = candidate.format === undefined && searchEvidence?.format !== undefined
    ? { ...candidate, format: searchEvidence.format } : candidate;
  const seasonEvidence = candidate.season !== undefined || candidate.titles.some((title) => titleSeason(title) !== undefined)
    ? candidate : searchEvidence ?? candidate;
  return compatible(query, formatEvidence) && (query.explicitSeason === undefined || corroboratesSeason(seasonEvidence, query.explicitSeason));
}

export function inspectFavoriteTitleCandidates(query: FavoriteTitleMatchQuery, candidates: readonly ProviderCandidate[]): Readonly<{ candidateReferences: readonly FavoriteProviderReference[]; level: MatchLevel }> {
  if (query.sourceTitles.length < 1 || query.sourceTitles.length > 16) throw new TypeError('matching requires one to sixteen source titles');
  if (candidates.length > favoriteProviderInspectionLimit) throw new RangeError('candidate inspection exceeds twenty-five candidates');
  if (query.explicitSeason !== undefined && (!Number.isSafeInteger(query.explicitSeason) || query.explicitSeason <= 0)) throw new TypeError('explicit season must be a positive safe integer');
  const eligible = candidates.filter((candidate) => compatible(query, candidate));
  const explicit = query.explicitProviderReference === undefined ? [] : eligible.filter((candidate) => candidate.provider === query.explicitProviderReference?.provider && candidate.externalId === query.explicitProviderReference.externalId);
  const titleCandidates = eligible.filter((candidate) => isPublicDiscoveryCandidateCompatible(query, candidate));
  const sourceCompact = query.sourceTitles.map(compact).filter(Boolean);
  const sourceTokens = query.sourceTitles.map(tokens).filter(Boolean);
  const explicitSeason = query.explicitSeason;
  const seasonalTitles = explicitSeason === undefined ? [] : query.sourceTitles.map((title) => seasonTitle(title, explicitSeason)).filter(Boolean);
  const levels: readonly [MatchLevel, (candidate: ProviderCandidate) => boolean][] = [
    ['source-id', (candidate) => explicit.includes(candidate)],
    ['ordered-exact', (candidate) => candidate.titles.some((title) => sourceCompact.includes(compact(title)))],
    ['explicit-season', (candidate) => explicitSeason !== undefined && candidate.titles.some((title) => seasonalTitles.includes(seasonTitle(title, explicitSeason)))],
    ['reordered-significant-words', (candidate) => candidate.titles.some((title) => sourceTokens.includes(tokens(title)))],
    ['bounded-edit-distance', (candidate) => candidate.titles.some((title) => sourceCompact.some((source) => boundedDistance(source, compact(title))))],
  ];
  for (const [level, matches] of levels) {
    const references = (level === 'source-id' ? eligible : titleCandidates).filter(matches).map(({ provider, externalId }) => ({ provider, externalId }));
    const unique = [...new Map(references.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
    if (unique.length > 0) return Object.freeze({ candidateReferences: Object.freeze(unique), level });
  }
  return Object.freeze({ candidateReferences: Object.freeze([]), level: 'bounded-edit-distance' });
}
