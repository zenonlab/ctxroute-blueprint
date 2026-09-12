import { createFavoriteSource } from '@tobirink/domain';
import type { FavoriteInventoryCheckpoint, StoragePort } from '../ports/storage-port';
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

export async function reconcileFavoriteSourcePresencePageForInventory(
  checkpoint: FavoriteInventoryCheckpoint,
  storage: StoragePort,
): Promise<{ checkpoint: FavoriteInventoryCheckpoint; detached: number; observed: number }> {
  if (!checkpoint.sessionId.trim()) throw new TypeError('Inventory sessionId is required.');
  if (checkpoint.status !== 'active' || checkpoint.phase !== 'presence') throw new Error('Presence reconciliation requires an active presence checkpoint.');
  return storage.transaction(['favoriteInventoryCheckpoints', 'favoriteInventoryMarks', 'favoriteSources'], async (transaction) => {
    const page = checkpoint.presenceAfterId === undefined
      ? await transaction.listFavoriteSources({ limit: favoritePresencePageLimit })
      : await transaction.listFavoriteSources({ afterId: checkpoint.presenceAfterId, limit: favoritePresencePageLimit });
    const presences = await Promise.all(page.map(async (source) => ({
      presence: (await transaction.getFavoriteInventoryMark(source.bookmarkId))?.sessionId === checkpoint.sessionId ? 'observed' as const : 'detached' as const,
      source,
    })));
    let detached = 0;
    let observed = 0;
    for (const { presence, source } of presences) {
      if (presence === 'observed') observed += 1; else detached += 1;
      if (source.presence !== presence) await transaction.putFavoriteSource(createFavoriteSource({ ...source, presence }));
    }
    const last = page.at(-1);
    if (checkpoint.presenceAfterId !== undefined && last?.id === checkpoint.presenceAfterId) throw new Error('Favorite source inventory cursor did not advance.');
    const complete = page.length < favoritePresencePageLimit;
    let next: FavoriteInventoryCheckpoint;
    if (complete) {
      next = { id: checkpoint.id, sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: 'complete' };
    } else {
      if (last === undefined) throw new Error('Favorite source inventory page has no cursor.');
      next = { id: checkpoint.id, phase: 'presence', presenceAfterId: last.id, sessionId: checkpoint.sessionId, startedAt: checkpoint.startedAt, status: 'active' };
    }
    await transaction.putFavoriteInventoryCheckpoint(next);
    return Object.freeze({ checkpoint: Object.freeze(next), detached, observed });
  });
}
