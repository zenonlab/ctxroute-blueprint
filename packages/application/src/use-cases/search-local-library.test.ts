import { describe, expect, it } from 'vitest';
import { createLibrary, createWork, libraryId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { localSearchLimit, searchLocalLibrary } from './search-local-library';

describe('searchLocalLibrary', () => {
  it('returns bounded accent-insensitive results from the private library', async () => {
    const storage = new MemoryStoragePort();
    const id = libraryId('library_search');
    const works = [
      createWork({ externalReferences: [], id: workId('work_search-one'), mediaKind: 'anime', preferredTitle: 'Frieren' }),
      createWork({ externalReferences: [], id: workId('work_search-two'), mediaKind: 'manga', preferredTitle: 'L’Été où Hikaru est mort' }),
    ];
    await storage.transaction(['libraries', 'works'], async (session) => {
      await session.putLibrary(createLibrary(id, works.map(({ id: workIdValue }) => workIdValue)));
      for (const work of works) await session.putWork(work);
    });

    await expect(searchLocalLibrary(storage, { libraryId: id, query: 'ete' })).resolves.toMatchObject({
      items: [{ id: 'work_search-two' }],
      truncated: false,
    });
  });

  it('rejects unbounded or empty searches', async () => {
    const storage = new MemoryStoragePort();
    const id = libraryId('library_search');
    await expect(searchLocalLibrary(storage, { libraryId: id, query: '' })).rejects.toThrow(/query/u);
    await expect(searchLocalLibrary(storage, { libraryId: id, limit: localSearchLimit + 1, query: 'a' })).rejects.toThrow(/limit/u);
  });
});
