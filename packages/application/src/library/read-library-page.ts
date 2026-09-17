import { isContentVisible } from '@tobirink/domain';
import type { LibraryId, Work, WorkId } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';

export const libraryPageLimit = 24;

export interface LibraryPageSnapshot {
  items: readonly Work[];
  missingWorkIds: readonly WorkId[];
  nextCursor?: WorkId;
}

export async function readLibraryPage(
  storage: StorageReadPort,
  input: { afterId?: WorkId; libraryId: LibraryId; showAdultContent?: boolean },
): Promise<LibraryPageSnapshot> {
  const library = await storage.getLibrary(input.libraryId);
  if (!library) return { items: [], missingWorkIds: [] };

  const start = input.afterId === undefined ? 0 : library.workIds.indexOf(input.afterId) + 1;
  if (input.afterId !== undefined && start === 0) throw new Error('Library cursor is no longer available.');

  const selectedIds = library.workIds.slice(start, start + libraryPageLimit);
  const records = await Promise.all(selectedIds.map(async (id) => ({ id, work: await storage.getWork(id) })));
  const hasMore = start + selectedIds.length < library.workIds.length;
  const lastId = selectedIds.at(-1);

  const page: LibraryPageSnapshot = {
    items: records.flatMap(({ work }) => work && (input.showAdultContent === undefined || isContentVisible(work.hydration?.candidate, input.showAdultContent)) ? [work] : []),
    missingWorkIds: records.filter(({ work }) => !work).map(({ id }) => id),
  };
  return hasMore && lastId ? { ...page, nextCursor: lastId } : page;
}
