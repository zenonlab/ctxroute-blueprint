import { favoriteAliasLimit, favoriteTitleByteLimit, providerCandidateLimit, utf8ByteLength } from '@tobirink/domain';
import type { FavoriteMediaKind, FavoriteProvider, ProviderCandidate, ProviderCandidateEnvelope } from '@tobirink/domain';

export type ResolutionProvider = Extract<FavoriteProvider, 'anilist' | 'mangaupdates'>;
export type FavoriteProviderReference = Readonly<{ externalId: string; provider: ResolutionProvider }>;

export interface FavoriteProviderSearchQuery {
  readonly cursor?: string;
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

export const favoriteProviderPolicy = Object.freeze({
  anilist: Object.freeze({ minimumIntervalMs: 2_200 }),
  mangaupdates: Object.freeze({ minimumIntervalMs: 3_000 }),
  negativeTtlMs: 15 * 60 * 1_000,
  positiveTtlMs: 24 * 60 * 60 * 1_000,
  requestTimeoutMs: 8_000,
});

export function routeFavoriteProviders(mediaKind: FavoriteMediaKind): readonly ResolutionProvider[] {
  if (mediaKind === 'ANIME') return Object.freeze(['anilist']);
  if (mediaKind === 'UNKNOWN') return Object.freeze(['anilist', 'mangaupdates']);
  return Object.freeze(['mangaupdates']);
}

export function assertFavoriteProviderSearchQuery(query: FavoriteProviderSearchQuery): FavoriteProviderSearchQuery {
  if (query.provider !== 'anilist' && query.provider !== 'mangaupdates') throw new TypeError('provider search accepts only a resolution provider.');
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > providerCandidateLimit) throw new RangeError(`provider search limit must be between 1 and ${providerCandidateLimit}.`);
  if (query.titles.length < 1 || query.titles.length > favoriteAliasLimit) throw new RangeError(`provider search requires between 1 and ${favoriteAliasLimit} titles.`);
  if (query.titles.some((title) => title.trim().length === 0 || utf8ByteLength(title) > favoriteTitleByteLimit)) throw new TypeError('provider search titles must be non-empty and bounded.');
  if (query.cursor !== undefined && (query.cursor.trim().length === 0 || utf8ByteLength(query.cursor) > favoriteTitleByteLimit)) throw new TypeError('provider search cursor must be non-empty and bounded.');
  return Object.freeze({ ...query, titles: Object.freeze([...query.titles]) });
}
