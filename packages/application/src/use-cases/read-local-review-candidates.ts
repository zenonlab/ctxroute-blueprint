import { createWork, isContentVisible } from '@tobirink/domain';
import type { LibraryId, ProviderCandidate, ReviewId, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { localReviewRevisionPort } from './read-review-candidates';
import { searchLocalLibrary } from './search-local-library';
import { favoriteCandidateWorkId } from '../favorites/favorite-resolution-commit';
import { favoritePublicReferenceSchema } from '../favorites/favorite-identity-lookup';
import type { FavoritePublicReference } from '../favorites/favorite-identity-lookup';

export interface LocalReviewCandidate {
  candidate?: ProviderCandidate;
  sourceUrl: string;
  work: Work;
}

export interface LocalReviewCandidateSnapshot {
  providerReferences?: readonly FavoritePublicReference[] | undefined;
  reason?: 'AMBIGUOUS' | 'NOT_FOUND' | 'UNCONFIRMED_SEASON' | undefined;
  matchLevel?: string | undefined;
  provenance?: string | undefined;
  totalCandidates?: number | undefined;
  candidates: readonly LocalReviewCandidate[];
  reviewId: ReviewId;
  revision: string;
  state: 'partial' | 'ready';
  title: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function providerCandidate(candidate: ProviderCandidate): LocalReviewCandidate | undefined {
  if (candidate.canonicalUrl === undefined || !isHttpUrl(candidate.canonicalUrl)) return undefined;
  return Object.freeze({
    candidate,
    sourceUrl: candidate.canonicalUrl,
    work: createWork({ externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }], id: favoriteCandidateWorkId(candidate), mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga', preferredTitle: candidate.titles[0] ?? candidate.externalId }),
  });
}

async function readLegacyCandidates(storage: StoragePort, libraryId: LibraryId, title: string, showAdultContent: boolean): Promise<LocalReviewCandidate[]> {
  const found = await searchLocalLibrary(storage, { libraryId, limit: 6, query: title, showAdultContent });
  return (await Promise.all(found.items.map(async (work) => {
    const sources = await storage.listFavoriteSourcesByWorkId({ limit: 100, workId: work.id });
    const direct = sources.find((source) => source.presence === 'observed' && isHttpUrl(source.url));
    if (direct) return Object.freeze(work.hydration === undefined ? { sourceUrl: direct.url, work } : { candidate: work.hydration.candidate, sourceUrl: direct.url, work });
    const matches = await storage.listReviewsByWorkId({ limit: 100, workId: work.id });
    for (const match of matches) {
      const source = await storage.findFavoriteSourceByReviewId(match.id);
      if (source?.presence === 'observed' && isHttpUrl(source.url)) return Object.freeze(work.hydration === undefined ? { sourceUrl: source.url, work } : { candidate: work.hydration.candidate, sourceUrl: source.url, work });
    }
    return undefined;
  }))).flatMap((candidate) => candidate ? [candidate] : []);
}

export async function readLocalReviewCandidates(
  storage: StoragePort,
  input: { libraryId: LibraryId; reviewId: ReviewId; showAdultContent?: boolean },
): Promise<LocalReviewCandidateSnapshot> {
  const context = await storage.transaction(['favoriteSources', 'reviews'], async (session) => ({
    review: await session.getReview(input.reviewId),
    source: await session.findFavoriteSourceByReviewId(input.reviewId),
  }));
  if (!context.review || !context.source || context.source.presence !== 'observed' || context.review.status !== 'pending') throw new Error('Review candidate context is stale.');
  if (context.review.reason !== undefined && context.source.resolution?.kind !== 'REVIEW_REQUIRED') throw new Error('Review resolution is still processing.');

  const persisted = await storage.getFavoriteReviewCandidateSet(context.review.id);
  if (persisted?.references !== undefined && persisted.references.length > 10) throw new Error('REVIEW_REFERENCE_LIMIT');
  const references = persisted?.references?.map((reference) => favoritePublicReferenceSchema.parse(reference));
  const providerReferences = references === undefined ? []
    : [...new Map(references.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
  const candidates = persisted !== undefined || context.review.reason !== undefined
    ? persisted?.candidates.map(providerCandidate).filter((candidate): candidate is LocalReviewCandidate => candidate !== undefined && (input.showAdultContent === undefined || isContentVisible(candidate.candidate, input.showAdultContent))).slice(0, 6) ?? []
    : await readLegacyCandidates(storage, input.libraryId, context.review.title, input.showAdultContent ?? true);
  const revision = await localReviewRevisionPort.createRevision({ candidateDigest: persisted?.digest, review: context.review, source: context.source });
  return Object.freeze({
    providerReferences: providerReferences.length === 0 ? undefined : Object.freeze(providerReferences),
    candidates: Object.freeze(candidates),
    reason: context.review.reason,
    matchLevel: persisted?.matchLevel,
    provenance: persisted?.provenance,
    totalCandidates: persisted?.totalCandidates,
    reviewId: context.review.id,
    revision,
    state: context.review.reason === 'NOT_FOUND' || candidates.length > 0 || providerReferences.length > 0 ? 'ready' : 'partial',
    title: context.review.title,
  });
}
