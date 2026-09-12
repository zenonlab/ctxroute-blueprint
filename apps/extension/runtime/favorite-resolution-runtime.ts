import { importFavoriteSources, reconcileFavoriteSourcePresenceForInventory, repairMissingFavoriteCovers, runFavoriteResolutionSlice } from '@tobirink/application';
import type { BookmarkImportPort, FavoriteCollectiveLookupPort, FavoriteProviderCandidatePort, FavoriteProviderHydrationPorts, FavoriteResolutionOutboxPort, FavoriteSourceAdapter, ResolutionProvider, StoragePort } from '@tobirink/application';
import type { LibraryId, Work } from '@tobirink/domain';
import { normalizeBookmarks } from '@tobirink/adapters-browser';
import type { BookmarkMutation } from '@tobirink/adapters-browser';
import type { ProviderIdentityRecoveryRuntime } from './provider-identity-recovery-runtime';
import type { ExtensionDiagnosticsPort } from './extension-diagnostics';

export interface FavoriteResolutionRuntimeDependencies {
  readonly beforeInventory?: () => Promise<void>;
  readonly collective?: FavoriteCollectiveLookupPort;
  readonly bookmarks: BookmarkImportPort;
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly ensureReady: () => Promise<{ schemaVersion: number }>;
  readonly diagnostics?: ExtensionDiagnosticsPort;
  readonly hydration: FavoriteProviderHydrationPorts;
  readonly identityRecovery?: ProviderIdentityRecoveryRuntime;
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly outbox: FavoriteResolutionOutboxPort;
  readonly sourceAdapters: readonly FavoriteSourceAdapter[];
  readonly storage: StoragePort;
  readonly token: () => string;
}

export async function recordFavoriteBookmarkMutation(
  dependencies: Pick<FavoriteResolutionRuntimeDependencies, 'ensureReady' | 'now' | 'storage' | 'token'>,
  mutation: BookmarkMutation,
  reconcile: () => Promise<void>,
): Promise<void> {
  await dependencies.ensureReady();
  await dependencies.storage.putFavoriteBookmarkMutation({ ...mutation, recordedAt: dependencies.now(), sequence: dependencies.token() });
  await reconcile();
}

export function subscribeFavoriteBookmarkMutations(
  events: { subscribe(listener: (mutation: BookmarkMutation) => void): void },
  dependencies: Pick<FavoriteResolutionRuntimeDependencies, 'ensureReady' | 'now' | 'storage' | 'token'>,
  reconcile: () => Promise<void>,
): void {
  events.subscribe((mutation) => { void recordFavoriteBookmarkMutation(dependencies, mutation, reconcile).catch(() => undefined); });
}

export function createFavoriteResolutionRuntime(dependencies: FavoriteResolutionRuntimeDependencies) {
  let active: Promise<void> | undefined;
  let mutationQueued = false;
  let coverRepairAfterId: Work['id'] | undefined;
  let diagnosticFailureCode: 'INVENTORY_UNAVAILABLE' | 'RESOLUTION_UNAVAILABLE' = 'RESOLUTION_UNAVAILABLE';
  const recordDiagnostic = async (event: Parameters<NonNullable<FavoriteResolutionRuntimeDependencies['diagnostics']>['record']>[0]) => {
    await dependencies.diagnostics?.record(event).catch(() => undefined);
  };
  const runOnce = (runId: string) => dependencies.ensureReady()
    .then(async () => {
        let inventoryFailure: Error | undefined;
        let inventoryBatches = 0;
        let observed = 0;
        try {
          await dependencies.beforeInventory?.();
          const stored = await dependencies.storage.getFavoriteInventoryCheckpoint();
          const checkpoint = stored?.status === 'active'
            ? stored
            : { id: 'favorite-inventory' as const, sessionId: dependencies.token(), startedAt: dependencies.now(), status: 'active' as const };
          let cursor = checkpoint.cursor;
          let complete = false;
          for (let sliceIndex = 0; sliceIndex < 8 && !complete; sliceIndex += 1) {
            const slice = await dependencies.bookmarks.readBookmarkBatch(cursor, 100);
            const favorites = normalizeBookmarks(slice.records);
            inventoryBatches += 1;
            observed += favorites.length;
            await importFavoriteSources(favorites, dependencies.storage, dependencies.now(), dependencies.sourceAdapters);
            await dependencies.storage.transaction(['favoriteInventoryMarks'], async (transaction) => {
              for (const favorite of favorites.filter((item) => item.state === 'eligible')) {
                await transaction.putFavoriteInventoryMark({ bookmarkId: favorite.bookmarkId, sessionId: checkpoint.sessionId });
              }
            });
            complete = slice.complete;
            cursor = slice.cursor;
            const nextCheckpoint = cursor === undefined
              ? { id: checkpoint.id, sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: complete ? 'complete' as const : 'active' as const }
              : { cursor, id: checkpoint.id, sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: 'active' as const };
            await dependencies.storage.putFavoriteInventoryCheckpoint(nextCheckpoint);
          }
          if (complete) await reconcileFavoriteSourcePresenceForInventory(checkpoint.sessionId, dependencies.storage);
          await recordDiagnostic({ counts: { batches: inventoryBatches, observed }, outcome: complete ? 'complete' : 'retryable', runId, stage: 'inventory' });
        } catch (error) {
          inventoryFailure = error instanceof Error ? error : new Error('INVENTORY_UNAVAILABLE');
          diagnosticFailureCode = 'INVENTORY_UNAVAILABLE';
          await recordDiagnostic({ counts: { batches: inventoryBatches, observed }, errorCode: 'INVENTORY_UNAVAILABLE', outcome: 'failed', runId, stage: 'inventory' });
        }
        await dependencies.identityRecovery?.prepare();
        const result = await runFavoriteResolutionSlice(dependencies);
        await recordDiagnostic({ counts: result, outcome: result.retried > 0 || result.blocked > 0 ? 'retryable' : 'complete', runId, stage: 'resolution' });
        const repairedCovers = await repairMissingFavoriteCovers(dependencies.storage, dependencies.hydration, dependencies.now, coverRepairAfterId, dependencies.candidates);
        coverRepairAfterId = repairedCovers.nextAfterId;
        if (repairedCovers.inspected === 0) coverRepairAfterId = undefined;
        await dependencies.identityRecovery?.publish();
        if (inventoryFailure !== undefined) throw inventoryFailure;
    });
  return function reconcileFavorites(bookmarkMutation = false): Promise<void> {
    if (active !== undefined) {
      if (bookmarkMutation) mutationQueued = true;
      return active;
    }
    active = (async () => {
      const runId = dependencies.diagnostics === undefined ? 'diagnostics-disabled' : dependencies.token();
      let pass = 0;
      try {
        do {
          mutationQueued = false;
          if (pass === 0) await recordDiagnostic({ outcome: 'started', runId, stage: 'run' });
          diagnosticFailureCode = 'RESOLUTION_UNAVAILABLE';
          await runOnce(runId);
          pass += 1;
        } while (mutationQueued && pass < 2);
        await recordDiagnostic({ outcome: 'complete', runId, stage: 'run' });
      } catch (error) {
        await recordDiagnostic({ errorCode: diagnosticFailureCode, outcome: 'failed', runId, stage: 'run' });
        throw error;
      }
    })().finally(() => {
      active = undefined;
      if (mutationQueued) queueMicrotask(() => { void reconcileFavorites(true).catch(() => undefined); });
    });
    return active;
  };
}
