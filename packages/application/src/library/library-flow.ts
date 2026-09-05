import type { Library, LibraryId, Work, WorkId } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';

export interface OfflineLibrarySnapshot {
  library: Library;
  missingWorkIds: readonly WorkId[];
  works: readonly Work[];
}

export async function loadLibraryOffline(
  storage: StorageReadPort,
  libraryId: LibraryId,
): Promise<OfflineLibrarySnapshot | undefined> {
  const library = await storage.getLibrary(libraryId);
  if (!library) return undefined;

  const records = await Promise.all(library.workIds.map(async (id) => ({ id, work: await storage.getWork(id) })));
  return {
    library,
    missingWorkIds: records.filter(({ work }) => !work).map(({ id }) => id),
    works: records.flatMap(({ work }) => work ? [work] : []),
  };
}

export async function preserveWorkAfterBookmarkRemoval(
  storage: StorageReadPort,
  libraryId: LibraryId,
  workId: WorkId,
): Promise<'not-in-library' | 'preserved'> {
  const library = await storage.getLibrary(libraryId);
  return library?.workIds.includes(workId) ? 'preserved' : 'not-in-library';
}
