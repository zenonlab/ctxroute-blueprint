import { createFavoriteSource } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import type { ImportableFavorite } from '../resolution';

export const favoritePresencePageLimit = 100;

export async function reconcileFavoriteSourcePresence(favorites: readonly ImportableFavorite[], storage: StoragePort): Promise<{ detached: number; observed: number }> {
  const observedBookmarkIds = new Set(favorites.filter((favorite) => favorite.state === 'eligible').map((favorite) => favorite.bookmarkId));
  let afterId: Awaited<ReturnType<StoragePort['listFavoriteSources']>>[number]['id'] | undefined;
  let detached = 0; let observed = 0;
  for (;;) {
    const page = afterId === undefined
      ? await storage.listFavoriteSources({ limit: favoritePresencePageLimit })
      : await storage.listFavoriteSources({ afterId, limit: favoritePresencePageLimit });
    if (page.length === 0) break;
    await storage.transaction(['favoriteSources'], async (session) => {
      for (const source of page) {
        const presence = observedBookmarkIds.has(source.bookmarkId) ? 'observed' as const : 'detached' as const;
        if (presence === 'observed') observed += 1; else detached += 1;
        if (source.presence !== presence) await session.putFavoriteSource(createFavoriteSource({ ...source, presence }));
      }
    });
    const last = page.at(-1);
    if (last === undefined || page.length < favoritePresencePageLimit) break;
    if (last.id === afterId) throw new Error('Favorite source presence cursor did not advance.');
    afterId = last.id;
  }
  return Object.freeze({ detached, observed });
}
