import { describe, expect, it, vi } from 'vitest';
import { createFavoriteSource, createReview, favoriteSourceId, reviewId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { readReviewQueue, reviewQueueLimit } from './read-review-queue';

describe('readReviewQueue', () => {
  it('returns only pending Reviews in stable order as an immutable snapshot', async () => {
    const storage = new MemoryStoragePort();
    await storage.putReview(createReview({ id: reviewId('review_zzzzzz'), sourceLabel: 'https://z.example', status: 'pending', title: 'Z' }));
    await storage.putReview(createReview({ id: reviewId('review_aaaaaa'), sourceLabel: 'https://a.example', status: 'pending', title: 'A' }));
    await storage.putReview(createReview({ id: reviewId('review_donedone'), sourceLabel: 'https://done.example', status: 'no-match', title: 'Done' }));
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'a', folderPath: [], id: favoriteSourceId('source_aaaaaa'), importedAt: '2026-09-07T12:00:00.000Z', order: 0, reviewId: reviewId('review_aaaaaa'), title: 'A', url: 'https://a.example' }));
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'z', folderPath: [], id: favoriteSourceId('source_zzzzzz'), importedAt: '2026-09-07T12:00:00.000Z', order: 1, reviewId: reviewId('review_zzzzzz'), title: 'Z', url: 'https://z.example' }));

    const snapshot = await readReviewQueue(storage);

    expect(snapshot).toEqual({
      items: [
        { id: 'review_aaaaaa', sourceLabel: 'https://a.example', title: 'A' },
        { id: 'review_zzzzzz', sourceLabel: 'https://z.example', title: 'Z' },
      ],
      status: 'pending',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.items)).toBe(true);
  });

  it('uses the bounded local queue limit', async () => {
    const storage = new MemoryStoragePort();
    const listReviews = vi.spyOn(storage, 'listReviews');

    await readReviewQueue(storage);

    expect(listReviews).toHaveBeenCalledWith({ limit: reviewQueueLimit, status: 'pending' });
  });

  it('does not project Reviews whose favorite source is detached', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_detached'), sourceLabel: 'https://detached.example', status: 'pending', title: 'Detached' });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'detached', folderPath: [], id: favoriteSourceId('source_detached'), importedAt: '2026-09-07T12:00:00.000Z', order: 0, presence: 'detached', reviewId: review.id, title: 'Detached', url: 'https://detached.example' }));

    await expect(readReviewQueue(storage)).resolves.toEqual({ items: [], status: 'pending' });
  });
});
