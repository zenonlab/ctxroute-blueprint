import { describe, expect, it } from 'vitest';
import { loadLibraryOffline, observeProgress, preserveWorkAfterBookmarkRemoval } from '../../packages/application/src';
import { MemoryStoragePort } from '../../packages/contracts/src/memory-storage-port';
import { createLibrary, createProgress, createWork, libraryId, progressId, workId } from '../../packages/domain/src';

describe('offline library and automatic progress', () => {
  it('keeps the local library available when no remote capability exists', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_offline-one');
    const library = createLibrary(libraryId('library_primary'), [id]);
    const work = createWork({ id, mediaKind: 'manga', preferredTitle: 'Witch Hat Atelier', externalReferences: [] });
    await storage.transaction(['works', 'libraries'], async (session) => {
      await session.putWork(work);
      await session.putLibrary(library);
    });

    const snapshot = await loadLibraryOffline(storage, library.id);
    expect(snapshot?.works).toEqual([work]);
    expect(snapshot?.missingWorkIds).toEqual([]);
    expect(await preserveWorkAfterBookmarkRemoval(storage, library.id, id)).toBe('preserved');
    expect(await storage.getWork(id)).toEqual(work);
  });

  it('persists increases automatically and ignores equal or lower observations', async () => {
    const storage = new MemoryStoragePort();
    const id = progressId('progress_primary');
    await storage.putProgress(createProgress({ id, kind: 'chapter', value: 12, workId: workId('work_progress-one') }));

    const ahead = await observeProgress(storage, { observedAt: '2026-09-04T08:00:00.000Z', progressId: id, value: 15 });
    expect(ahead.relation).toBe('ahead');
    expect(ahead.explicit.value).toBe(15);
    expect((await storage.getProgress(id))?.value).toBe(15);

    const equal = await observeProgress(storage, { observedAt: '2026-09-04T08:30:00.000Z', progressId: id, value: 15 });
    expect(equal.relation).toBe('equal');
    expect(equal.explicit.value).toBe(15);

    const regression = await observeProgress(storage, { observedAt: '2026-09-04T09:00:00.000Z', progressId: id, value: 7 });
    expect(regression.relation).toBe('regression');
    expect(regression.explicit.value).toBe(15);
    expect((await storage.getProgress(id))?.value).toBe(15);
  });
});
