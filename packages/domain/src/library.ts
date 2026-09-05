import type { LibraryId, WorkId } from './identity';
import { invariant } from './invariant';

export interface Library {
  id: LibraryId;
  workIds: readonly WorkId[];
}

export function createLibrary(id: LibraryId, workIds: readonly WorkId[] = []): Library {
  invariant(new Set(workIds).size === workIds.length, 'duplicate-work', 'A work may belong to a library only once.');
  return Object.freeze({ id, workIds: Object.freeze([...workIds]) });
}

export function addWork(library: Library, id: WorkId): Library {
  invariant(!library.workIds.includes(id), 'duplicate-work', 'A work may belong to a library only once.');
  return createLibrary(library.id, [...library.workIds, id]);
}

export function removeWork(library: Library, id: WorkId): Library {
  return createLibrary(library.id, library.workIds.filter((workId) => workId !== id));
}
