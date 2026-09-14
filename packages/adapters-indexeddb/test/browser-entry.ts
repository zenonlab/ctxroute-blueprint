import { verifyStoragePortContract } from '@tobirink/contracts';
import { commitTask, importFavoriteSources, readLibraryCatalogue, recordTaskEffect } from '@tobirink/application';
import {
  agendaEntryId,
  createAgendaEntry,
  createFavoriteSource,
  createLibrary,
  createProgress,
  createReminder,
  createReview,
  createWork,
  favoriteSourceId,
  libraryId,
  progressId,
  reminderId,
  reviewId,
  workId,
} from '@tobirink/domain';
import { DexieFavoriteResolutionOutbox, DexieOrganizerSnapshotStore, DexiePrivateRecoveryStore, DexieProviderIdentityRecoveryStateAdapter, DexieStoragePort, TobirinkDatabase, verifyDatabaseIntegrity } from '../src';

const storage = new DexieStoragePort(`tobirink-contract-${Date.now()}`);
const organizerSnapshots = new DexieOrganizerSnapshotStore(`tobirink-organizer-contract-${Date.now()}`);

try {
  await verifyStoragePortContract(() => storage);
  const recoveryState = { schemaVersion: 1 as const, restoration: { digest: 'a'.repeat(64), index: 2, complete: false, missingCount: 0 } };
  await new DexieProviderIdentityRecoveryStateAdapter(storage.database).save(recoveryState);
  storage.database.close();
  const reopened = new TobirinkDatabase(storage.database.name);
  if (JSON.stringify(await new DexieProviderIdentityRecoveryStateAdapter(reopened).read()) !== JSON.stringify(recoveryState)) throw new Error('Recovery checkpoint did not survive reopening IndexedDB.');
  reopened.close();
  await storage.database.open();
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
  const catalogueWorks = Array.from({ length: 500 }, (_, index) => createWork({
    externalReferences: [{ externalId: String(index + 1), provider: 'anilist' }],
    hydration: {
      candidate: { externalId: String(index + 1), genres: [index % 2 === 0 ? 'Fantasy' : 'Adventure'], mediaKind: 'ANIME', metadataVersion: 1, preSerialization: false, provider: 'anilist', startYear: 2000 + (index % 25), titles: [`Catalogue ${index}`] },
      favoriteAliasKeys: [], hydratedAt: '2026-09-09T00:00:00.000Z', matcherVersion: 'matcher-v3', providerTitleKeys: [],
    },
    id: workId(`work_catalogue-${String(index).padStart(3, '0')}`),
    mediaKind: 'anime',
    preferredTitle: `Catalogue ${String(index).padStart(3, '0')}`,
  }));
  await storage.database.works.bulkPut(catalogueWorks);
  const catalogueLibrary = createLibrary(libraryId('library_catalogue'), catalogueWorks.map(({ id }) => id));
  await storage.database.libraries.put(catalogueLibrary);
  const catalogueStartedAt = performance.now();
  const catalogue = await readLibraryCatalogue(storage, { facets: { genre: { fantasy: 'include' } }, libraryId: catalogueLibrary.id, limit: 24, sort: 'YEAR_DESC' });
  const catalogueElapsedMs = performance.now() - catalogueStartedAt;
  if (catalogue.items.length !== 24 || catalogue.total !== 250 || catalogue.nextOffset !== 24) throw new Error('IndexedDB catalogue did not filter before stable pagination.');
  if (catalogue.facets.genre.length !== 2 || catalogue.facets.genre.some(({ count }) => count !== 250)) throw new Error('IndexedDB catalogue facets did not describe the complete bounded corpus.');
  if (JSON.stringify(catalogue).length >= 64 * 1024) throw new Error('IndexedDB catalogue page exceeded the MV3 response budget.');
  if (catalogueElapsedMs >= 200) throw new Error(`IndexedDB catalogue exceeded 200 ms: ${catalogueElapsedMs.toFixed(2)} ms.`);
  document.body.dataset.catalogueMs = catalogueElapsedMs.toFixed(2);
  const mixedStorage = new DexieStoragePort(`tobirink-mixed-catalogue-${Date.now()}`);
  try {
    const resolvedWorks = Array.from({ length: 700 }, (_, index) => createWork({
      externalReferences: [{ externalId: `mixed-${index}`, provider: 'anilist' }],
      id: workId(`work_mixed-${String(index).padStart(3, '0')}`),
      mediaKind: 'anime',
      preferredTitle: `Resolved ${String(index).padStart(3, '0')}`,
    }));
    await mixedStorage.database.works.bulkPut(resolvedWorks);
    await mixedStorage.database.progress.bulkPut(resolvedWorks.slice(0, 350).map((item, index) => createProgress({ id: progressId(`progress_mixed-${String(index).padStart(3, '0')}`), kind: 'episode', maximum: 12, value: index % 12, workId: item.id })));
    const mixedLibrary = createLibrary(libraryId('library_mixed1'), resolvedWorks.map(({ id }) => id));
    await mixedStorage.database.libraries.put(mixedLibrary);
    await importFavoriteSources(Array.from({ length: 700 }, (_, index) => ({
      bookmarkId: `mixed-pending-${index}`,
      folderPath: ['Mangas'],
      order: 700 + index,
      state: 'eligible' as const,
      title: `Pending ${String(index).padStart(3, '0')} chapitre ${index % 100}`,
      url: `https://reader.example/title/pending-${index}/chapter-${index % 100}`,
    })), mixedStorage, '2026-09-13T00:00:00.000Z');
    const mixedStartedAt = performance.now();
    const mixed = await readLibraryCatalogue(mixedStorage, { libraryId: mixedLibrary.id, limit: 24, sort: 'ADDED_DESC' });
    const mixedElapsedMs = performance.now() - mixedStartedAt;
    if (mixed.statistics.total !== 1400 || mixed.items.length !== 24 || mixed.nextOffset !== 24) throw new Error('Mixed 1400-favorite catalogue lost resolved or provisional entries.');
    if (mixedElapsedMs >= 500) throw new Error(`Mixed 1400-favorite catalogue exceeded 500 ms: ${mixedElapsedMs.toFixed(2)} ms.`);
    document.body.dataset.mixedCatalogueMs = mixedElapsedMs.toFixed(2);
  } finally {
    await mixedStorage.deleteDatabase();
  }
  await importFavoriteSources([{ bookmarkId: 'browser-atomic', folderPath: ['Mangas'], order: 0, state: 'eligible', title: 'Atomic fixture', url: 'https://reader.example/manga/atomic-fixture' }], storage, '2026-09-07T12:00:00.000Z');
  const imported = (await storage.listFavoriteSources({ limit: 10 })).find((source) => source.bookmarkId === 'browser-atomic');
  if (imported === undefined || await storage.getFavoriteParseArtifact(imported.id) === undefined) throw new Error('Favorite artifact did not share the import transaction.');
  const tasks = await storage.database.favoriteResolutionTasks.toArray();
  if (tasks.length !== 1 || tasks[0]?.state !== 'READY' || tasks[0].lane !== 'routing') throw new Error('Favorite resolution outbox did not share the import transaction.');
  const resolutionOutbox = new DexieFavoriteResolutionOutbox(storage.database);
  const claimed = await resolutionOutbox.claimNext({ claimedAt: '2026-09-07T12:01:00.000Z', claimExpiresAt: '2026-09-07T12:02:00.000Z', claimToken: 'browser-claim', kind: 'favorite-resolution', lane: 'routing' });
  if (claimed?.state !== 'CLAIMED' || claimed.availableAt !== '2026-09-07T12:02:00.000Z') throw new Error('Favorite resolution outbox did not claim through its compound due index.');
  if (await resolutionOutbox.nextAvailableAt({ kind: 'favorite-resolution', lane: 'routing' }) !== '2026-09-07T12:02:00.000Z') throw new Error('Favorite resolution outbox did not expose the claimed-task recovery deadline.');
  const committed = commitTask(recordTaskEffect(claimed, 'browser-claim', 'browser:resolved'), 'browser-claim');
  if (imported === undefined) throw new Error('Imported source disappeared before receipt test.');
  await storage.transaction(['favoriteResolutionReceipts', 'favoriteResolutionTasks'], async (session) => {
    await session.putFavoriteResolutionTask(committed);
    await session.putFavoriteResolutionReceipt({ completedAt: '2026-09-07T12:03:00.000Z', effectDigest: 'browser:resolved', id: `${imported.id}:favorite-resolution`, idempotencyKey: committed.idempotencyKey, sourceId: imported.id });
  });
  if (await resolutionOutbox.compactCommitted({ before: '2026-10-08T00:00:00.000Z', limit: 8 }) !== 1 || await storage.getFavoriteResolutionTask(committed.id) !== undefined) throw new Error('Committed resolution task did not compact into its receipt.');
  if (await resolutionOutbox.nextAvailableAt({ kind: 'favorite-resolution', lane: 'routing' }) !== undefined) throw new Error('Favorite resolution outbox retained a wake deadline after convergence.');
  if (await storage.getFavoriteResolutionReceipt(`${imported.id}:favorite-resolution`) === undefined) throw new Error('Resolution receipt disappeared during compaction.');
  await importFavoriteSources([{ bookmarkId: 'browser-blocked', folderPath: ['Mangas'], order: 1, state: 'eligible', title: 'Blocked fixture', url: 'https://reader.example/manga/blocked-fixture' }], storage, '2026-09-07T12:10:00.000Z');
  const blockedSource = (await storage.listFavoriteSources({ limit: 10 })).find((source) => source.bookmarkId === 'browser-blocked');
  const blockedClaim = await resolutionOutbox.claimNext({ claimedAt: '2026-09-07T12:11:00.000Z', claimExpiresAt: '2026-09-07T12:12:00.000Z', claimToken: 'blocked-claim', kind: 'favorite-resolution', lane: 'routing' });
  if (blockedSource === undefined || blockedClaim === undefined) throw new Error('Blocked retry fixture was not imported and claimed.');
  await resolutionOutbox.block(blockedClaim.id, 'blocked-claim', 'AUTOMATIC_ATTEMPT_LIMIT');
  await storage.putFavoriteSource(createFavoriteSource({ ...blockedSource, resolution: { kind: 'RETRYABLE', reason: 'AUTOMATIC_ATTEMPT_LIMIT' } }));
  if (await resolutionOutbox.retryBlocked({ availableAt: '2026-09-07T12:13:00.000Z', kind: 'favorite-resolution', lane: 'routing', limit: 1 }) !== 1) throw new Error('Explicit blocked retry did not reset one task.');
  const resetTask = await storage.getFavoriteResolutionTask(blockedClaim.id);
  const resetSource = await storage.getFavoriteSource(blockedSource.id);
  if (resetTask?.state !== 'RETRY_AT' || resetTask.attempt !== 0 || resetSource === undefined || resetSource.resolution !== undefined || resetSource.url !== blockedSource.url) throw new Error('Explicit blocked retry did not preserve the source and clear only its automatic failure.');
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
  const recoveryDatabase = new TobirinkDatabase(`tobirink-private-recovery-${Date.now()}`);
  const privateRecovery = new DexiePrivateRecoveryStore(recoveryDatabase);
  const originalRecoveryWork = createWork({ externalReferences: [], id: workId('work_recovery_original'), mediaKind: 'manga', preferredTitle: 'Original recovery work' });
  const replacementRecoveryWork = createWork({ externalReferences: [], id: workId('work_recovery_replacement'), mediaKind: 'anime', preferredTitle: 'Replacement recovery work' });
  await recoveryDatabase.works.put(originalRecoveryWork);
  await new DexieProviderIdentityRecoveryStateAdapter(recoveryDatabase).save({ schemaVersion: 1 });
  const initialRecoverySnapshot = await privateRecovery.readSnapshot();
  await privateRecovery.replaceSnapshot({ ...initialRecoverySnapshot, works: [replacementRecoveryWork] });
  if (await recoveryDatabase.works.get(originalRecoveryWork.id) !== undefined || await recoveryDatabase.works.get(replacementRecoveryWork.id) === undefined) throw new Error('Private recovery did not atomically replace Works.');
  if (await recoveryDatabase.providerIdentityRecovery.count() !== 0) throw new Error('Private recovery retained stale derived recovery state.');
  await recoveryDatabase.delete();
  document.body.dataset.status = 'passed';
  document.body.textContent = `IndexedDB StoragePort contract passed; 500-work catalogue ${document.body.dataset.catalogueMs} ms; mixed 1400-favorite catalogue ${document.body.dataset.mixedCatalogueMs} ms`;
} catch (error) {
  document.body.dataset.status = 'failed';
  document.body.textContent = error instanceof Error ? error.message : String(error);
} finally {
  organizerSnapshots.close();
  await storage.deleteDatabase();
}
