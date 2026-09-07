import { addWork, createLibrary, createWork, workId } from '@tobirink/domain';
import type { LibraryId, ProviderCandidate, Review } from '@tobirink/domain';
import type { FavoriteReviewCandidateSet, StoragePort } from '../ports/storage-port';
import { commitTask, parseFavoriteResolutionTaskPayload, recordTaskEffect } from '../tasks';
import type { DurableTask } from '../tasks';

interface FavoriteResolutionCommitDependencies {
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly storage: StoragePort;
}

export function favoriteCandidateWorkId(candidate: ProviderCandidate) {
  const encoded = [...new TextEncoder().encode(`${candidate.provider}:${candidate.externalId}`)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  return workId(`work_${encoded}`);
}

export async function persistFavoriteResolutionCompletion(
  dependencies: FavoriteResolutionCommitDependencies,
  task: DurableTask,
  token: string,
  review: Review,
  effect: string,
  candidate?: ProviderCandidate,
  candidateSet?: FavoriteReviewCandidateSet,
): Promise<void> {
  const stores = candidate === undefined
    ? candidateSet === undefined ? ['favoriteResolutionReceipts', 'favoriteResolutionTasks', 'reviews'] as const : ['favoriteResolutionReceipts', 'favoriteResolutionTasks', 'favoriteReviewCandidateSets', 'reviews'] as const
    : ['favoriteResolutionReceipts', 'favoriteResolutionTasks', 'libraries', 'reviews', 'works'] as const;
  await dependencies.storage.transaction(stores, async (session) => {
    if (candidate !== undefined) {
      const work = createWork({
        externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }],
        id: review.matchedWorkId ?? favoriteCandidateWorkId(candidate),
        mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
        preferredTitle: candidate.titles.find((title) => title.trim().length > 0) ?? review.title,
      });
      await session.putWork(work);
      const library = await session.getLibrary(dependencies.libraryId) ?? createLibrary(dependencies.libraryId);
      if (!library.workIds.includes(work.id)) await session.putLibrary(addWork(library, work.id));
    }
    if (candidateSet !== undefined) await session.putFavoriteReviewCandidateSet(candidateSet);
    await session.putReview(review);
    await session.putFavoriteResolutionTask(commitTask(recordTaskEffect(task, token, effect), token));
    const payload = parseFavoriteResolutionTaskPayload(task.payload);
    await session.putFavoriteResolutionReceipt({ completedAt: dependencies.now(), effectDigest: effect, id: `${payload.sourceId}:favorite-resolution`, idempotencyKey: task.idempotencyKey, sourceId: payload.sourceId });
  });
}
