import { favoriteIdentityKey, favoriteSourceIdentity, importFavoriteSources, reconcileFavoriteSourcePresencePageForInventory, runFavoriteResolutionSlice } from '@tobirink/application';
import type { BookmarkImportPort, FavoriteIdentityLookupPort, FavoriteInventoryCheckpoint, FavoriteProviderCandidatePort, FavoriteProviderHydrationPorts, FavoriteResolutionOutboxPort, FavoriteSourceAdapter, PublicDiscoveryRequestClientPort, ResolutionProvider, StoragePort } from '@tobirink/application';
import { createFavoriteSource } from '@tobirink/domain';
import type { FavoriteSourceId, LibraryId } from '@tobirink/domain';
import { normalizeBookmarks } from '@tobirink/adapters-browser';
import type { BookmarkMutation } from '@tobirink/adapters-browser';
import type { ExtensionDiagnosticsPort } from './extension-diagnostics';

export interface FavoriteResolutionRuntimeDependencies {
  readonly beforeInventory?: () => Promise<void>;
  readonly publicDiscovery?: PublicDiscoveryRequestClientPort;
  readonly synchronized?: FavoriteIdentityLookupPort;
  readonly bookmarks: BookmarkImportPort;
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly ensureReady: () => Promise<{ schemaVersion: number }>;
  readonly diagnostics?: ExtensionDiagnosticsPort;
  readonly hydration: FavoriteProviderHydrationPorts;
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly outbox: FavoriteResolutionOutboxPort;
  readonly refreshPublicDiscovery?: () => Promise<{ continuationRequired: boolean }>;
  readonly updateContinuation?: (availableAt: string | undefined) => Promise<void>;
  readonly sourceAdapters: readonly FavoriteSourceAdapter[];
  readonly storage: StoragePort;
  readonly token: () => string;
}

export const favoriteInventoryAuditAlarmName = 'tobirink-favorite-inventory-audit-v1';
export const favoriteInventoryAuditPeriodMinutes = 6 * 60;

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
  dependencies: Pick<FavoriteResolutionRuntimeDependencies, 'bookmarks' | 'ensureReady' | 'now' | 'sourceAdapters' | 'storage' | 'token'>,
  reconcile: (inventoryRequested?: boolean) => Promise<void>,
): void {
  events.subscribe((mutation) => { void reconcileFavoriteBookmarkMutation(dependencies, mutation, reconcile).catch(() => undefined); });
}

export async function reconcileFavoriteBookmarkMutation(
  dependencies: Pick<FavoriteResolutionRuntimeDependencies, 'bookmarks' | 'ensureReady' | 'now' | 'sourceAdapters' | 'storage' | 'token'>,
  mutation: BookmarkMutation,
  reconcile: (inventoryRequested?: boolean) => Promise<void>,
): Promise<void> {
  await dependencies.ensureReady();
  await dependencies.storage.putFavoriteBookmarkMutation({ ...mutation, recordedAt: dependencies.now(), sequence: dependencies.token() });
  if (mutation.kind === 'removed') {
    const source = await dependencies.storage.getFavoriteSource(favoriteSourceIdentity(mutation.bookmarkId));
    if (source !== undefined) {
      await dependencies.storage.putFavoriteSource(createFavoriteSource({ ...source, presence: 'detached' }));
      await reconcile(false);
      return;
    }
  } else if (dependencies.bookmarks.readBookmark !== undefined) {
    const bookmark = await dependencies.bookmarks.readBookmark(mutation.bookmarkId);
    if (bookmark !== undefined) {
      await importFavoriteSources(normalizeBookmarks([bookmark]), dependencies.storage, dependencies.now(), dependencies.sourceAdapters);
      await reconcile(false);
      return;
    }
  }
  await reconcile(true);
}

