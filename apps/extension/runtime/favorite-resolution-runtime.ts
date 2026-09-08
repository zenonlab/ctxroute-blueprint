import { importFavoriteSources, reconcileFavoriteSourcePresenceForInventory, runFavoriteResolutionSlice } from '@tobirink/application';
import type { BookmarkImportPort, FavoriteCollectiveLookupPort, FavoriteProviderCandidatePort, FavoriteProviderHydrationPorts, FavoriteResolutionOutboxPort, FavoriteSourceAdapter, ResolutionProvider, StoragePort } from '@tobirink/application';
import type { LibraryId } from '@tobirink/domain';
import { normalizeBookmarks } from '@tobirink/adapters-browser';
import type { BookmarkMutation } from '@tobirink/adapters-browser';

export interface FavoriteResolutionRuntimeDependencies {
  readonly collective?: FavoriteCollectiveLookupPort;
  readonly bookmarks: BookmarkImportPort;
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly ensureReady: () => Promise<{ schemaVersion: number }>;
  readonly hydration: FavoriteProviderHydrationPorts;
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
  const runOnce = () => dependencies.ensureReady()
    .then(async () => {
        const stored = await dependencies.storage.getFavoriteInventoryCheckpoint();
        const checkpoint = stored?.status === 'active'
          ? stored
          : { id: 'favorite-inventory' as const, sessionId: dependencies.token(), startedAt: dependencies.now(), status: 'active' as const };
        let cursor = checkpoint.cursor;
        let complete = false;
        for (let sliceIndex = 0; sliceIndex < 8 && !complete; sliceIndex += 1) {
          const slice = await dependencies.bookmarks.readBookmarkBatch(cursor, 100);
          const favorites = normalizeBookmarks(slice.records);
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
        await runFavoriteResolutionSlice(dependencies);
    });
  return function reconcileFavorites(bookmarkMutation = false): Promise<void> {
    if (active !== undefined) {
      if (bookmarkMutation) mutationQueued = true;
      return active;
    }
    active = (async () => {
      let pass = 0;
      do {
        mutationQueued = false;
        await runOnce();
        pass += 1;
      } while (mutationQueued && pass < 2);
    })().finally(() => {
      active = undefined;
      if (mutationQueued) queueMicrotask(() => { void reconcileFavorites(true).catch(() => undefined); });
    });
    return active;
  };
}
