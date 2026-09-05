import { createReview, createWork, reviewId } from '@tobirink/domain';
import type { Review, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export interface ImportableFavorite { bookmarkId: string; state: 'eligible' | 'ignored'; title: string; url: string; }
export type ResolutionOutcome = { kind: 'certain'; work: Work } | { kind: 'ambiguous' } | { kind: 'unavailable' };
export interface ResolutionPort { resolve(favorite: ImportableFavorite): Promise<ResolutionOutcome>; }
export interface EnrichmentPort { enrich(work: Work): Promise<void>; }
export interface FavoriteResolutionResult { bookmarkId: string; review?: Review; state: 'ignored' | 'resolved' | 'review-required' | 'unavailable'; }

function stableReviewId(bookmarkId: string) {
  const slug = bookmarkId.toLocaleLowerCase().replace(/[^a-z0-9_-]/gu, '_').slice(0, 48).padEnd(6, '0');
  return reviewId(`review_${slug}`);
}

export async function resolveFavorite(
  favorite: ImportableFavorite,
  storage: StoragePort,
  resolver: ResolutionPort,
  enrichment: EnrichmentPort,
): Promise<FavoriteResolutionResult> {
  if (favorite.state === 'ignored') return { bookmarkId: favorite.bookmarkId, state: 'ignored' };
  const outcome = await resolver.resolve(favorite);
  const id = stableReviewId(favorite.bookmarkId);
  if (outcome.kind === 'certain') {
    const review = createReview({ id, matchedWorkId: outcome.work.id, sourceLabel: favorite.url, status: 'resolved', title: favorite.title });
    await storage.transaction(['works', 'reviews'], async (session) => { await session.putWork(createWork(outcome.work)); await session.putReview(review); });
    await enrichment.enrich(outcome.work);
    return { bookmarkId: favorite.bookmarkId, review, state: 'resolved' };
  }
  const review = createReview({ id, sourceLabel: favorite.url, status: outcome.kind === 'ambiguous' ? 'pending' : 'no-match', title: favorite.title });
  await storage.putReview(review);
  return { bookmarkId: favorite.bookmarkId, review, state: outcome.kind === 'ambiguous' ? 'review-required' : 'unavailable' };
}

export async function applyReviewDecision(review: Review, work: Work, storage: StoragePort, enrichment: EnrichmentPort): Promise<Review> {
  const resolved = createReview({ ...review, matchedWorkId: work.id, status: 'resolved' });
  await storage.transaction(['works', 'reviews'], async (session) => { await session.putWork(createWork(work)); await session.putReview(resolved); });
  await enrichment.enrich(work);
  return resolved;
}
