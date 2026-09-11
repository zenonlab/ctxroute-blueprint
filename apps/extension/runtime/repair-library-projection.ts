import type { StoragePort } from '@tobirink/application';
import { createLibrary } from '@tobirink/domain';
import type { FavoriteSourceId, LibraryId } from '@tobirink/domain';

export async function repairFavoriteLibraryProjection(storage: StoragePort, libraryId: LibraryId): Promise<void> {
  let afterId: FavoriteSourceId | undefined;
  for (;;) {
    const batch = await storage.listFavoriteSources(afterId === undefined ? { limit: 100 } : { afterId, limit: 100 });
    if (batch.length === 0) return;
    await storage.transaction(['favoriteSources', 'libraries', 'works'], async session => {
      const library = await session.getLibrary(libraryId) ?? createLibrary(libraryId);
      const ids = new Set(library.workIds);
      for (const observed of batch) {
        const source = await session.getFavoriteSource(observed.id);
        if (source?.presence !== 'observed' || source.matchedWorkId === undefined || source.resolution?.kind !== 'RESOLVED') continue;
        if (!ids.has(source.matchedWorkId) && await session.getWork(source.matchedWorkId) !== undefined) ids.add(source.matchedWorkId);
      }
      if (ids.size !== library.workIds.length) await session.putLibrary(createLibrary(libraryId, [...ids]));
    });
    afterId = batch.at(-1)?.id;
    if (batch.length < 100) return;
  }
}
