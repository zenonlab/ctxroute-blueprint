import { importFavoriteSources, reconcileFavoriteSourcePresence, runFavoriteResolutionSlice } from '@tobirink/application';
import type { BookmarkImportPort, FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteResolutionOutboxPort, FavoriteSourceAdapter, ResolutionProvider, StoragePort } from '@tobirink/application';
import type { LibraryId } from '@tobirink/domain';
import { normalizeBookmarks } from '@tobirink/adapters-browser';

export interface FavoriteResolutionRuntimeDependencies {
  readonly bookmarks: BookmarkImportPort;
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly ensureReady: () => Promise<{ schemaVersion: number }>;
  readonly hydration: Readonly<Record<ResolutionProvider, FavoriteProviderHydrationPort>>;
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly outbox: FavoriteResolutionOutboxPort;
  readonly sourceAdapters: readonly FavoriteSourceAdapter[];
  readonly storage: StoragePort;
  readonly token: () => string;
}

export function createFavoriteResolutionRuntime(dependencies: FavoriteResolutionRuntimeDependencies) {
  let active: Promise<void> | undefined;
  let mutationQueued = false;
  const runOnce = () => dependencies.ensureReady()
    .then(async () => {
        const favorites = normalizeBookmarks(await dependencies.bookmarks.importBookmarks());
        await importFavoriteSources(favorites, dependencies.storage, dependencies.now(), dependencies.sourceAdapters);
        await reconcileFavoriteSourcePresence(favorites, dependencies.storage);
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
