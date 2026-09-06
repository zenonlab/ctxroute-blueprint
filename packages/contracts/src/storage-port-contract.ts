import type { StoragePort } from '@tobirink/application';
import { agendaEntryId, createAgendaEntry, createFavoriteSource, createLibrary, createOrganizerConfiguration, createProgress, createReview, createWork, favoriteSourceId, libraryId, progressId, reviewId, workId } from '@tobirink/domain';

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
  const alternateReview = createReview({ id: reviewId('review_contract-alt'), matchedWorkId: id, sourceLabel: 'Source alternative', status: 'resolved', title: work.preferredTitle });
  const source = createFavoriteSource({ bookmarkId: 'bookmark-contract', folderPath: ['Lectures'], id: favoriteSourceId('source_contract'), importedAt: '2026-09-05T20:00:00.000Z', order: 0, reviewId: review.id, title: work.preferredTitle, url: 'https://reader.example/work/contract' });
  const alternateSource = createFavoriteSource({ bookmarkId: 'bookmark-contract-alt', folderPath: ['Lectures'], id: favoriteSourceId('source_contract-alt'), importedAt: '2026-09-05T20:00:00.000Z', order: 1, reviewId: alternateReview.id, title: work.preferredTitle, url: 'https://reader.example/work/alternate' });
  const agenda = createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_contract'), occursAt: '2026-09-08T10:00:00.000Z', releaseLabel: 'Episode contractuel', workId: id });
  const organizer = createOrganizerConfiguration({ folders: [{ conditions: { mediaTypes: ['MANGA'] }, id: 'manga', name: 'Manga' }], updatedAt: '2026-09-06T00:00:00.000Z' });

  await storage.transaction(['works', 'libraries', 'organizer', 'progress', 'reviews', 'favoriteSources', 'agenda'], async (session) => {
    await session.putWork(work);
    await session.putLibrary(library);
    await session.putProgress(progress);
    await session.putReview(review);
    await session.putReview(alternateReview);
    await session.putFavoriteSource(source);
    await session.putFavoriteSource(alternateSource);
    await session.putAgendaEntry(agenda);
    await session.putOrganizerConfiguration(organizer);
  });
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'work round-trip');
  assert((await storage.getLibrary(library.id))?.workIds[0] === id, 'library round-trip');
  assert((await storage.getProgress(progress.id))?.value === 12, 'progress round-trip');
  assert((await storage.findProgressByWorkId(id))?.id === progress.id, 'progress lookup by Work');
  assert((await storage.getOrganizerConfiguration())?.folders[0]?.id === 'manga', 'organizer configuration round-trip');
  assert((await storage.getFavoriteSource(source.id))?.url === source.url, 'favorite source round-trip');
  assert((await storage.findFavoriteSourceByReviewId(review.id))?.id === source.id, 'favorite source lookup by Review');
  assert((await storage.listFavoriteSources({ limit: 1 }))[0]?.id === source.id, 'favorite source bounded listing');
  assert((await storage.listFavoriteSources({ afterId: alternateSource.id, limit: 1 })).length === 0, 'favorite source stable cursor');
  assert((await storage.listReviews({ limit: 1, status: 'resolved' }))[0]?.id === review.id, 'review bounded status listing');
  assert((await storage.listReviewsByWorkId({ limit: 2, workId: id })).length === 2, 'multiple Reviews may resolve to one work');
  assert((await storage.listReviews({ limit: 1, status: 'pending' })).length === 0, 'review status filtering');
  assert((await storage.listAgendaEntries({ from: '2026-09-08T00:00:00.000Z', limit: 1, to: '2026-09-09T00:00:00.000Z' }))[0]?.id === agenda.id, 'agenda bounded period listing');

  let invalidOrganizerRejected = false;
  try {
    await storage.putOrganizerConfiguration({ ...organizer, updatedAt: 'invalid' });
  } catch {
    invalidOrganizerRejected = true;
  }
  assert(invalidOrganizerRejected, 'organizer configuration writes must be revalidated');

  let duplicateBookmarkRejected = false;
  try {
    await storage.putFavoriteSource(createFavoriteSource({ ...source, id: favoriteSourceId('source_duplicate') }));
  } catch {
    duplicateBookmarkRejected = true;
  }
  assert(duplicateBookmarkRejected, 'bookmark identity must be unique across favorite sources');

  let duplicateReviewRejected = false;
  try {
    await storage.putFavoriteSource(createFavoriteSource({ ...source, bookmarkId: 'bookmark-other', id: favoriteSourceId('source_other') }));
  } catch {
    duplicateReviewRejected = true;
  }
  assert(duplicateReviewRejected, 'Review identity must be unique across favorite sources');

  let limitRejected = false;
  try {
    await storage.listFavoriteSources({ limit: 101 });
  } catch {
    limitRejected = true;
  }
  assert(limitRejected, 'favorite source listing must enforce its bound');

  let reviewLimitRejected = false;
  try {
    await storage.listReviews({ limit: 101, status: 'pending' });
  } catch {
    reviewLimitRejected = true;
  }
  assert(reviewLimitRejected, 'review listing must enforce its bound');

  let reviewMatchLimitRejected = false;
  try {
    await storage.listReviewsByWorkId({ limit: 101, workId: id });
  } catch {
    reviewMatchLimitRejected = true;
  }
  assert(reviewMatchLimitRejected, 'matched Review listing must enforce its bound');

  let agendaLimitRejected = false;
  try {
    await storage.listAgendaEntries({ from: '2026-09-08T00:00:00.000Z', limit: 101, to: '2026-09-09T00:00:00.000Z' });
  } catch {
    agendaLimitRejected = true;
  }
  assert(agendaLimitRejected, 'agenda listing must enforce its bound');

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
