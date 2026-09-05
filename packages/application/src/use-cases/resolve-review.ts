import { createReview } from '@tobirink/domain';
import type { ReviewId, WorkId } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export async function resolveReview(storage: StoragePort, input: { reviewId: ReviewId; workId: WorkId }) {
  return storage.transaction(['reviews'], async (session) => {
    const current = await session.getReview(input.reviewId);
    if (!current) throw new Error('Review not found.');
    const resolved = createReview({ ...current, matchedWorkId: input.workId, status: 'resolved' });
    await session.putReview(resolved);
    return resolved;
  });
}
