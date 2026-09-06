import type { StorageReadPort } from '../ports/storage-port';

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
  const reviews = await storage.listReviews({ limit: reviewQueueLimit, status: 'pending' });
  const items = reviews.map(({ id, sourceLabel, title }) => Object.freeze({ id, sourceLabel, title }));
  return Object.freeze({ items: Object.freeze(items), status: 'pending' });
}
