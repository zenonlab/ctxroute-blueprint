import { describe, expect, it } from 'vitest';
import { createReview, createWork, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { ImportableFavorite } from '../resolution';
import { importFavoriteSources } from './import-favorite-sources';

const importedAt = '2026-09-06T00:00:00.000Z';
const favorite: ImportableFavorite = {
  bookmarkId: '42',
  folderPath: ['Lectures', 'Manga'],
  order: 3,
  state: 'eligible',
  title: 'Frieren chapitre 140',
  url: 'https://reader.example/frieren/140',
};

describe('importFavoriteSources', () => {
  it('atomically creates a private source and pending Review', async () => {
    const storage = new MemoryStoragePort();
    await expect(importFavoriteSources([favorite, { ...favorite, bookmarkId: 'ignored', state: 'ignored' }], storage, importedAt))
      .resolves.toEqual({ ignored: 1, imported: 1 });

    const [source] = await storage.listFavoriteSources({ limit: 10 });
    expect(source).toMatchObject({ bookmarkId: '42', folderPath: ['Lectures', 'Manga'], importedAt, order: 3 });
    expect(source && await storage.getReview(source.reviewId)).toMatchObject({ status: 'pending', title: favorite.title });
    expect(source && await storage.getFavoriteParseArtifact(source.id)).toMatchObject({ artifact: { raw: { title: favorite.title, url: favorite.url } }, recordedAt: importedAt, reviewId: source?.reviewId });
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_4_3432');
    expect(task).toMatchObject({ availableAt: '1970-01-01T00:00:00.000Z', kind: 'favorite-resolution', state: 'READY' });
    expect(task?.payload).toContain(source?.id);
  });

  it('updates placement while preserving import time and a resolved Review', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [initial] = await storage.listFavoriteSources({ limit: 1 });
    if (!initial) throw new Error('Expected imported source.');
    const work = createWork({ externalReferences: [], id: workId('work_frieren140'), mediaKind: 'manga', preferredTitle: 'Frieren' });
    await storage.transaction(['works', 'reviews'], async (session) => {
      await session.putWork(work);
      await session.putReview(createReview({ id: initial.reviewId, matchedWorkId: work.id, sourceLabel: initial.url, status: 'resolved', title: initial.title }));
    });

    await importFavoriteSources([{ ...favorite, folderPath: ['À lire'], order: 0, title: 'Frieren', url: 'https://reader.example/frieren' }], storage, '2026-09-06T01:00:00.000Z');
    const [updated] = await storage.listFavoriteSources({ limit: 1 });
    expect(updated).toMatchObject({ folderPath: ['À lire'], importedAt, order: 0, title: 'Frieren' });
    expect(updated && await storage.getReview(updated.reviewId)).toMatchObject({ matchedWorkId: work.id, status: 'resolved', title: 'Frieren' });
  });

  it('rolls back a batch when one source is invalid', async () => {
    const storage = new MemoryStoragePort();
    const invalid = { ...favorite, bookmarkId: 'invalid', order: -1 };
    await expect(importFavoriteSources([favorite, invalid], storage, importedAt)).rejects.toThrow();
    await expect(storage.listFavoriteSources({ limit: 10 })).resolves.toEqual([]);
    await expect(storage.getReview(reviewId('review_4_3432'))).resolves.toBeUndefined();
    await expect(storage.getFavoriteResolutionTask('favorite-resolution_4_3432')).resolves.toBeUndefined();
  });
});