export function createFavoriteResolutionRuntime(dependencies: FavoriteResolutionRuntimeDependencies) {
  let active: Promise<void> | undefined;
  let inventoryQueued = false;
  let cacheScanAfterId: FavoriteSourceId | undefined;
  let diagnosticFailureCode: 'INVENTORY_UNAVAILABLE' | 'RESOLUTION_UNAVAILABLE' = 'RESOLUTION_UNAVAILABLE';
  const recordDiagnostic = async (event: Parameters<NonNullable<FavoriteResolutionRuntimeDependencies['diagnostics']>['record']>[0]) => {
    await dependencies.diagnostics?.record(event).catch(() => undefined);
  };
  const prepareResolutionCaches = async () => {
    const startedAt = Date.now();
    // One lookup batch leaves time for admission after a slow prefetch.
    const page = await dependencies.storage.listFavoriteSources({ afterId: cacheScanAfterId, limit: 50 });
    cacheScanAfterId = page.length === 50 ? page.at(-1)?.id : undefined;
    const keys = new Map<string, Awaited<ReturnType<typeof favoriteIdentityKey>>>();
    for (const source of page) {
      if (source.presence !== 'observed' || (source.resolution !== undefined && source.resolution.kind !== 'RETRYABLE')) continue;
      const artifact = (await dependencies.storage.getFavoriteParseArtifact(source.id))?.artifact;
      if (artifact?.identityKey !== undefined) {
        const key = await favoriteIdentityKey(artifact);
        keys.set(key.fingerprint, key);
      }
    }
    if (keys.size === 0) return;
    const prepared = [...keys.values()];
    for (let offset = 0; offset < prepared.length; offset += 50) {
      const batch = prepared.slice(offset, offset + 50);
      await Promise.allSettled([
        dependencies.publicDiscovery?.lookup?.(batch),
        dependencies.synchronized?.lookup(batch),
      ]);
    }
    await dependencies.diagnostics?.record({ operation: 'cache-prepare', durationMs: Math.min(3_600_000, Math.max(0, Date.now() - startedAt)), outcome: 'complete', runId: 'cache-prepare', stage: 'transport' });
  };
  const runOnce = (runId: string, inventoryRequested: boolean) => dependencies.ensureReady()
    .then(async () => {
        const wakeDeadline = Date.parse(dependencies.now()) + 20_000;
        dependencies.publicDiscovery?.setDeadline?.(wakeDeadline);
        let inventoryFailure: Error | undefined;
        let inventoryBatches = 0;
        let observed = 0;
        let inventoryComplete = false;
        try {
          await dependencies.beforeInventory?.();
          const stored = await dependencies.storage.getFavoriteInventoryCheckpoint();
          inventoryComplete = stored?.status === 'complete' && !inventoryRequested;
          if (!inventoryComplete) {
            let checkpoint: FavoriteInventoryCheckpoint = stored?.status === 'active' && !inventoryRequested
              ? { ...stored, phase: stored.phase ?? 'inventory' }
              : { id: 'favorite-inventory', phase: 'inventory', sessionId: dependencies.token(), startedAt: dependencies.now(), status: 'active' };
            for (let sliceIndex = 0; sliceIndex < 8 && checkpoint.status === 'active'; sliceIndex += 1) {
              if (checkpoint.phase === 'presence') {
                const result = await reconcileFavoriteSourcePresencePageForInventory(checkpoint, dependencies.storage);
                checkpoint = result.checkpoint;
                continue;
              }
              const slice = await dependencies.bookmarks.readBookmarkBatch(checkpoint.cursor, 100);
              const favorites = normalizeBookmarks(slice.records);
              inventoryBatches += 1;
              observed += favorites.length;
              await importFavoriteSources(favorites, dependencies.storage, dependencies.now(), dependencies.sourceAdapters);
              await dependencies.storage.transaction(['favoriteInventoryMarks'], async (transaction) => {
                for (const favorite of favorites.filter((item) => item.state === 'eligible')) {
                  await transaction.putFavoriteInventoryMark({ bookmarkId: favorite.bookmarkId, sessionId: checkpoint.sessionId });
                }
              });
              if (!slice.complete && slice.cursor === undefined) throw new Error('Incomplete bookmark inventory requires a cursor.');
              const nextCheckpoint: FavoriteInventoryCheckpoint = slice.complete
                ? { id: checkpoint.id, phase: 'presence', sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: 'active' }
                : { cursor: slice.cursor, id: checkpoint.id, phase: 'inventory', sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: 'active' };
              await dependencies.storage.putFavoriteInventoryCheckpoint(nextCheckpoint);
              checkpoint = nextCheckpoint;
            }
            inventoryComplete = checkpoint.status === 'complete';
          }
          await recordDiagnostic({ counts: { batches: inventoryBatches, observed }, outcome: inventoryComplete ? 'complete' : 'retryable', runId, stage: 'inventory' });
        } catch (error) {
          inventoryFailure = error instanceof Error ? error : new Error('INVENTORY_UNAVAILABLE');
          diagnosticFailureCode = 'INVENTORY_UNAVAILABLE';
          await recordDiagnostic({ counts: { batches: inventoryBatches, observed }, errorCode: 'INVENTORY_UNAVAILABLE', outcome: 'failed', runId, stage: 'inventory' });
        }
        await prepareResolutionCaches();
        const result = await runFavoriteResolutionSlice({
          ...dependencies,
          wakeDeadline,
          trace: async (event) => dependencies.diagnostics?.record({
            ...event,
            stage: event.operation === 'admission' ? 'transport' : 'resolution',
            runId,
            outcome: event.outcome === 'started' ? 'started' : event.outcome === 'committed' || event.outcome === 'verified' ? 'complete' : event.outcome === 'pending' || event.outcome === 'retryable' ? 'retryable' : 'failed',
          }),
        });
        const refresh = inventoryComplete && result.completed === 0
          ? await dependencies.refreshPublicDiscovery?.().catch(() => ({ continuationRequired: true }))
          : undefined;
        const status = await dependencies.storage.readFavoriteResolutionCounts();
        const counts = { blocked: result.blocked, completed: result.completed, retried: result.retried,
          admissionWaiting: status.admissionWaiting, rateLimited: status.rateLimited,
          networkErrors: status.networkErrors, actionRequired: status.actionRequired, providerPaused: status.providerPaused };
        await recordDiagnostic({ counts, outcome: result.retried > 0 || result.blocked > 0 || result.continuationRequired ? 'retryable' : 'complete', runId, stage: 'resolution' });
        if (inventoryFailure !== undefined) throw inventoryFailure;
        if (!inventoryComplete || result.continuationRequired || refresh?.continuationRequired === true) return dependencies.now();
        return dependencies.outbox.nextAvailableAt({ kind: 'favorite-resolution', lane: 'routing' });
    });
  return function reconcileFavorites(inventoryRequested = false): Promise<void> {
    if (active !== undefined) {
      if (inventoryRequested) inventoryQueued = true;
      return active;
    }
    active = (async () => {
      const runId = dependencies.diagnostics === undefined ? 'diagnostics-disabled' : dependencies.token();
      let pass = 0;
      let continuationAt: string | undefined;
      let forceInventory = inventoryRequested;
      try {
        do {
          forceInventory = forceInventory || inventoryQueued;
          inventoryQueued = false;
          if (pass === 0) await recordDiagnostic({ outcome: 'started', runId, stage: 'run' });
          diagnosticFailureCode = 'RESOLUTION_UNAVAILABLE';
          continuationAt = await runOnce(runId, forceInventory);
          forceInventory = false;
          pass += 1;
        } while (inventoryQueued && pass < 2);
        await dependencies.updateContinuation?.(continuationAt);
        await recordDiagnostic({ nextAttemptAt: continuationAt, outcome: continuationAt === undefined ? 'complete' : 'retryable', runId, stage: 'run' });
      } catch (error) {
        await dependencies.updateContinuation?.(dependencies.now()).catch(() => undefined);
        await recordDiagnostic({ errorCode: diagnosticFailureCode, outcome: 'failed', runId, stage: 'run' });
        throw error;
      }
    })().finally(() => {
      dependencies.publicDiscovery?.setDeadline?.(Infinity);
      active = undefined;
      if (inventoryQueued) queueMicrotask(() => { void reconcileFavorites(true).catch(() => undefined); });
    });
    return active;
  };
}
