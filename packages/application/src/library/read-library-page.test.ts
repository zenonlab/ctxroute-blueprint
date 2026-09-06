import { describe, expect, it } from 'vitest';
import { createLibrary, createWork, libraryId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { libraryPageLimit, readLibraryPage } from './read-library-page';

describe('readLibraryPage', () => {
  it('reads stable bounded pages and reports missing local works', async () => {
    const storage = new MemoryStoragePort();
    const ids = Array.from({ length: libraryPageLimit + 2 }, (_, index) => workId(`work_library-${String(index).padStart(2, '0')}`));
    await storage.putLibrary(createLibrary(libraryId('library_primary'), ids));
    for (const id of ids.filter((_, index) => index !== 3)) {
      await storage.putWork(createWork({ externalReferences: [], id, mediaKind: 'manga', preferredTitle: id }));
    }

    const first = await readLibraryPage(storage, { libraryId: libraryId('library_primary') });
    expect(first.items).toHaveLength(libraryPageLimit - 1);
    expect(first.missingWorkIds).toEqual([ids[3]]);
    expect(first.nextCursor).toBe(ids[libraryPageLimit - 1]);

    const second = await readLibraryPage(storage, { afterId: first.nextCursor, libraryId: libraryId('library_primary') });
    expect(second.items.map(({ id }) => id)).toEqual(ids.slice(libraryPageLimit));
    expect(second.nextCursor).toBeUndefined();
  });

  it('returns an empty page for an absent library and rejects a stale cursor', async () => {
    const storage = new MemoryStoragePort();
    const id = libraryId('library_primary');
    await expect(readLibraryPage(storage, { libraryId: id })).resolves.toEqual({ items: [], missingWorkIds: [] });
    await storage.putLibrary(createLibrary(id));
    await expect(readLibraryPage(storage, { afterId: workId('work_missing-one'), libraryId: id })).rejects.toThrow(/cursor/u);
  });
});
