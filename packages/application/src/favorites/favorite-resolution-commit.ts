import { addWork, createFavoriteSource, createLibrary, createReview, createWork, reviewId, workId } from '@tobirink/domain';
import type { FavoriteResolutionResult, LibraryId, ProviderCandidate } from '@tobirink/domain';
import type { FavoriteReviewCandidateSet, StoragePort } from '../ports/storage-port';
import { commitTask, parseFavoriteResolutionTaskPayload, recordTaskEffect } from '../tasks';
import type { DurableTask } from '../tasks';
import { favoriteResolutionResultSchema, favoriteResolutionVersions } from './resolution-result-schema';

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
  result: FavoriteResolutionResult,
  effect: string,
  candidate?: ProviderCandidate,
  candidateSet?: Omit<FavoriteReviewCandidateSet, 'reviewId'>,
): Promise<void> {
  const resolution = favoriteResolutionResultSchema.parse(result);
  await dependencies.storage.transaction([
    'favoriteArtifacts', 'favoriteSources', 'favoriteResolutionReceipts',
    'favoriteResolutionTasks', 'favoriteReviewCandidateSets', 'libraries', 'reviews', 'works',
  ], async (session) => {
    const payload = parseFavoriteResolutionTaskPayload(task.payload);
    const source = await session.getFavoriteSource(payload.sourceId);
    const record = await session.getFavoriteParseArtifact(payload.sourceId);
    const currentTask = await session.getFavoriteResolutionTask(task.id);
    if (!source || !record || record.artifact.semanticFingerprint !== payload.semanticFingerprint
      || currentTask?.claimToken !== token || currentTask.state !== 'CLAIMED'
      || currentTask.idempotencyKey !== task.idempotencyKey
      || currentTask.claimExpiresAt === undefined || currentTask.claimExpiresAt <= dependencies.now()) throw new Error('STALE_PRIVATE_REFERENCE');
    const existingReview = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
    const protectedDecision = existingReview !== undefined && existingReview.status !== 'pending';
    const versions = favoriteResolutionVersions(record.artifact);
    if (!protectedDecision) {
      let updated = createFavoriteSource({ ...source, resolution, resolutionVersions: versions });
      if (resolution.kind === 'RESOLVED') {
        if (!candidate || source.presence !== 'observed') throw new Error('RESOLVED_REQUIRES_CURRENT_CANDIDATE');
        const work = createWork({
          externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }],
          id: favoriteCandidateWorkId(candidate),
          mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
          preferredTitle: candidate.titles.find((title) => title.trim().length > 0) ?? source.title,
        });
        await session.putWork(work);
        const library = await session.getLibrary(dependencies.libraryId) ?? createLibrary(dependencies.libraryId);
        if (!library.workIds.includes(work.id)) await session.putLibrary(addWork(library, work.id));
        updated = createFavoriteSource({ ...updated, matchedWorkId: work.id });
        if (existingReview) await session.putReview(createReview({ ...existingReview, decisionOrigin: 'automatic', matchedWorkId: work.id, status: 'resolved' }));
      } else if (resolution.kind === 'REVIEW_REQUIRED') {
        if (source.presence !== 'observed') throw new Error('STALE_PRIVATE_REFERENCE');
        const id = source.reviewId ?? reviewId(`review_${source.id.slice('source_'.length)}`);
        await session.putReview(createReview({ id, reason: resolution.reason, sourceLabel: source.url, status: 'pending', title: source.title }));
        if (candidateSet) await session.putFavoriteReviewCandidateSet({ ...candidateSet, reviewId: id });
        updated = createFavoriteSource({ ...updated, reviewId: id });
      }
      await session.putFavoriteSource(updated);
    }
    await session.putFavoriteResolutionTask(commitTask(recordTaskEffect(currentTask, token, effect), token));
    await session.putFavoriteResolutionReceipt({
      completedAt: dependencies.now(), effectDigest: protectedDecision ? 'decision:preserved' : effect,
      id: `${payload.sourceId}:favorite-resolution`, idempotencyKey: task.idempotencyKey,
      sourceId: payload.sourceId, versions,
    });
  });
}
