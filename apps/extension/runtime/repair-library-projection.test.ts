import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { createFavoriteSource, createLibrary, createProgress, createReview, createWork, favoriteSourceId, libraryId, progressId, reviewId, workId } from '@tobirink/domain';
import { repairFavoriteLibraryProjection } from './repair-library-projection';

function measureRepair(storage: MemoryStoragePort) {
  const workBatches: number[] = [];
  const reads = { sources: 0, works: 0, workBatches };
  const transaction = storage.transaction.bind(storage);
  const transactions = vi.spyOn(storage, 'transaction').mockImplementation((stores, operation) => transaction(stores, (session) => operation({
    ...session,
    getFavoriteSource: async (id) => { reads.sources += 1; return session.getFavoriteSource(id); },
    getWork: async (id) => { reads.works += 1; return session.getWork(id); },
    getWorks: async (ids) => { reads.workBatches.push(ids.length); return session.getWorks(ids); },
  })));
  return { pages: vi.spyOn(storage, 'listFavoriteSources'), libraries: vi.spyOn(storage, 'getLibrary'), reads, transactions };
}

describe('favorite library projection repair', () => {
  it('scans 1522 pending sources without opening empty repair transactions or rereading individual sources', async () => {
    const storage = new MemoryStoragePort();
    for (let index = 0; index < 1522; index += 1) {
      await storage.putFavoriteSource(createFavoriteSource({
        id: favoriteSourceId(`source_pending${String(index).padStart(4, '0')}`), bookmarkId: String(index),
        folderPath: [], importedAt: '2026-09-23T00:00:00.000Z', order: index,
        presence: 'observed', resolution: { kind: 'RETRYABLE', reason: 'PUBLIC_DISCOVERY_PENDING' },
        title: 'Synthetic', url: 'https://reader.example/manga/synthetic',
      }));
    }
    const measured = measureRepair(storage);
    await repairFavoriteLibraryProjection(storage, libraryId('library_primary'));
    expect(measured.pages).toHaveBeenCalledTimes(16);
    expect(measured.libraries).toHaveBeenCalledOnce();
    expect(measured.transactions).not.toHaveBeenCalled();
    expect(measured.reads).toEqual({ sources: 0, works: 0, workBatches: [] });
  });

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
    const measured = measureRepair(storage);
    await repairFavoriteLibraryProjection(storage, library);
    expect(measured.pages).toHaveBeenCalledTimes(15);
    expect(measured.transactions).not.toHaveBeenCalled();
    expect(measured.reads).toEqual({ sources: 0, works: 0, workBatches: [] });
    expect((await storage.getLibrary(library))?.workIds).toHaveLength(1400);
    expect((await storage.getLibrary(library))?.workIds).not.toContain('work_sync-only');
  });

  it.each(['detached', 'review'] as const)('rechecks a source becoming %s before the write transaction', async (change) => {
    const storage = new MemoryStoragePort();
    const id = workId('work_changed');
    await storage.putWork(createWork({ id, externalReferences: [], preferredTitle: 'Changed', mediaKind: 'manga' }));
    const source = createFavoriteSource({
      id: favoriteSourceId('source_changed'), bookmarkId: 'changed', folderPath: [], importedAt: '2026-09-23T00:00:00.000Z', order: 0,
      matchedWorkId: id, resolution: { kind: 'RESOLVED' }, presence: 'observed', title: 'Changed', url: 'https://reader.example/manga/changed',
    });
    await storage.putFavoriteSource(source);
    const current = change === 'detached'
      ? createFavoriteSource({ ...source, presence: 'detached' })
      : createFavoriteSource({ ...source, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' } });
    const transact = storage.transaction.bind(storage);
    vi.spyOn(storage, 'transaction').mockImplementationOnce(async (stores, operation) => {
      await storage.putFavoriteSource(current);
      return transact(stores, operation);
    });
    await repairFavoriteLibraryProjection(storage, libraryId('library_primary'));
    expect(await storage.getLibrary(libraryId('library_primary'))).toBeUndefined();
    expect(await storage.getFavoriteSource(source.id)).toEqual(current);
  });

  it('batches missing works, preserves unrelated library members and never rewrites private decisions or progress', async () => {
    const storage = new MemoryStoragePort();
    const library = libraryId('library_primary');
    const existing = workId('work_existing');
    const work = createWork({ id: workId('work_repaired'), externalReferences: [], preferredTitle: 'Repaired', mediaKind: 'manga' });
    await storage.putWork(work);
    await storage.putLibrary(createLibrary(library, [existing]));
    const progress = createProgress({ id: progressId('progress_repaired'), kind: 'chapter', value: 12, workId: work.id });
    const review = createReview({ id: reviewId('review_repaired'), decisionOrigin: 'human', matchedWorkId: work.id, sourceLabel: 'Local', status: 'resolved', title: 'Repaired' });
    await storage.putProgress(progress);
    await storage.putReview(review);
    for (const [index, id] of [work.id, work.id, workId('work_missing')].entries()) {
      await storage.putFavoriteSource(createFavoriteSource({
        id: favoriteSourceId(`source_batch${index}`), bookmarkId: String(index), folderPath: [], importedAt: '2026-09-23T00:00:00.000Z', order: index,
        matchedWorkId: id, resolution: { kind: 'RESOLVED' }, presence: 'observed', title: 'Repaired', url: 'https://reader.example/manga/repaired',
      }));
    }
    const measured = measureRepair(storage);
    await repairFavoriteLibraryProjection(storage, library);
    expect(measured.reads).toEqual({ sources: 0, works: 0, workBatches: [2] });
    expect(measured.transactions).toHaveBeenCalledOnce();
    expect((await storage.getLibrary(library))?.workIds).toEqual([existing, work.id]);
    expect(await storage.getWork(work.id)).toEqual(work);
    expect(await storage.getProgress(progress.id)).toEqual(progress);
    expect(await storage.getReview(review.id)).toEqual(review);
  });
});
