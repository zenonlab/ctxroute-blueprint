import { describe, expect, it, vi } from 'vitest';
import { createReview, reviewId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { readReviewQueue, reviewQueueLimit } from './read-review-queue';

describe('readReviewQueue', () => {
  it('returns only pending Reviews in stable order as an immutable snapshot', async () => {
    const storage = new MemoryStoragePort();
    await storage.putReview(createReview({ id: reviewId('review_zzzzzz'), sourceLabel: 'https://z.example', status: 'pending', title: 'Z' }));
    await storage.putReview(createReview({ id: reviewId('review_aaaaaa'), sourceLabel: 'https://a.example', status: 'pending', title: 'A' }));
    await storage.putReview(createReview({ id: reviewId('review_donedone'), sourceLabel: 'https://done.example', status: 'no-match', title: 'Done' }));

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
});
