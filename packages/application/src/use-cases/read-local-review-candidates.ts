import type { LibraryId, ReviewId, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { localReviewRevisionPort } from './read-review-candidates';
import { searchLocalLibrary } from './search-local-library';

export interface LocalReviewCandidate {
  sourceUrl: string;
  work: Work;
}

export interface LocalReviewCandidateSnapshot {
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

export async function readLocalReviewCandidates(
  storage: StoragePort,
  input: { libraryId: LibraryId; reviewId: ReviewId },
): Promise<LocalReviewCandidateSnapshot> {
  const context = await storage.transaction(['favoriteSources', 'reviews'], async (session) => ({
    review: await session.getReview(input.reviewId),
    source: await session.findFavoriteSourceByReviewId(input.reviewId),
  }));
  if (!context.review || !context.source || context.source.presence !== 'observed' || context.review.status !== 'pending') throw new Error('Review candidate context is stale.');

  const found = await searchLocalLibrary(storage, { libraryId: input.libraryId, limit: 6, query: context.review.title });
  const candidates = (await Promise.all(found.items.map(async (work) => {
    const matches = await storage.listReviewsByWorkId({ limit: 100, workId: work.id });
    for (const match of matches) {
      const source = await storage.findFavoriteSourceByReviewId(match.id);
      if (source?.presence === 'observed' && isHttpUrl(source.url)) return Object.freeze({ sourceUrl: source.url, work });
    }
    return undefined;
  }))).flatMap((candidate) => candidate ? [candidate] : []);
  const revision = await localReviewRevisionPort.createRevision({ review: context.review, source: context.source });
  return Object.freeze({
    candidates: Object.freeze(candidates),
    reviewId: context.review.id,
    revision,
    state: candidates.length > 0 ? 'ready' : 'partial',
    title: context.review.title,
  });
}
