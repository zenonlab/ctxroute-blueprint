import { describe, expect, it } from 'vitest';
import { addWorkToLibrary, recordProgress, resolveReview } from '@tobirink/application';
import { createProgress, createReview, createWork, libraryId, progressId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from './memory-storage-port';

describe('local application use cases', () => {
  it('adds one work and library membership atomically', async () => {
    const storage = new MemoryStoragePort();
    const work = createWork({ externalReferences: [], id: workId('work_usecase'), mediaKind: 'manga', preferredTitle: 'Frieren' });
    const library = await addWorkToLibrary({ storage }, { libraryId: libraryId('library_usecase'), work });
    expect(library.workIds).toEqual([work.id]);
    expect(await storage.getWork(work.id)).toEqual(work);
  });

  it('records validated progress through StoragePort', async () => {
    const storage = new MemoryStoragePort();
    const progress = createProgress({ id: progressId('progress_usecase'), kind: 'chapter', value: 42, workId: workId('work_usecase') });
    await recordProgress(storage, progress);
    expect(await storage.getProgress(progress.id)).toEqual(progress);
  });

  it('resolves an existing Review without reaching a provider', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_usecase'), sourceLabel: 'Favori', status: 'pending', title: 'Frieren' });
    await storage.putReview(review);
    const resolved = await resolveReview(storage, { reviewId: review.id, workId: workId('work_usecase') });
    expect(resolved).toMatchObject({ matchedWorkId: 'work_usecase', status: 'resolved' });
  });
});
