import Dexie from 'dexie';
import before from './fixtures/v1-before.json';
import after from './fixtures/v2-after.json';
import versionThree from './fixtures/v3-after.json';
import { DexiePublicReleaseFallbackStore, DexieStoragePort, TobirinkDatabase, verifyDatabaseIntegrity } from '../src';
import { importFavoriteSources, readReviewQueue } from '@tobirink/application';
import { createFavoriteSource, createReview, favoriteSourceId, reviewId } from '@tobirink/domain';

async function deleteDatabase(name: string): Promise<void> {
  await Dexie.delete(name);
}

async function seedVersion1(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(1).stores({
    agenda: '&id, workId, occursAt, availability', libraries: '&id', progress: '&id, workId, kind',
    reminders: '&id, agendaEntryId, channel', reviews: '&id, status', works: '&id, mediaKind, title',
  });
  await database.table('works').bulkAdd(before.works);
  database.close();
}

async function seedVersion2(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(2).stores({
    agenda: '&id, workId, occursAt, availability', libraries: '&id', progress: '&id, workId, kind',
    reminders: '&id, agendaEntryId, channel', reviews: '&id, status', works: '&id, mediaKind, preferredTitle',
  });
  await database.table('works').bulkAdd(after.works);
  database.close();
}

const resolvedReview = {
  id: 'review_migration',
  matchedWorkId: 'work_migration',
  sourceLabel: 'Fixture',
  status: 'resolved',
  title: 'Migration fixture',
};
const favoriteSource = {
  bookmarkId: 'bookmark_migration',
  folderPath: ['Lectures'],
  id: 'source_migration',
  importedAt: '2026-09-05T00:00:00.000Z',
  order: 0,
  reviewId: 'review_migration',
  title: 'Migration fixture',
  url: 'https://reader.example/migration',
};

async function seedVersion3(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(3).stores({
    agenda: '&id, workId, occursAt, availability', favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
    libraries: '&id', progress: '&id, workId, kind', reminders: '&id, agendaEntryId, channel',
    reviews: '&id, status', works: '&id, mediaKind, preferredTitle',
  });
  await database.table('works').bulkAdd(versionThree.works);
  await database.table('reviews').add(resolvedReview);
  await database.table('favoriteSources').add(favoriteSource);
  database.close();
}

async function seedVersion4(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(4).stores({
    agenda: '&id, workId, occursAt, availability', favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
    libraries: '&id', progress: '&id, workId, kind', reminders: '&id, agendaEntryId, channel',
    reviews: '&id, status, matchedWorkId', works: '&id, mediaKind, preferredTitle',
  });
  await database.table('works').bulkAdd(versionThree.works);
  await database.table('reviews').add(resolvedReview);
  await database.table('favoriteSources').add(favoriteSource);
  database.close();
}

async function seedVersion5(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(5).stores({
    agenda: '&id, workId, occursAt, availability', favoriteSources: '&id, &bookmarkId, reviewId, importedAt',
    libraries: '&id', organizer: '&id', progress: '&id, workId, kind', reminders: '&id, agendaEntryId, channel',
    reviews: '&id, status, matchedWorkId', works: '&id, mediaKind, preferredTitle',
  });
  await database.table('works').bulkAdd(versionThree.works);
  await database.table('reviews').add(resolvedReview);
  await database.table('favoriteSources').add(favoriteSource);
  database.close();
}

async function seedVersion8(name: string, version = 8): Promise<void> {
  const database = new Dexie(name);
  database.version(version).stores({
    agenda: '&id, workId, occursAt, availability',
    favoriteArtifacts: '&sourceId, reviewId, recordedAt, artifact.semanticFingerprint',
    favoriteBookmarkMutations: '&bookmarkId, sequence, kind',
    favoriteInventoryCheckpoints: '&id, status, sessionId', favoriteInventoryMarks: '&bookmarkId, sessionId',
    favoriteProviderRateCheckpoints: '&provider, nextAllowedAt',
    favoriteResolutionReceipts: '&id, &idempotencyKey, sourceId, completedAt',
    favoriteResolutionTasks: '&id, &idempotencyKey, kind, lane, state, availableAt, [kind+lane+state+availableAt], [state+claimedAt]',
    favoriteReviewCandidateSets: '&reviewId, recordedAt',
    favoriteSources: version >= 9 ? '&id, &bookmarkId, reviewId, matchedWorkId, importedAt' : '&id, &bookmarkId, reviewId, importedAt',
    libraries: '&id', organizer: '&id', progress: '&id, workId, kind', reminders: '&id, agendaEntryId, channel',
    reviews: '&id, status, matchedWorkId', works: version >= 10 ? '&id, mediaKind, preferredTitle, *hydration.favoriteAliasKeys, *hydration.providerTitleKeys' : '&id, mediaKind, preferredTitle',
  });
  if (version >= 11) database.version(version).stores({ providerIdentityRecovery: '&id' });
  await database.table('works').bulkAdd(versionThree.works);
  await database.table('reviews').add(resolvedReview);
  await database.table('favoriteSources').add(favoriteSource);
  database.close();
}

