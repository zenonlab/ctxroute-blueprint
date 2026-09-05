import type { StoragePort } from '@tobirink/application';
import { createFavoriteSource, createLibrary, createProgress, createReview, createWork, favoriteSourceId, libraryId, progressId, reviewId, workId } from '@tobirink/domain';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`StoragePort contract failed: ${message}`);
}

export async function verifyStoragePortContract(createStorage: () => Promise<StoragePort> | StoragePort) {
  const storage = await createStorage();
  const id = workId('work_contract');
  const work = createWork({ externalReferences: [], id, mediaKind: 'manga', preferredTitle: 'Contract work' });
  const library = createLibrary(libraryId('library_contract'), [id]);
  const progress = createProgress({ id: progressId('progress_contract'), kind: 'chapter', value: 12, workId: id });
  const review = createReview({ id: reviewId('review_contract'), matchedWorkId: id, sourceLabel: 'Source contractuelle', status: 'resolved', title: work.preferredTitle });
  const source = createFavoriteSource({ bookmarkId: 'bookmark-contract', folderPath: ['Lectures'], id: favoriteSourceId('source_contract'), importedAt: '2026-09-05T20:00:00.000Z', order: 0, reviewId: review.id, title: work.preferredTitle, url: 'https://reader.example/work/contract' });

  await storage.transaction(['works', 'libraries', 'progress', 'reviews', 'favoriteSources'], async (session) => {
    await session.putWork(work);
    await session.putLibrary(library);
    await session.putProgress(progress);
    await session.putReview(review);
    await session.putFavoriteSource(source);
  });
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'work round-trip');
  assert((await storage.getLibrary(library.id))?.workIds[0] === id, 'library round-trip');
  assert((await storage.getProgress(progress.id))?.value === 12, 'progress round-trip');
  assert((await storage.getFavoriteSource(source.id))?.url === source.url, 'favorite source round-trip');
  assert((await storage.listFavoriteSources({ limit: 1 }))[0]?.id === source.id, 'favorite source bounded listing');
  assert((await storage.listFavoriteSources({ afterId: source.id, limit: 1 })).length === 0, 'favorite source stable cursor');

  let duplicateBookmarkRejected = false;
  try {
    await storage.putFavoriteSource(createFavoriteSource({ ...source, id: favoriteSourceId('source_duplicate') }));
  } catch {
    duplicateBookmarkRejected = true;
  }
  assert(duplicateBookmarkRejected, 'bookmark identity must be unique across favorite sources');

  let limitRejected = false;
  try {
    await storage.listFavoriteSources({ limit: 101 });
  } catch {
    limitRejected = true;
  }
  assert(limitRejected, 'favorite source listing must enforce its bound');

  let scopeRejected = false;
  try {
    await storage.transaction(['works'], async (session) => session.putLibrary(library));
  } catch {
    scopeRejected = true;
  }
  assert(scopeRejected, 'writes outside a declared aggregate scope must fail');

  try {
    await storage.transaction(['works'], async (session) => {
      await session.putWork(createWork({ ...work, preferredTitle: 'Rolled back' }));
      throw new Error('interrupt transaction');
    });
  } catch {
    // Expected contract interruption.
  }
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'interrupted transaction rollback');
}
