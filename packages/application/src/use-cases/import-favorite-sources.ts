import {
  createFavoriteObservation,
  createFavoriteSource,
  favoriteSourceId,
  libraryId,
  removeWork,
} from '@tobirink/domain';
import type { FavoriteSourceId } from '@tobirink/domain';
import { claimTask, commitTask, createDurableTask, encodeFavoriteResolutionTaskPayload, recordTaskEffect } from '../tasks';
import { createFavoriteParseArtifactRecord } from '../ports/storage-port';
import { parseFavoriteObservation } from '../favorites/favorite-parser';
import { extractFavoriteSourceEvidence } from '../favorites/source-evidence';
import type { FavoriteSourceAdapter } from '../favorites/source-evidence';
import type { ImportableFavorite } from '../resolution';
import type { StoragePort } from '../ports/storage-port';
import { correctImportedReview } from '../favorites/correct-imported-review';
import { favoriteResolutionVersions } from '../favorites/resolution-result-schema';

export const favoriteImportBatchSize = 100;

export interface FavoriteImportSummary {
  ignored: number;
  imported: number;
}

function encodedBookmarkIdentity(bookmarkId: string): string {
  const value = bookmarkId.trim();
  if (!value) throw new Error('bookmarkId is required.');
  const hexadecimal = [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${hexadecimal.length.toString(36)}_${hexadecimal}`.padEnd(6, '0');
}

export function favoriteSourceIdentity(bookmarkId: string): FavoriteSourceId {
  return favoriteSourceId(`source_${encodedBookmarkIdentity(bookmarkId)}`);
}

export function favoriteResolutionTaskIdentity(bookmarkId: string): string {
  return `favorite-resolution_${encodedBookmarkIdentity(bookmarkId)}`;
}

export async function importFavoriteSources(
  favorites: readonly ImportableFavorite[],
  storage: StoragePort,
  importedAt: string,
  sourceAdapters: readonly FavoriteSourceAdapter[] = [],
): Promise<FavoriteImportSummary> {
  const eligible = favorites.filter((favorite) => favorite.state === 'eligible');

  for (let offset = 0; offset < eligible.length; offset += favoriteImportBatchSize) {
    const batch = eligible.slice(offset, offset + favoriteImportBatchSize);
    await storage.transaction(['favoriteArtifacts', 'favoriteResolutionReceipts', 'favoriteResolutionTasks', 'favoriteSources', 'libraries', 'reviews'], async (session) => {
      for (const favorite of batch) {
        const id = favoriteSourceIdentity(favorite.bookmarkId);
        const previousSource = await session.getFavoriteSource(id);
        let previousAutomaticWorkId = previousSource !== undefined && previousSource.reviewId === undefined && previousSource.resolution?.kind === 'RESOLVED'
          ? previousSource.matchedWorkId
          : undefined;
        const existingSource = previousSource === undefined ? undefined
          : await correctImportedReview(session, previousSource, favoriteResolutionTaskIdentity(favorite.bookmarkId), importedAt);
        const corrected = existingSource !== previousSource;
        const existingArtifact = existingSource === undefined ? undefined : await session.getFavoriteParseArtifact(id);
        const existingTask = await session.getFavoriteResolutionTask(favoriteResolutionTaskIdentity(favorite.bookmarkId));
        let source = createFavoriteSource({
          ...existingSource,
          bookmarkId: favorite.bookmarkId,
          folderPath: favorite.folderPath,
          id,
          importedAt: existingSource?.importedAt ?? importedAt,
          order: favorite.order,
          presence: 'observed',
          title: favorite.title,
          url: favorite.url,
        });
        const observation = createFavoriteObservation({
          bookmarkId: favorite.bookmarkId,
          folderPath: favorite.folderPath,
          observationRevision: `favorite:${encodedBookmarkIdentity(favorite.bookmarkId)}`,
          observationSequence: favorite.order,
          observedAt: importedAt,
          presence: 'observed',
          siblingOrder: favorite.order,
          title: favorite.title,
          url: favorite.url,
        });
        const evidence = extractFavoriteSourceEvidence({ sourceKey: source.id, title: favorite.title, url: favorite.url }, sourceAdapters);
        const artifact = parseFavoriteObservation(observation, evidence);
        const sameArtifact = existingArtifact?.artifact.semanticFingerprint === artifact.semanticFingerprint;
        if (!sameArtifact && source.resolution !== undefined) {
          const decision = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
          const staleAutomaticReview = decision?.decisionOrigin === 'automatic';
          if (decision === undefined || decision.status === 'pending' || staleAutomaticReview) {
            if (staleAutomaticReview) {
              previousAutomaticWorkId = source.resolution.kind === 'RESOLVED' ? source.matchedWorkId : previousAutomaticWorkId;
              const receiptId = `${source.id}:semantic-reparse:${artifact.semanticFingerprint}`;
              if (await session.getFavoriteResolutionReceipt(receiptId) === undefined) {
                const correction = { schemaVersion: 1 as const, source, review: decision };
                const withArtifact = existingArtifact === undefined ? correction : { ...correction, artifact: existingArtifact };
                await session.putFavoriteResolutionReceipt({
                  completedAt: importedAt,
                  correction: existingTask === undefined ? withArtifact : { ...withArtifact, task: existingTask },
                  effectDigest: 'correction:semantic-automatic',
                  id: receiptId,
                  idempotencyKey: receiptId,
                  sourceId: source.id,
                });
              }
            }
            const { matchedWorkId: _work, resolution: _resolution, resolutionVersions: _versions, reviewId: _review, ...processing } = source;
            source = createFavoriteSource(staleAutomaticReview || source.reviewId === undefined
              ? processing
              : { ...processing, reviewId: source.reviewId });
          }
        }
        if (!sameArtifact && previousAutomaticWorkId !== undefined && source.matchedWorkId === undefined) {
          const otherReferences = (await session.listFavoriteSourcesByWorkId({ limit: 2, workId: previousAutomaticWorkId }))
            .filter((candidate) => candidate.id !== id && candidate.presence === 'observed' && candidate.resolution?.kind === 'RESOLVED');
          if (otherReferences.length === 0) {
            const primaryLibrary = await session.getLibrary(libraryId('library_primary'));
            if (primaryLibrary?.workIds.includes(previousAutomaticWorkId) === true) await session.putLibrary(removeWork(primaryLibrary, previousAutomaticWorkId));
          }
        }
        const task = createDurableTask({
          id: favoriteResolutionTaskIdentity(favorite.bookmarkId),
          idempotencyKey: `favorite-resolution:${source.id}:${artifact.semanticFingerprint}`,
          kind: 'favorite-resolution',
          lane: 'routing',
          payload: encodeFavoriteResolutionTaskPayload({ semanticFingerprint: artifact.semanticFingerprint, sourceId: source.id }),
        });
        const identityMissing = artifact.status === 'identity-missing'
          && artifact.sourceEvidence.explicitProviderReference === undefined
          && source.reviewId === undefined;
        if (identityMissing) {
          source = createFavoriteSource({
            ...source,
            resolution: { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' },
            resolutionVersions: favoriteResolutionVersions(artifact),
          });
        }
        await session.putFavoriteSource(source);
        const record = { artifact, recordedAt: importedAt, sourceId: source.id };
        await session.putFavoriteParseArtifact(createFavoriteParseArtifactRecord(sameArtifact ? { ...existingArtifact, ...record } : record));
        if (identityMissing && (corrected || !sameArtifact || existingTask?.state !== 'COMMITTED' || existingTask.idempotencyKey !== task.idempotencyKey)) {
          const claimToken = `import:${artifact.semanticFingerprint}`;
          const expiresAt = new Date(new Date(importedAt).getTime() + 60_000).toISOString();
          const committed = commitTask(recordTaskEffect(claimTask(task, claimToken, importedAt, expiresAt), claimToken, 'unsupported:identity-missing'), claimToken);
          await session.putFavoriteResolutionTask(committed);
          const receiptId = `${source.id}:favorite-resolution`;
          const previousReceipt = await session.getFavoriteResolutionReceipt(receiptId);
          if (previousReceipt?.idempotencyKey !== task.idempotencyKey) {
            await session.putFavoriteResolutionReceipt({
              completedAt: importedAt,
              effectDigest: 'unsupported:identity-missing',
              id: receiptId,
              idempotencyKey: task.idempotencyKey,
              sourceId: source.id,
              versions: favoriteResolutionVersions(artifact),
            });
          }
        } else if (!identityMissing && (corrected || !sameArtifact)) {
          await session.putFavoriteResolutionTask(task);
        }
      }
    });
  }

  return Object.freeze({ ignored: favorites.length - eligible.length, imported: eligible.length });
}
