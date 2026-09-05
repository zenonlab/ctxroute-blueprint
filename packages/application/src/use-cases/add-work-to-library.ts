import { addWork, createLibrary } from '@tobirink/domain';
import type { LibraryId, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export interface AddWorkToLibraryDependencies {
  storage: StoragePort;
}

export async function addWorkToLibrary(
  { storage }: AddWorkToLibraryDependencies,
  input: { libraryId: LibraryId; work: Work },
) {
  return storage.transaction(['works', 'libraries'], async (session) => {
    const current = await session.getLibrary(input.libraryId) ?? createLibrary(input.libraryId);
    const library = addWork(current, input.work.id);
    await session.putWork(input.work);
    await session.putLibrary(library);
    return library;
  });
}
