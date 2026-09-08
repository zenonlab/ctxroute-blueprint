import { describe, expect, it, vi } from 'vitest';
import { createFavoriteSource, createReview, favoriteSourceId, reviewId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { readReviewQueue, reviewQueueLimit } from './read-review-queue';

describe('readReviewQueue', () => {
  it('returns only pending Reviews in stable order as an immutable snapshot', async () => {
    const storage = new MemoryStoragePort();
    await storage.putReview(createReview({ id: reviewId('review_zzzzzz'), reason: 'AMBIGUOUS', sourceLabel: 'https://z.example', status: 'pending', title: 'Z' }));
    await storage.putReview(createReview({ id: reviewId('review_aaaaaa'), reason: 'NOT_FOUND', sourceLabel: 'https://a.example', status: 'pending', title: 'A' }));
    await storage.putReview(createReview({ id: reviewId('review_donedone'), sourceLabel: 'https://done.example', status: 'no-match', title: 'Done' }));
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'a', folderPath: [], id: favoriteSourceId('source_aaaaaa'), importedAt: '2026-09-07T12:00:00.000Z', order: 0, resolution: { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, reviewId: reviewId('review_aaaaaa'), title: 'A', url: 'https://a.example' }));
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'z', folderPath: [], id: favoriteSourceId('source_zzzzzz'), importedAt: '2026-09-07T12:00:00.000Z', order: 1, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, reviewId: reviewId('review_zzzzzz'), title: 'Z', url: 'https://z.example' }));

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

    expect(listReviews).toHaveBeenCalledWith({ actionableOnly: true, availableBefore: expect.any(String), limit: reviewQueueLimit, status: 'pending' });
  });

  it('continues past a full page of sources that are no longer actionable', async () => {
    const storage = new MemoryStoragePort();
    for (let index = 0; index < 101; index += 1) {
      const suffix = index.toString().padStart(6, '0');
      const review = createReview({ id: reviewId(`review_${suffix}`), reason: 'NOT_FOUND', sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic' });
      await storage.putReview(review);
      await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: suffix, folderPath: [], id: favoriteSourceId(`source_${suffix}`), importedAt: '2026-09-08T00:00:00.000Z', order: index, reviewId: review.id, title: review.title, url: 'https://reader.example/synthetic' }));
    }
    const last = await storage.getFavoriteSource(favoriteSourceId('source_000100'));
    if (!last) throw new Error('Missing fixture source.');
    await storage.putFavoriteSource(createFavoriteSource({ ...last, resolution: { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' } }));
    const listReviews = vi.spyOn(storage, 'listReviews');

    expect((await readReviewQueue(storage)).items.map((item) => item.id)).toEqual(['review_000100']);
    expect(listReviews).toHaveBeenCalledTimes(2);
    expect(listReviews.mock.calls[1]?.[0]).toMatchObject({ after: { availableAt: '1970-01-01T00:00:00.000Z', id: 'review_000099' }, availableBefore: listReviews.mock.calls[0]?.[0].availableBefore });
  });

  it('does not project Reviews whose favorite source is detached', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_detached'), sourceLabel: 'https://detached.example', status: 'pending', title: 'Detached' });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'detached', folderPath: [], id: favoriteSourceId('source_detached'), importedAt: '2026-09-07T12:00:00.000Z', order: 0, presence: 'detached', reviewId: review.id, title: 'Detached', url: 'https://detached.example' }));

    await expect(readReviewQueue(storage)).resolves.toEqual({ items: [], status: 'pending' });
  });
});
