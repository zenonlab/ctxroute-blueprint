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
  const checkpoint = { id: 'favorite-inventory' as const, sessionId: 'inventory-contract', startedAt: '2026-09-07T00:00:00.000Z', status: 'active' as const };
  const mark = { bookmarkId: source.bookmarkId, sessionId: checkpoint.sessionId };
  const mutation = { bookmarkId: source.bookmarkId, kind: 'changed' as const, recordedAt: '2026-09-07T00:01:00.000Z', sequence: 'mutation-contract' };
  const rate = { nextAllowedAt: 1_788_739_260_000, provider: 'anilist' as const };
  const receipt = { completedAt: '2026-09-07T00:02:00.000Z', effectDigest: 'resolved:anilist:contract', id: `${source.id}:favorite-resolution`, idempotencyKey: 'resolution-contract', sourceId: source.id };
  const candidateSet = { candidates: [{ externalId: 'contract', mediaKind: 'MANGA' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Contract work'] }], digest: 'candidate-contract', recordedAt: '2026-09-07T00:02:00.000Z', reviewId: review.id };

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
  await storage.transaction(['favoriteBookmarkMutations', 'favoriteInventoryCheckpoints', 'favoriteInventoryMarks', 'favoriteProviderRateCheckpoints', 'favoriteResolutionReceipts', 'favoriteReviewCandidateSets'], async (session) => {
    await session.putFavoriteBookmarkMutation(mutation);
    await session.putFavoriteInventoryCheckpoint(checkpoint);
    await session.putFavoriteInventoryMark(mark);
    await session.putFavoriteProviderRateCheckpoint(rate);
    await session.putFavoriteResolutionReceipt(receipt);
    await session.putFavoriteReviewCandidateSet(candidateSet);
  });
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'work round-trip');
  assert((await storage.getWorks([id, workId('work_missing')]))[0]?.preferredTitle === 'Contract work', 'ordered Work batch preserves missing positions');
  assert((await storage.getLibrary(library.id))?.workIds[0] === id, 'library round-trip');
  assert((await storage.getProgress(progress.id))?.value === 12, 'progress round-trip');
  assert((await storage.findProgressByWorkId(id))?.id === progress.id, 'progress lookup by Work');
  assert((await storage.findProgressByWorkIds([id])).at(0)?.id === progress.id, 'progress batch lookup by Work');
  assert((await storage.getOrganizerConfiguration())?.folders[0]?.id === 'manga', 'organizer configuration round-trip');
  assert((await storage.getFavoriteSource(source.id))?.url === source.url, 'favorite source round-trip');
  assert((await storage.getFavoriteParseArtifacts([source.id]))[0] === undefined, 'artifact batch preserves missing positions');
  assert((await storage.getFavoriteBookmarkMutation(source.bookmarkId))?.sequence === mutation.sequence, 'favorite mutation round-trip');
  assert((await storage.getFavoriteInventoryCheckpoint())?.sessionId === checkpoint.sessionId, 'favorite inventory checkpoint round-trip');
  assert((await storage.getFavoriteInventoryMark(source.bookmarkId))?.sessionId === checkpoint.sessionId, 'favorite inventory mark round-trip');
  assert((await storage.getFavoriteProviderRateCheckpoint('anilist'))?.nextAllowedAt === rate.nextAllowedAt, 'favorite provider rate checkpoint round-trip');
  assert((await storage.getFavoriteResolutionReceipt(receipt.id))?.effectDigest === receipt.effectDigest, 'favorite resolution receipt round-trip');
  assert((await storage.getFavoriteReviewCandidateSet(review.id))?.candidates.length === 1, 'favorite Review candidate set round-trip');
  assert((await storage.findFavoriteSourceByReviewId(review.id))?.id === source.id, 'favorite source lookup by Review');
  assert((await storage.listFavoriteSources({ limit: 1 }))[0]?.id === source.id, 'favorite source bounded listing');
  assert((await storage.listFavoriteSources({ afterId: alternateSource.id, limit: 1 })).length === 0, 'favorite source stable cursor');
  assert(await storage.readPendingFavoriteProjectionCount() === 2, 'pending projection count excludes neither unresolved source');
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

  const { reviewId: _legacyReview, ...directSource } = source;
  const direct = createFavoriteSource({ ...directSource, bookmarkId: 'bookmark-direct', id: favoriteSourceId('source_direct'), matchedWorkId: id, resolution: { kind: 'RESOLVED' } });
  await storage.putFavoriteSource(direct);
  await storage.putFavoriteSource(createFavoriteSource({ ...direct, bookmarkId: 'bookmark-direct-two', id: favoriteSourceId('source_direct-two') }));
  assert((await storage.listFavoriteSourcesByWorkId({ limit: 1, workId: id }))[0]?.id === direct.id, 'direct Work source index is bounded and works without a Review');
  assert((await storage.listFavoriteSourcesByWorkId({ limit: 2, workId: id })).length === 2, 'multiple sources without Review are preserved');
  const invalidBatches = [
    () => storage.getWorks([]),
    () => storage.getWorks(Array(101).fill(id)),
    () => storage.findProgressByWorkIds([]),
    () => storage.findProgressByWorkIds(Array(101).fill(id)),
    () => storage.getFavoriteParseArtifacts([]),
    () => storage.getFavoriteParseArtifacts(Array(101).fill(source.id)),
  ];
  for (const readBatch of invalidBatches) {
    let rejected = false;
    try { await readBatch(); } catch { rejected = true; }
    assert(rejected, 'storage batches must reject empty inputs and more than 100 identifiers');
  }
  let sourceMatchLimitRejected = false;
  try {
    await storage.listFavoriteSourcesByWorkId({ limit: 101, workId: id });
  } catch {
    sourceMatchLimitRejected = true;
  }
  assert(sourceMatchLimitRejected, 'direct Work source listing must enforce its bound');

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

  const hydrated = createWork({
    ...work, externalReferences: [{ provider: 'mangaupdates', externalId: '123' }],
    hydration: {
      candidate: { provider: 'mangaupdates', externalId: '123', mediaKind: 'MANGA', preSerialization: false, titles: ['Contract work', 'Contract alias'] },
      favoriteAliasKeys: ['["MANGA",null,"contract work"]', '["MANGA",2,"contract work"]'],
      hydratedAt: '2026-09-08T00:00:00.000Z', matcherVersion: 'favorite-matcher-v3', providerTitleKeys: ['contract work', 'contract alias'],
    },
  });
  await storage.putWork(hydrated);
  assert((await storage.listWorksByIdentityKey({ key: '["MANGA",2,"contract work"]', kind: 'favorite-alias', limit: 1 }))[0]?.id === id, 'secondary alias multi-entry lookup');
  assert((await storage.listWorksByIdentityKey({ key: 'contract alias', kind: 'provider-title', limit: 1 }))[0]?.id === id, 'secondary provider title multi-entry lookup');
  assert((await storage.listWorksByIdentityKey({ key: '["MANGA",3,"contract work"]', kind: 'favorite-alias', limit: 1 })).length === 0, 'alias lookup preserves season identity');
  let identityLimitRejected = false;
  try { await storage.listWorksByIdentityKey({ key: 'contract work', kind: 'provider-title', limit: 101 }); } catch { identityLimitRejected = true; }
  assert(identityLimitRejected, 'identity lookup must enforce its bound');
  assert((await storage.listWorks({ limit: 1 }))[0]?.id === id, 'Work cursor returns the first bounded record');
  assert((await storage.listWorks({ afterId: id, limit: 1 })).length === 0, 'Work cursor excludes its last record');
  let workLimitRejected = false;
  try { await storage.listWorks({ limit: 101 }); } catch { workLimitRejected = true; }
  assert(workLimitRejected, 'Work cursor must enforce its bound');
}