async function verifyReleaseContractMigration(name: string): Promise<void> {
  document.body.dataset.phase = 'release-v15-seed';
  const legacy = new Dexie(name);
  legacy.version(15).stores({
    publicReleaseEvents: '&id, provider, providerWorkId, [provider+providerWorkId], releaseKind, state, expiresAt',
  });
  await legacy.table('publicReleaseEvents').add({
    expiresAt: '2026-11-12T00:00:00.000Z', id: 'legacy-release', occurrence: { kind: 'DATE', value: '2026-09-13' },
    provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1', source: 'mangaupdates' },
    provider: 'mangaUpdates', providerWorkId: '42', releaseKind: 'chapter', sequence: 58, state: 'CONFIRMED',
  });
  legacy.close();
  const migrated = new TobirinkDatabase(name);
  const event = await migrated.publicReleaseEvents.get('legacy-release');
  if (migrated.verno !== 17 || event?.provider !== 'mangaupdates' || event.sequence !== '58' || migrated.publicReleaseStagingEvents.schema.idxByName.generation === undefined) throw new Error('Release contract migration did not preserve and normalize the legacy event or add durable staging.');
  migrated.close();
}

async function verifyReleaseFallbackPromotion(name: string): Promise<void> {
  document.body.dataset.phase = 'release-fallback-promotion';
  const database = new TobirinkDatabase(name);
  await database.open();
  const store = new DexiePublicReleaseFallbackStore(database);
  const state = { generation: 'fallback-test', lanes: { anilist: { complete: false, nextPage: 1, notBefore: 0 }, mangaupdates: { complete: false, nextPage: 1, notBefore: 0 } }, startedAt: '2026-09-12T00:00:00.000Z', window: { from: '2026-09-12', to: '2026-10-17' } } as const;
  const event = { expiresAt: '2026-11-12T00:00:00.000Z', id: 'anilist-episode-42-1', occurrence: { kind: 'INSTANT', value: '2026-09-13T00:00:00.000Z' }, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist', providerWorkId: '42', releaseKind: 'episode', sequence: '1', state: 'SCHEDULED' } as const;
  await database.publicReleaseEvents.put({ ...event, id: 'previous-release' });
  await store.begin(state);
  await store.stage(state.generation, { complete: true, events: [event], page: 1, provider: 'anilist' });
  if (!await database.publicReleaseEvents.get('previous-release')) throw new Error('Partial fallback replaced the last active generation.');
  await store.stage(state.generation, { complete: true, events: [], page: 1, provider: 'mangaupdates' });
  await store.promote(state.generation, '2026-09-12T00:01:00.000Z');
  const active = await database.publicReleaseEvents.toArray();
  if (active.length !== 1 || active[0]?.id !== event.id || (await database.publicReleaseSyncState.get('active'))?.source !== 'fallback') throw new Error('Complete fallback generation was not promoted atomically.');
  database.close();
}

async function verifySuccessfulMigration(name: string, seed: (databaseName: string) => Promise<void>, expectedSources = 0): Promise<void> {
  document.body.dataset.phase = name;
  await seed(name);
  const database = new TobirinkDatabase(name);
  const migrated = await database.works.toArray();
  const sources = await database.favoriteSources.toArray();
  const reviews = await database.reviews.toArray();
  const organizer = await database.organizer.toArray();
  if (JSON.stringify(migrated) !== JSON.stringify(versionThree.works)) throw new Error('Legacy fixture did not migrate to the version 3 work fixture.');
  if (sources.length !== expectedSources) throw new Error('Favorite sources were not preserved across migration.');
  if (expectedSources === 1 && (JSON.stringify(sources) !== JSON.stringify([favoriteSource]) || JSON.stringify(reviews) !== JSON.stringify([resolvedReview]))) {
    throw new Error('Resolved favorite data changed across migration.');
  }
  if (organizer.length !== 0) throw new Error('Version 5 organizer store must start empty.');
  const report = await verifyDatabaseIntegrity(database);
  if (report.schemaVersion !== 17 || report.checkedRecords !== 1 + (expectedSources * 2)) throw new Error('Integrity report did not cover the migrated database.');
  if (!database.favoriteSources.schema.idxByName.matchedWorkId) throw new Error('Direct Work source index was not added.');
  if (!database.works.schema.idxByName['hydration.favoriteAliasKeys']?.multi || !database.works.schema.idxByName['hydration.providerTitleKeys']?.multi) throw new Error('Hydrated identity multi-entry indexes were not added.');
  if (!database.works.schema.idxByName['hydration.candidate.genres']?.multi || !database.works.schema.idxByName['hydration.candidate.editorialStatus'] || !database.works.schema.idxByName['hydration.candidate.popularity.value']) throw new Error('Sortable metadata indexes were not added.');
  database.close();
}

async function verifyInterruptedMigration(name: string): Promise<void> {
  document.body.dataset.phase = 'interrupted-v2';
  await seedVersion1(name);
  const interrupted = new Dexie(name);
  interrupted.version(1).stores({ works: '&id, mediaKind, title' });
  interrupted.version(2).stores({ works: '&id, mediaKind, preferredTitle' }).upgrade(async (transaction) => {
    await transaction.table('works').toCollection().modify({ preferredTitle: 'partial' });
    throw new Error('simulated interruption');
  });
  try {
    await interrupted.open();
    throw new Error('Interrupted migration unexpectedly succeeded.');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('simulated interruption')) throw error;
  } finally {
    interrupted.close();
  }
  const original = new Dexie(name);
  original.version(1).stores({ works: '&id, mediaKind, title' });
  const records = await original.table('works').toArray();
  original.close();
  if (JSON.stringify(records) !== JSON.stringify(before.works)) throw new Error('Interrupted migration published partial state.');
}

