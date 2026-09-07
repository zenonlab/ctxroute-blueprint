import { verifyStoragePortContract } from '@tobirink/contracts';
import { importFavoriteSources } from '@tobirink/application';
import {
  agendaEntryId,
  createAgendaEntry,
  createFavoriteSource,
  createReminder,
  createReview,
  createWork,
  favoriteSourceId,
  reminderId,
  reviewId,
  workId,
} from '@tobirink/domain';
import { DexieOrganizerSnapshotStore, DexieStoragePort, verifyDatabaseIntegrity } from '../src';

const storage = new DexieStoragePort(`tobirink-contract-${Date.now()}`);
const organizerSnapshots = new DexieOrganizerSnapshotStore(`tobirink-organizer-contract-${Date.now()}`);

try {
  await verifyStoragePortContract(() => storage);
  const work = workId('work_browser');
  const workRecord = createWork({ externalReferences: [], id: work, mediaKind: 'manga', preferredTitle: 'Browser contract' });
  const review = createReview({ id: reviewId('review_browser'), sourceLabel: 'Fixture', status: 'pending', title: 'Browser contract' });
  const agenda = createAgendaEntry({ availability: 'unavailable', id: agendaEntryId('agenda_browser'), releaseLabel: 'Unknown release', workId: work });
  const reminder = createReminder({ agendaEntryId: agenda.id, channel: 'badge', enabled: true, id: reminderId('reminder_browser'), leadMinutes: 0 });
  await storage.transaction(['works', 'reviews', 'agenda', 'reminders'], async (session) => {
    await session.putWork(workRecord);
    await session.putReview(review);
    await session.putAgendaEntry(agenda);
    await session.putReminder(reminder);
  });
  if (!(await storage.getReview(review.id)) || !(await storage.getAgendaEntry(agenda.id)) || !(await storage.getReminder(reminder.id))) {
    throw new Error('Review, agenda or reminder did not round-trip through IndexedDB.');
  }
  await importFavoriteSources([{ bookmarkId: 'browser-atomic', folderPath: ['Mangas'], order: 0, state: 'eligible', title: 'Atomic fixture', url: 'https://reader.example/manga/atomic-fixture' }], storage, '2026-09-07T12:00:00.000Z');
  const imported = (await storage.listFavoriteSources({ limit: 10 })).find((source) => source.bookmarkId === 'browser-atomic');
  if (imported === undefined || await storage.getFavoriteParseArtifact(imported.id) === undefined) throw new Error('Favorite artifact did not share the import transaction.');
  const tasks = await storage.database.favoriteResolutionTasks.toArray();
  if (tasks.length !== 1 || tasks[0]?.state !== 'READY' || tasks[0].lane !== 'routing') throw new Error('Favorite resolution outbox did not share the import transaction.');
  await storage.database.table('organizer').put({
    folders: [{ children: [], enabled: true, id: 'invalid id', name: 'Invalid' }],
    id: 'organizer',
    updatedAt: '2026-09-06T00:00:00.000Z',
  });
  let invalidOrganizerRejected = false;
  try {
    await storage.getOrganizerConfiguration();
  } catch {
    invalidOrganizerRejected = true;
  }
  if (!invalidOrganizerRejected) throw new Error('IndexedDB adapter returned an invalid organizer configuration.');
  await storage.database.organizer.clear();
  await storage.putFavoriteSource(createFavoriteSource({
    bookmarkId: 'bookmark_orphan',
    folderPath: ['Mangas'],
    id: favoriteSourceId('source_orphan'),
    importedAt: '2026-09-05T10:00:00.000Z',
    order: 0,
    reviewId: reviewId('review_missing'),
    title: 'Orphan source',
    url: 'https://example.com/orphan',
  }));
  let integrityRejected = false;
  try {
    await verifyDatabaseIntegrity(storage.database);
  } catch (error) {
    integrityRejected = error instanceof Error && error.message.includes('references a missing review');
  }
  if (!integrityRejected) throw new Error('IndexedDB integrity accepted an orphan favorite source.');
  const organizerSnapshot = { capturedAt: '2026-09-06T10:00:00.000Z', format: 'tobirink-organizer-bookmarks' as const, nodes: [{ id: 'bookmark-browser', index: 0, parentId: 'toolbar', title: 'Private title', url: 'https://reader.example/private' }], version: 1 as const };
  await organizerSnapshots.save(organizerSnapshot);
  if (JSON.stringify(await organizerSnapshots.load()) !== JSON.stringify(organizerSnapshot)) throw new Error('Organizer snapshot did not round-trip through IndexedDB.');
  document.body.dataset.status = 'passed';
  document.body.textContent = 'IndexedDB StoragePort contract passed';
} catch (error) {
  document.body.dataset.status = 'failed';
  document.body.textContent = error instanceof Error ? error.message : String(error);
} finally {
  organizerSnapshots.close();
  await storage.deleteDatabase();
}
