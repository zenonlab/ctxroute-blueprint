import type { LibraryId, Work } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';

export const localSearchLimit = 24;
export const localSearchScanLimit = 500;

export function normalizeLocalSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('fr');
}

export interface LocalLibrarySearchSnapshot {
  items: readonly Work[];
  truncated: boolean;
}

export async function searchLocalLibrary(
  storage: StorageReadPort,
  input: { libraryId: LibraryId; limit?: number; query: string },
): Promise<LocalLibrarySearchSnapshot> {
  const query = normalizeLocalSearch(input.query);
  if (!query || input.query.length > 200) throw new TypeError('Local search requires a query between 1 and 200 characters.');
  const limit = input.limit ?? localSearchLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > localSearchLimit) {
    throw new RangeError('Local search limit must be between 1 and 24.');
  }

  const library = await storage.getLibrary(input.libraryId);
  if (!library) return { items: [], truncated: false };
  const selectedIds = library.workIds.slice(0, localSearchScanLimit);
  const works = await Promise.all(selectedIds.map((id) => storage.getWork(id)));
  const matches = works.flatMap((work) => work && normalizeLocalSearch(work.preferredTitle).includes(query) ? [work] : []);
  return Object.freeze({
    items: Object.freeze(matches.slice(0, limit)),
    truncated: library.workIds.length > localSearchScanLimit || matches.length > limit,
  });
}
