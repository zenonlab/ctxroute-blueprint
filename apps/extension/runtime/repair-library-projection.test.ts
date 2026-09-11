import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { createFavoriteSource, createWork, favoriteSourceId, libraryId, workId } from '@tobirink/domain';
import { repairFavoriteLibraryProjection } from './repair-library-projection';

describe('favorite library projection repair', () => {
  it('recovers all observed resolved sources after an interruption without adding sync-only works', async () => {
    const storage = new MemoryStoragePort();
    const library = libraryId('library_primary');
    for (let index = 0; index < 1400; index += 1) {
      const id = workId(`work_repair${String(index).padStart(4, '0')}`);
      await storage.putWork(createWork({ id, externalReferences: [], preferredTitle: 'Synthetic', mediaKind: 'manga' }));
      await storage.putFavoriteSource(createFavoriteSource({ id: favoriteSourceId(`source_repair${String(index).padStart(4, '0')}`), bookmarkId: String(index), folderPath: [], importedAt: '2026-09-12T00:00:00.000Z', order: index, matchedWorkId: id, resolution: { kind: 'RESOLVED' }, presence: 'observed', title: 'Synthetic', url: 'https://reader.example/manga/synthetic' }));
    }
    await storage.putWork(createWork({ id: workId('work_sync-only'), externalReferences: [], preferredTitle: 'Cached only', mediaKind: 'manga' }));
    const list = storage.listFavoriteSources.bind(storage);
    let calls = 0;
    const interrupted = vi.spyOn(storage, 'listFavoriteSources').mockImplementation(async query => { calls += 1; if (calls === 7) throw new Error('suspended'); return list(query); });
    await expect(repairFavoriteLibraryProjection(storage, library)).rejects.toThrow('suspended');
    expect((await storage.getLibrary(library))?.workIds).toHaveLength(600);
    interrupted.mockRestore();
    await repairFavoriteLibraryProjection(storage, library);
    await repairFavoriteLibraryProjection(storage, library);
    expect((await storage.getLibrary(library))?.workIds).toHaveLength(1400);
    expect((await storage.getLibrary(library))?.workIds).not.toContain('work_sync-only');
  });
});
