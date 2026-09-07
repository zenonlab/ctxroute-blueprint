import { createReview } from '@tobirink/domain';
import type { LibraryId, Review, ReviewId, WorkId } from '@tobirink/domain';
import type { ReviewRevisionPort } from '../ports/review-candidate-port';
import type { StoragePort, StorageSession } from '../ports/storage-port';
import { localReviewRevisionPort } from './read-review-candidates';
import { normalizeLocalSearch } from './search-local-library';

export type LocalReviewDecision =
  | { kind: 'candidate'; workId: WorkId }
  | { kind: 'manual'; source: 'id' | 'url'; value: string }
  | { kind: 'none' };

async function resolveManualWork(
  session: StorageSession,
  libraryId: LibraryId,
  decision: Extract<LocalReviewDecision, { kind: 'manual' }>,
): Promise<WorkId> {
  const library = await session.getLibrary(libraryId);
  if (!library) throw new Error('Review candidate is no longer available.');
  const allowed = new Set(library.workIds.slice(0, 500));
  const matches: WorkId[] = [];
  if (decision.source === 'id') {
    for (const id of allowed) {
      const work = await session.getWork(id);
      if (work?.externalReferences.some(({ externalId }) => externalId === decision.value.trim())) matches.push(id);
    }
  } else {
    const sources = await session.listFavoriteSources({ limit: 500 });
    for (const source of sources) {
      if (source.presence !== 'observed') continue;
      if (source.url !== decision.value.trim()) continue;
      const review = await session.getReview(source.reviewId);
      if (review?.matchedWorkId && allowed.has(review.matchedWorkId)) matches.push(review.matchedWorkId);
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1 || !unique[0]) throw new Error('Manual Review candidate is unavailable or ambiguous.');
  return unique[0];
}

async function hasResolvedHttpSource(session: StorageSession, workId: WorkId): Promise<boolean> {
  const reviews = await session.listReviewsByWorkId({ limit: 100, workId });
  for (const review of reviews) {
    const source = await session.findFavoriteSourceByReviewId(review.id);
    if (!source || source.presence !== 'observed') continue;
    try {
      const url = new URL(source.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function recordReviewDecision(
  storage: StoragePort,
  input: { decision: LocalReviewDecision; libraryId: LibraryId; reviewId: ReviewId; revision: string },
  revisionPort: ReviewRevisionPort = localReviewRevisionPort,
): Promise<Review> {
  return storage.transaction(['favoriteSources', 'libraries', 'reviews', 'works'], async (session) => {
    const review = await session.getReview(input.reviewId);
    const source = await session.findFavoriteSourceByReviewId(input.reviewId);
    if (!review || !source || source.presence !== 'observed' || review.status !== 'pending') throw new Error('Review decision context is stale.');
    const currentRevision = await revisionPort.createRevision({ review, source });
    if (currentRevision !== input.revision) throw new Error('Review decision revision conflict.');

    let resolved: Review;
    if (input.decision.kind !== 'none') {
      const selectedWorkId = input.decision.kind === 'candidate'
        ? input.decision.workId
        : await resolveManualWork(session, input.libraryId, input.decision);
      const work = await session.getWork(selectedWorkId);
      const library = await session.getLibrary(input.libraryId);
      const title = normalizeLocalSearch(review.title);
      const candidateTitle = work ? normalizeLocalSearch(work.preferredTitle) : '';
      const titleMatches = candidateTitle.includes(title) || title.includes(candidateTitle);
      const candidateVerified = input.decision.kind === 'manual' || await hasResolvedHttpSource(session, selectedWorkId);
      if (!work || !library?.workIds.includes(work.id) || !titleMatches || !candidateVerified) throw new Error('Review candidate is no longer available.');
      resolved = createReview({ ...review, matchedWorkId: work.id, status: 'resolved' });
    } else {
      resolved = createReview({ ...review, status: 'no-match' });
    }
    await session.putReview(resolved);
    return resolved;
  });
}
