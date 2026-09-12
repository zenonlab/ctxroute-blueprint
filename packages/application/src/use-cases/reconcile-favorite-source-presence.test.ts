import { describe, expect, it } from 'vitest';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { PrivateStoreName, StorageSession } from '../ports/storage-port';
import { importFavoriteSources } from './import-favorite-sources';
import { reconcileFavoriteSourcePresence, reconcileFavoriteSourcePresencePageForInventory } from './reconcile-favorite-source-presence';

const first = { bookmarkId: 'first', folderPath: [], order: 0, state: 'eligible' as const, title: 'First', url: 'https://reader.example/manga/first' };
const second = { ...first, bookmarkId: 'second', order: 1, title: 'Second', url: 'https://reader.example/manga/second' };

class CheckpointInterruptedStorage extends MemoryStoragePort {
  override transaction<TResult>(stores: readonly PrivateStoreName[], operation: (session: StorageSession) => Promise<TResult>): Promise<TResult> {
    return super.transaction(stores, async (session) => operation({
      ...session,
      putFavoriteInventoryCheckpoint: async () => { throw new Error('suspended'); },
    }));
  }
}

describe('reconcileFavoriteSourcePresence', () => {
  it('B-03 marks a missing browser observation detached without deleting private data', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([first, second], storage, '2026-09-07T12:00:00.000Z');
    await expect(reconcileFavoriteSourcePresence([second], storage)).resolves.toEqual({ detached: 1, observed: 1 });
    const sources = await storage.listFavoriteSources({ limit: 10 });
    expect(sources.map((source) => [source.bookmarkId, source.presence])).toEqual([['first', 'detached'], ['second', 'observed']]);
    const detached = sources[0];
    if (detached === undefined) throw new Error('Expected detached source.');
    await expect(storage.getFavoriteParseArtifact(detached.id)).resolves.toBeDefined();
    expect(detached.reviewId).toBeUndefined();
  });

  it('commits each presence page and its cursor in one transaction', async () => {
    const storage = new MemoryStoragePort();
    const favorites = Array.from({ length: 101 }, (_, index) => ({ ...first, bookmarkId: `bookmark-${index.toString().padStart(3, '0')}`, order: index }));
    await importFavoriteSources(favorites, storage, '2026-09-07T12:00:00.000Z');
    for (const favorite of favorites) await storage.putFavoriteInventoryMark({ bookmarkId: favorite.bookmarkId, sessionId: 'presence-session' });
    const checkpoint = { id: 'favorite-inventory' as const, phase: 'presence' as const, sessionId: 'presence-session', startedAt: '2026-09-07T12:00:00.000Z', status: 'active' as const };
    await storage.putFavoriteInventoryCheckpoint(checkpoint);

    const firstPage = await reconcileFavoriteSourcePresencePageForInventory(checkpoint, storage);
    expect(firstPage).toMatchObject({ observed: 100, detached: 0, checkpoint: { phase: 'presence', status: 'active' } });
    const secondPage = await reconcileFavoriteSourcePresencePageForInventory(firstPage.checkpoint, storage);
    expect(secondPage).toMatchObject({ observed: 1, detached: 0, checkpoint: { status: 'complete' } });
    await expect(storage.getFavoriteInventoryCheckpoint()).resolves.toEqual(secondPage.checkpoint);
  });

  it('rolls back presence changes when the final checkpoint write is interrupted', async () => {
    const storage = new CheckpointInterruptedStorage();
    await importFavoriteSources([first], storage, '2026-09-07T12:00:00.000Z');
    const checkpoint = { id: 'favorite-inventory' as const, phase: 'presence' as const, sessionId: 'interrupted-session', startedAt: '2026-09-07T12:00:00.000Z', status: 'active' as const };
    await storage.putFavoriteInventoryCheckpoint(checkpoint);

    await expect(reconcileFavoriteSourcePresencePageForInventory(checkpoint, storage)).rejects.toThrow('suspended');
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.presence).toBe('observed');
    await expect(storage.getFavoriteInventoryCheckpoint()).resolves.toEqual(checkpoint);
  });
});