async function verifyReviewCorrection(name: string): Promise<void> {
  document.body.dataset.phase = 'review-v11-seed';
  await seedVersion8(name, 11);
  const legacy = new Dexie(name);
  await legacy.open();
  const pending = Array.from({ length: 150 }, (_, index) => ({ id: `review_legacy_${index.toString().padStart(6, '0')}`, sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic legacy' }));
  await legacy.table('reviews').bulkAdd([...pending, { id: 'review_zz_terminal', reason: 'NOT_FOUND', sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic terminal' }]);
  await legacy.table('reviews').add({ id: 'review_4_3432', sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic voyager' });
  await legacy.table('favoriteSources').add({ ...favoriteSource, bookmarkId: '42', id: 'source_4_3432', reviewId: 'review_4_3432', title: 'Synthetic voyager', url: 'https://reader.example/manga/voyager' });
  legacy.close();
  const storage = new DexieStoragePort(name);
  document.body.dataset.phase = 'review-v12-index';
  const visible = await storage.listReviews({ actionableOnly: true, limit: 100, status: 'pending' });
  if (visible.length !== 1 || visible[0]?.id !== 'review_zz_terminal') throw new Error('Legacy pending rows starved the terminal Review index.');
  document.body.dataset.phase = 'review-correction-import';
  try {
    await importFavoriteSources([
      { bookmarkId: '42', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic voyager', url: 'https://reader.example/manga/voyager' },
      { bookmarkId: 'invalid', folderPath: [], order: -1, state: 'eligible', title: 'Invalid fixture', url: 'https://reader.example/manga/invalid' },
    ], storage, '2026-09-08T00:00:00.000Z');
    throw new Error('Invalid batch unexpectedly committed.');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('non-negative')) throw error;
  }
  if (await storage.getFavoriteResolutionReceipt('source_4_3432:correction-v1')) throw new Error('Correction receipt escaped rollback.');
  if ((await storage.database.favoriteSources.get('source_4_3432'))?.reviewId !== 'review_4_3432') throw new Error('Correction source escaped rollback.');
  await importFavoriteSources([{ bookmarkId: '42', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic voyager', url: 'https://reader.example/manga/voyager' }], storage, '2026-09-08T00:00:00.000Z');
  const receipt = await storage.getFavoriteResolutionReceipt('source_4_3432:correction-v1');
  if (receipt?.correction?.review?.id !== 'review_4_3432') throw new Error('Correction did not preserve the legacy Review.');
  if ((await storage.database.favoriteSources.get('source_4_3432'))?.reviewId !== undefined) throw new Error('Artificial Review remained linked.');
  if (!await storage.database.reviews.get('review_4_3432')) throw new Error('Correction removed the historical Review.');
  const counts = await storage.readFavoriteResolutionCounts();
  if (counts.observed !== 1 || counts.processing !== 1 || counts.retryable !== 0 || counts.unsupported !== 0) throw new Error('Indexed processing counts included unobserved legacy records.');
  document.body.dataset.phase = 'review-queue-pagination';
  for (let index = 0; index < 100; index += 1) {
    await storage.putReview(createReview({ availableAt: '1970-01-01T00:00:00.000Z', id: reviewId(`review_orphan_${index.toString().padStart(6, '0')}`), reason: 'NOT_FOUND', sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic orphan' }));
  }
  const actionable = createReview({ availableAt: '1970-01-02T00:00:00.000Z', id: reviewId('review_page_actionable'), reason: 'NOT_FOUND', sourceLabel: 'Synthetic', status: 'pending', title: 'Synthetic actionable' });
  await storage.putReview(actionable);
  await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'page', folderPath: [], id: favoriteSourceId('source_page_actionable'), importedAt: '2026-09-08T00:00:00.000Z', order: 0, resolution: { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, reviewId: actionable.id, title: actionable.title, url: 'https://reader.example/actionable' }));
  const queue = await readReviewQueue(storage);
  if (queue.items.length !== 1 || queue.items[0]?.id !== actionable.id) throw new Error('Indexed queue lost the actionable entry beyond an orphan page.');
  storage.database.close();
  const reopened = new DexieStoragePort(name);
  if (JSON.stringify(await reopened.getFavoriteResolutionReceipt(receipt.id)) !== JSON.stringify(receipt)) throw new Error('Correction receipt did not survive reopening.');
  reopened.database.close();
}

const versionOneName = `tobirink-migration-v1-${Date.now()}`;
const versionTwoName = `tobirink-migration-v2-${Date.now()}`;
const versionThreeName = `tobirink-migration-v3-${Date.now()}`;
const versionFourName = `tobirink-migration-v4-${Date.now()}`;
const versionFiveName = `tobirink-migration-v5-${Date.now()}`;
const versionEightName = `tobirink-migration-v8-${Date.now()}`;
const versionNineName = `tobirink-migration-v9-${Date.now()}`;
const versionTenName = `tobirink-migration-v10-${Date.now()}`;
const interruptedName = `tobirink-migration-interrupted-${Date.now()}`;
const reviewCorrectionName = `tobirink-migration-review-${Date.now()}`;
const releaseContractName = `tobirink-migration-release-${Date.now()}`;
const releaseFallbackName = `tobirink-release-fallback-${Date.now()}`;
try {
  await verifySuccessfulMigration(versionOneName, seedVersion1);
  await verifySuccessfulMigration(versionTwoName, seedVersion2);
  await verifySuccessfulMigration(versionThreeName, seedVersion3, 1);
  await verifySuccessfulMigration(versionFourName, seedVersion4, 1);
  await verifySuccessfulMigration(versionFiveName, seedVersion5, 1);
  await verifySuccessfulMigration(versionEightName, seedVersion8, 1);
  await verifySuccessfulMigration(versionNineName, (name) => seedVersion8(name, 9), 1);
  await verifySuccessfulMigration(versionTenName, (name) => seedVersion8(name, 10), 1);
  await verifyInterruptedMigration(interruptedName);
  await verifyReviewCorrection(reviewCorrectionName);
  await verifyReleaseContractMigration(releaseContractName);
  await verifyReleaseFallbackPromotion(releaseFallbackName);
  document.body.dataset.status = 'passed';
  document.body.textContent = 'IndexedDB migrations passed';
} catch (error) {
  document.body.dataset.status = 'failed';
  document.body.textContent = `${document.body.dataset.phase}: ${error instanceof Error ? error.message : String(error)}`;
} finally {
  await deleteDatabase(versionOneName);
  await deleteDatabase(versionTwoName);
  await deleteDatabase(versionThreeName);
  await deleteDatabase(versionFourName);
  await deleteDatabase(versionFiveName);
  await deleteDatabase(versionEightName);
  await deleteDatabase(versionNineName);
  await deleteDatabase(versionTenName);
  await deleteDatabase(interruptedName);
  await deleteDatabase(releaseContractName);
  await deleteDatabase(releaseFallbackName);
}
