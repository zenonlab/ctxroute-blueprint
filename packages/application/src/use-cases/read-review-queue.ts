import type { ReviewListQuery, StorageReadPort } from '../ports/storage-port';

export const reviewQueueLimit = 100;

export interface ReviewQueueItem {
  id: string;
  sourceLabel: string;
  title: string;
}

export interface ReviewQueueSnapshot {
  items: readonly ReviewQueueItem[];
  status: 'pending';
}

export async function readReviewQueue(storage: StorageReadPort): Promise<ReviewQueueSnapshot> {
  const items: ReviewQueueItem[] = [];
  const availableBefore = new Date().toISOString();
  let after: ReviewListQuery['after'];
  while (items.length < reviewQueueLimit) {
    const query: ReviewListQuery = { actionableOnly: true, availableBefore, limit: reviewQueueLimit, status: 'pending' };
    if (after !== undefined) query.after = after;
    const reviews = await storage.listReviews(query);
    const visible = await Promise.all(reviews.map(async (review) => ({ review, source: await storage.findFavoriteSourceByReviewId(review.id) })));
    for (const { review, source } of visible) {
      if (items.length === reviewQueueLimit) break;
      if (source?.presence !== 'observed' || source.resolution?.kind !== 'REVIEW_REQUIRED' || source.resolution.reason !== review.reason) continue;
      items.push(Object.freeze({ id: review.id, sourceLabel: review.sourceLabel, title: review.title }));
    }
    const last = reviews.at(-1);
    if (reviews.length < reviewQueueLimit || last === undefined) break;
    if (last.availableAt === undefined || after !== undefined && (last.availableAt < after.availableAt || last.availableAt === after.availableAt && last.id <= after.id)) throw new Error('Review queue cursor did not advance.');
    after = { availableAt: last.availableAt, id: last.id };
  }
  items.sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({ items: Object.freeze(items), status: 'pending' });
}
