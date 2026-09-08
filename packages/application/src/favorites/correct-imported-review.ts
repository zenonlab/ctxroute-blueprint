import { createFavoriteSource } from '@tobirink/domain';
import type { FavoriteSource } from '@tobirink/domain';
import type { StorageSession } from '../ports/storage-port';

/** Runs inside the import transaction; its receipt retains the previous records. */
export async function correctImportedReview(session: StorageSession, source: FavoriteSource, taskId: string, now: string): Promise<FavoriteSource> {
  const review = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
  if (review?.decisionOrigin === 'human') return source;
  const artificial = review?.status === 'pending' && review.reason === undefined
    && review.id === `review_${source.id.slice('source_'.length)}`;
  const versions = source.resolutionVersions;
  const automatic = review?.decisionOrigin === 'automatic' || review === undefined && source.reviewId === undefined && source.resolution?.kind === 'RESOLVED';
  const faultyAutomatic = automatic && versions !== undefined
    && (['favorite-parser-v1', 'favorite-parser-v2'].includes(versions.parser)
      || ['favorite-matcher-v1', 'favorite-matcher-v2'].includes(versions.matcher));
  if (!artificial && !faultyAutomatic) return source;
  const id = `${source.id}:correction-v1`;
  const previous = await session.getFavoriteResolutionReceipt(id);
  if (previous) return source;
  const base = { schemaVersion: 1 as const, source };
  const correction = review === undefined ? base : { ...base, review };
  const artifact = await session.getFavoriteParseArtifact(source.id);
  const task = await session.getFavoriteResolutionTask(taskId);
  const receipt = { completedAt: now, correction, effectDigest: artificial ? 'correction:import-pending' : 'correction:faulty-automatic', id, idempotencyKey: id, sourceId: source.id };
  const withArtifact = artifact === undefined ? receipt : { ...receipt, correction: { ...correction, artifact } };
  await session.putFavoriteResolutionReceipt(task === undefined ? withArtifact : { ...withArtifact, correction: { ...withArtifact.correction, task } });
  const { matchedWorkId: _work, resolution: _resolution, resolutionVersions: _versions, reviewId: _review, ...unresolved } = source;
  return createFavoriteSource(unresolved);
}
