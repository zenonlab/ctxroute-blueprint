import { describe, expect, it } from 'vitest';
import { createLibrary, createReview, createWork, libraryId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { ImportableFavorite } from '../resolution';
import { blockTask, claimTask, commitTask, createDurableTask, recordTaskEffect } from '../tasks';
import { importFavoriteSources } from './import-favorite-sources';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters } from '../favorites/site-rules';
import { favoriteResolutionVersions } from '../favorites/resolution-result-schema';

const importedAt = '2026-09-06T00:00:00.000Z';
const favorite: ImportableFavorite = {
  bookmarkId: '42',
  folderPath: ['Lectures', 'Manga'],
  order: 3,
  state: 'eligible',
  title: 'Frieren chapitre 140',
  url: 'https://reader.example/manga/frieren/chapter-140',
};

async function restoredFavoriteFixture() {
  const original = new MemoryStoragePort();
  await importFavoriteSources([favorite], original, importedAt);
  const [source] = await original.listFavoriteSources({ limit: 1 });
  const artifact = source && await original.getFavoriteParseArtifact(source.id);
  if (!source || !artifact) throw new Error('Expected source and artifact.');
  const storage = new MemoryStoragePort();
  const work = createWork({ externalReferences: [{ externalId: '123', provider: 'mangaupdates' }], id: workId('work_restored'), mediaKind: 'manga', preferredTitle: 'Frieren' });
  const restored = { ...source, matchedWorkId: work.id, resolution: { kind: 'RESOLVED' as const }, resolutionVersions: favoriteResolutionVersions(artifact.artifact) };
  await storage.putWork(work);
  await storage.putLibrary(createLibrary(libraryId('library_primary'), [work.id]));
  await storage.putFavoriteSource(restored);
  return { artifact, source: restored, storage, work };
}

describe('importFavoriteSources', () => {
  it('rebuilds an absent restored artifact without removing an unchanged resolved Work', async () => {
    const { artifact, source, storage, work } = await restoredFavoriteFixture();
    await importFavoriteSources([favorite], storage, '2026-09-28T00:00:00.000Z');

    expect(await storage.getFavoriteSource(source.id)).toEqual(source);
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toEqual([work.id]);
    expect((await storage.getFavoriteParseArtifact(source.id))?.artifact.semanticFingerprint).toBe(artifact.artifact.semanticFingerprint);
    expect(await storage.getFavoriteResolutionTask('favorite-resolution_4_3432')).toBeUndefined();
    expect(await storage.getWork(work.id)).toEqual(work);
  });

  it.each(['title', 'url', 'folderPath', 'presence', 'parser', 'matcher', 'siteRules', 'missingVersions'] as const)('revalidates a restored resolution when %s does not match', async changed => {
    const { source, storage, work } = await restoredFavoriteFixture();
    const input = { ...favorite };
    if (changed === 'title') input.title = 'Different Story chapitre 2';
    if (changed === 'url') input.url = 'https://reader.example/manga/different-story/chapter-2';
    if (changed === 'folderPath') input.folderPath = ['Anime'];
    if (changed === 'presence') await storage.putFavoriteSource({ ...source, presence: 'detached' });
    if (changed === 'parser' || changed === 'matcher' || changed === 'siteRules') {
      await storage.putFavoriteSource({ ...source, resolutionVersions: { ...source.resolutionVersions, [changed]: 'previous-v0' } });
    }
    if (changed === 'missingVersions') {
      const { resolutionVersions: _versions, ...legacy } = source;
      await storage.putFavoriteSource(legacy);
    }

    await importFavoriteSources([input], storage, importedAt);

    expect((await storage.getFavoriteSource(source.id))?.matchedWorkId).toBeUndefined();
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toEqual([]);
    expect(await storage.getFavoriteResolutionTask('favorite-resolution_4_3432')).toMatchObject({ state: 'READY' });
    expect(await storage.getWork(work.id)).toEqual(work);
  });

  it('recreates a restored retryable task once without resetting an interrupted claim', async () => {
    const { source, storage } = await restoredFavoriteFixture();
    const { matchedWorkId: _work, ...unresolved } = source;
    const retryable = { ...unresolved, resolution: { kind: 'RETRYABLE' as const, reason: 'PROVIDER_UNAVAILABLE' as const } };
    await storage.putFavoriteSource(retryable);
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getFavoriteSource(source.id)).toEqual(retryable);
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_4_3432');
    if (!task) throw new Error('Expected restored task.');
    expect(task).toMatchObject({ state: 'READY', attempt: 0 });
    const claimed = claimTask(task, 'interrupted', importedAt, '2026-09-06T00:01:00.000Z');
    await storage.putFavoriteResolutionTask(claimed);
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getFavoriteResolutionTask(task.id)).toEqual(claimed);
  });

  it('reparses and requeues a Manhwaz source after structural title rules change', async () => {
    const storage = new MemoryStoragePort();
    const input = { ...favorite, bookmarkId: 'manhwaz', title: 'kage no jitsuryokusha ni naritakute 006', url: 'https://manhwaz.com/webtoon/kage-no-jitsuryokusha-ni-naritakute-006/chapter-66.1' };
    await importFavoriteSources([input], storage, importedAt);
    const [before] = await storage.listFavoriteSources({ limit: 1 });
    const oldArtifact = before === undefined ? undefined : await storage.getFavoriteParseArtifact(before.id);
    expect(oldArtifact?.artifact.displayTitle).toBe('kage no jitsuryokusha ni naritakute 006');
    await importFavoriteSources([input], storage, importedAt, createFavoriteSiteAdapters(bundledFavoriteSiteRules));
    const [after] = await storage.listFavoriteSources({ limit: 1 });
    const newArtifact = after === undefined ? undefined : await storage.getFavoriteParseArtifact(after.id);
    expect(after?.id).toBe(before?.id);
    expect(newArtifact?.artifact).toMatchObject({ displayTitle: 'kage no jitsuryokusha ni naritakute', parserVersion: 'favorite-parser-v5', progress: { value: 66.1 }, transformations: ['numeric-routing-suffix'] });
    expect(after && await storage.getFavoriteResolutionTask(after.id.replace(/^source_/u, 'favorite-resolution_'))).toMatchObject({ state: 'READY' });
  });

  it('requeues generic Comix title evidence with its more precise site rule', async () => {
    const storage = new MemoryStoragePort();
    const input = { ...favorite, title: 'Synthetic Journey Chapter 101', url: 'https://comix.to/title/ab123-synthetic-journey/1234567-chapter-101' };
    await importFavoriteSources([input], storage, importedAt);
    const [before] = await storage.listFavoriteSources({ limit: 1 });
    const genericArtifact = before === undefined ? undefined : await storage.getFavoriteParseArtifact(before.id);
    expect(before?.resolution).toBeUndefined();
    expect(genericArtifact?.artifact).toMatchObject({ displayTitle: 'Synthetic Journey', mediaKind: 'UNKNOWN', sourceAdapterVersion: 'source-adapter-v3:generic-bookmark-release-v1' });
    await importFavoriteSources([input], storage, importedAt, createFavoriteSiteAdapters(bundledFavoriteSiteRules));
    const [after] = await storage.listFavoriteSources({ limit: 1 });
    const siteArtifact = after === undefined ? undefined : await storage.getFavoriteParseArtifact(after.id);
    expect(after?.id).toBe(before?.id);
    expect(after?.resolution).toBeUndefined();
    expect(siteArtifact?.artifact).toMatchObject({ displayTitle: 'synthetic journey', mediaKind: 'MANGA', sourceAdapterVersion: 'source-adapter-v3:site-rules-v3:comix-title-true' });
    expect((await storage.getFavoriteResolutionTask('favorite-resolution_4_3432'))?.state).toBe('READY');
    expect((await storage.listReviews({ status: 'pending', limit: 20 })).length).toBe(0);
  });

  it('recovers an old blocked task once and preserves its previous state in a receipt', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const taskId = 'favorite-resolution_4_3432';
    const task = await storage.getFavoriteResolutionTask(taskId);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!task || !source) throw new Error('Missing fixture');
    await storage.putFavoriteResolutionTask(blockTask(claimTask(task, 'old', importedAt, '2026-09-06T00:01:00.000Z'), 'old', 'AUTOMATIC_ATTEMPT_LIMIT'));
    const oldReceipt = { completedAt: importedAt, effectDigest: 'correction:blocked-task', id: `${source.id}:queue-recovery-109`, idempotencyKey: `${source.id}:queue-recovery-109`, sourceId: source.id };
    await storage.putFavoriteResolutionReceipt(oldReceipt);
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getFavoriteResolutionTask(taskId)).toMatchObject({ state: 'READY', attempt: 0 });
    const receipt = await storage.getFavoriteResolutionReceipt(`${source.id}:queue-recovery-v3`);
    expect(receipt).toMatchObject({ correction: { task: { state: 'BLOCKED', blockedReason: 'AUTOMATIC_ATTEMPT_LIMIT' } } });
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:queue-recovery-v3`)).toEqual(receipt);
    expect(await storage.getFavoriteResolutionReceipt(oldReceipt.id)).toEqual(oldReceipt);
  });
  it('archives an artificial import Review with a before-image and resumes resolution once', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Expected source.');
    const id = reviewId(`review_${source.id.slice('source_'.length)}`);
    const review = createReview({ id, sourceLabel: source.url, status: 'pending', title: source.title });
    await storage.putReview(review);
    await storage.putFavoriteSource({ ...source, reviewId: id });
    const taskId = 'favorite-resolution_4_3432';
    const task = await storage.getFavoriteResolutionTask(taskId);
    if (!task) throw new Error('Expected task.');
    await storage.putFavoriteResolutionTask(commitTask(recordTaskEffect(claimTask(task, 'old', importedAt, '2026-09-06T00:01:00.000Z'), 'old', 'review:ambiguous'), 'old'));
    await importFavoriteSources([favorite], storage, importedAt);
    expect((await storage.getFavoriteSource(source.id))?.reviewId).toBeUndefined();
    expect(await storage.getReview(id)).toEqual(review);
    expect(await storage.getFavoriteResolutionTask(taskId)).toMatchObject({ state: 'READY' });
    const receipt = await storage.getFavoriteResolutionReceipt(`${source.id}:correction-v1`);
    expect(receipt).toMatchObject({ correction: { review, source: { reviewId: id }, task: { state: 'COMMITTED' } }, effectDigest: 'correction:import-pending' });
    await importFavoriteSources([favorite], storage, '2026-09-06T02:00:00.000Z');
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:correction-v1`)).toEqual(receipt);
  });

  it.each(['resolved', 'no-match'] as const)('preserves a legacy %s decision with uncertain origin', async (status) => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Expected source.');
    const id = reviewId(`review_${source.id.slice('source_'.length)}`);
    const base = { id, sourceLabel: source.url, status, title: source.title };
    const review = createReview(status === 'resolved' ? { ...base, matchedWorkId: workId('work_legacy1') } : base);
    await storage.putReview(review);
    await storage.putFavoriteSource({ ...source, reviewId: id });
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getReview(id)).toEqual(review);
    expect((await storage.getFavoriteSource(source.id))?.reviewId).toBe(id);
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:correction-v1`)).toBeUndefined();
  });

  it('atomically creates a private source and task without any Review', async () => {
    const storage = new MemoryStoragePort();
    await expect(importFavoriteSources([favorite, { ...favorite, bookmarkId: 'ignored', state: 'ignored' }], storage, importedAt))
      .resolves.toEqual({ ignored: 1, imported: 1 });

    const [source] = await storage.listFavoriteSources({ limit: 10 });
    expect(source).toMatchObject({ bookmarkId: '42', folderPath: ['Lectures', 'Manga'], importedAt, order: 3 });
    expect(source?.reviewId).toBeUndefined();
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
    expect(source && await storage.getFavoriteParseArtifact(source.id)).toMatchObject({ artifact: { raw: { title: favorite.title, url: favorite.url } }, recordedAt: importedAt });
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_4_3432');
    expect(task).toMatchObject({ availableAt: '1970-01-01T00:00:00.000Z', kind: 'favorite-resolution', state: 'READY' });
    expect(task?.payload).toContain(source?.id);
  });

  it('closes an ordinary web link locally without consuming a provider task or creating Review', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ ...favorite, bookmarkId: 'youtube', title: '(3) CES STREAMERS QUI GHOSTENT M. LE MAIRE ft. Dach', url: 'https://www.youtube.com/watch?v=fixture' }], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 10 });
    expect(source).toMatchObject({ resolution: { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' } });
    expect(await storage.getFavoriteResolutionTask('favorite-resolution_e_796f7574756265')).toMatchObject({
      effectRecord: 'unsupported:identity-missing',
      state: 'COMMITTED',
    });
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
  });

  it('closes a stale READY task for an unchanged identity-missing artifact on rescan', async () => {
    const storage = new MemoryStoragePort();
    const ordinary = { ...favorite, bookmarkId: 'youtube', title: 'Ordinary video', url: 'https://www.youtube.com/watch?v=fixture' };
    await importFavoriteSources([ordinary], storage, importedAt);
    const taskId = 'favorite-resolution_e_796f7574756265';
    const committed = await storage.getFavoriteResolutionTask(taskId);
    if (committed === undefined) throw new Error('Expected terminal task.');
    await storage.putFavoriteResolutionTask(createDurableTask({
      id: committed.id,
      idempotencyKey: committed.idempotencyKey,
      kind: committed.kind,
      lane: committed.lane,
      payload: committed.payload,
    }));

    await importFavoriteSources([ordinary], storage, '2026-09-06T01:00:00.000Z');

    await expect(storage.getFavoriteResolutionTask(taskId)).resolves.toMatchObject({
      effectRecord: 'unsupported:identity-missing',
      state: 'COMMITTED',
    });
  });

  it.each([
    { origin: 'automatic' as const, matcher: 'favorite-matcher-v2', invalidate: true },
    { origin: 'human' as const, matcher: 'favorite-matcher-v2', invalidate: false },
    { origin: 'automatic' as const, matcher: 'future-matcher-v90', invalidate: false },
  ])('invalidates only known faulty automatic decisions: $origin / $matcher', async ({ origin, matcher, invalidate }) => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Expected source.');
    const work = createWork({ externalReferences: [{ externalId: '123', provider: 'anilist' }], id: workId('work_preserved'), mediaKind: 'anime', preferredTitle: 'Synthetic work' });
    const id = reviewId('review_preserved');
    const review = createReview({ decisionOrigin: origin, id, matchedWorkId: work.id, sourceLabel: source.url, status: 'resolved', title: source.title });
    await storage.putWork(work);
    await storage.putReview(review);
    await storage.putFavoriteSource({ ...source, matchedWorkId: work.id, resolution: { kind: 'RESOLVED' }, resolutionVersions: { schema: 1, decision: 1, receipt: 1, parser: 'favorite-parser-v3', matcher, siteRules: 'source-adapter-v2:generic-url' }, reviewId: id });
    await importFavoriteSources([favorite], storage, importedAt);
    const updated = await storage.getFavoriteSource(source.id);
    expect(updated?.reviewId).toBe(invalidate ? undefined : id);
    expect(updated?.matchedWorkId).toBe(invalidate ? undefined : work.id);
    expect(await storage.getReview(id)).toEqual(review);
    expect(await storage.getWork(work.id)).toEqual(work);
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:correction-v1`)).toEqual(invalidate ? expect.objectContaining({ effectDigest: 'correction:faulty-automatic' }) : undefined);
  });

  it('removes only stale automatic library membership during a semantic reparse', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Expected source.');
    const work = createWork({ externalReferences: [{ externalId: '123', provider: 'anilist' }], id: workId('work_stale_auto'), mediaKind: 'anime', preferredTitle: 'Stale automatic title' });
    await storage.putWork(work);
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [work.id]));
    await storage.putFavoriteSource({ ...source, matchedWorkId: work.id, resolution: { kind: 'RESOLVED' }, resolutionVersions: { schema: 1, decision: 1, receipt: 1, parser: 'favorite-parser-v4', matcher: 'favorite-matcher-v3', siteRules: 'source-adapter-v3:generic-bookmark-release-v1' } });
    const previousArtifact = await storage.getFavoriteParseArtifact(source.id);
    if (!previousArtifact) throw new Error('Expected artifact.');
    await storage.putFavoriteParseArtifact({ ...previousArtifact, artifact: { ...previousArtifact.artifact, semanticFingerprint: 'fnv1a32:legacy-v4' } });

    await importFavoriteSources([favorite], storage, importedAt);

    expect((await storage.getFavoriteSource(source.id))?.matchedWorkId).toBeUndefined();
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toEqual([]);
    expect(await storage.getWork(work.id)).toEqual(work);
  });

  it.each([
    {
      bookmarkId: 'asura-lineage',
      cleanTitle: 'Genius of the Unique Lineage',
      legacyTitle: '0906168628 genius of the unique lineage',
      title: '0906168628 Genius of the Unique Lineage',
      url: 'https://www.asurascans.com/0906168628-genius-of-the-unique-lineage-chapter-31/',
    },
    {
      bookmarkId: 'void-appraiser',
      cleanTitle: 'Artifact Reading Appraiser',
      legacyTitle: 'Artifact Reading Appraiser | Chapter 18 | Void Scans',
      title: 'Artifact Reading Appraiser | Chapter 18 | Void Scans',
      url: 'https://void-scans.com/1/artifact-reading-appraiser-chapter-18/',
    },
  ])('reparses a legacy automatic Review and projects $cleanTitle', async ({ bookmarkId, cleanTitle, legacyTitle, title, url }) => {
    const storage = new MemoryStoragePort();
    const input = { ...favorite, bookmarkId, title, url };
    await importFavoriteSources([input], storage, importedAt);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Expected source.');
    const artifact = await storage.getFavoriteParseArtifact(source.id);
    const taskId = source.id.replace(/^source_/u, 'favorite-resolution_');
    const task = await storage.getFavoriteResolutionTask(taskId);
    if (!artifact || !task) throw new Error('Expected parser state.');
    const staleWork = createWork({ externalReferences: [{ externalId: 'legacy', provider: 'mangadex' }], id: workId(`work_${bookmarkId}`), mediaKind: 'manga', preferredTitle: legacyTitle });
    const staleReview = createReview({ decisionOrigin: 'automatic', id: reviewId(`review_${bookmarkId}`), matchedWorkId: staleWork.id, sourceLabel: url, status: 'resolved', title: legacyTitle });
    const claimed = claimTask(task, 'legacy', importedAt, '2026-09-06T00:01:00.000Z');
    await storage.putWork(staleWork);
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [staleWork.id]));
    await storage.putReview(staleReview);
    await storage.putFavoriteSource({
      ...source,
      matchedWorkId: staleWork.id,
      resolution: { kind: 'RESOLVED' },
      resolutionVersions: { schema: 1, decision: 1, receipt: 1, parser: 'favorite-parser-v4', matcher: 'favorite-matcher-v3', siteRules: artifact.artifact.sourceAdapterVersion },
      reviewId: staleReview.id,
    });
    await storage.putFavoriteParseArtifact({
      ...artifact,
      artifact: { ...artifact.artifact, displayTitle: legacyTitle, identityKey: legacyTitle.toLocaleLowerCase(), parserVersion: 'favorite-parser-v4', semanticFingerprint: `fnv1a32:legacy-${bookmarkId}` },
    });
    await storage.putFavoriteResolutionTask(commitTask(recordTaskEffect(claimed, 'legacy', 'resolved:legacy'), 'legacy'));

    await importFavoriteSources([input], storage, '2026-09-13T01:00:00.000Z');

    const updated = await storage.getFavoriteSource(source.id);
    expect(updated?.matchedWorkId).toBeUndefined();
    expect(updated?.resolution).toBeUndefined();
    expect(updated?.reviewId).toBeUndefined();
    const reparsedArtifact = await storage.getFavoriteParseArtifact(source.id);
    expect(reparsedArtifact?.artifact).toMatchObject({ displayTitle: cleanTitle, parserVersion: 'favorite-parser-v5' });
    expect(await storage.getFavoriteResolutionTask(taskId)).toMatchObject({ state: 'READY' });
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toEqual([]);
    expect(await storage.getWork(staleWork.id)).toEqual(staleWork);
    expect(await storage.getReview(staleReview.id)).toEqual(staleReview);
    expect(reparsedArtifact && await storage.getFavoriteResolutionReceipt(`${source.id}:semantic-reparse:${reparsedArtifact.artifact.semanticFingerprint}`)).toMatchObject({
      correction: { artifact: { artifact: { displayTitle: legacyTitle } }, review: staleReview, source: { matchedWorkId: staleWork.id }, task: { state: 'COMMITTED' } },
      effectDigest: 'correction:semantic-automatic',
    });
  });

  it('keeps stale membership while another observed resolved source still references the Work', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite, { ...favorite, bookmarkId: '43' }], storage, importedAt);
    const sources = await storage.listFavoriteSources({ limit: 2 });
    const source = sources.find((value) => value.bookmarkId === '42');
    const other = sources.find((value) => value.bookmarkId === '43');
    if (!source || !other) throw new Error('Expected sources.');
    const work = createWork({ externalReferences: [{ externalId: '123', provider: 'anilist' }], id: workId('work_shared_auto'), mediaKind: 'anime', preferredTitle: 'Shared title' });
    await storage.putWork(work);
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [work.id]));
    const resolved = { matchedWorkId: work.id, resolution: { kind: 'RESOLVED' as const }, resolutionVersions: { schema: 1 as const, decision: 1 as const, receipt: 1 as const, parser: 'favorite-parser-v4', matcher: 'favorite-matcher-v3', siteRules: 'source-adapter-v3:generic-bookmark-release-v1' } };
    await storage.putFavoriteSource({ ...source, ...resolved });
    await storage.putFavoriteSource({ ...other, ...resolved });
    const previousArtifact = await storage.getFavoriteParseArtifact(source.id);
    if (!previousArtifact) throw new Error('Expected artifact.');
    await storage.putFavoriteParseArtifact({ ...previousArtifact, artifact: { ...previousArtifact.artifact, semanticFingerprint: 'fnv1a32:legacy-v4' } });

    await importFavoriteSources([favorite], storage, importedAt);

    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toEqual([work.id]);
    expect((await storage.getFavoriteSource(other.id))?.matchedWorkId).toBe(work.id);
  });

  it('Q-02 creates a new semantic task revision while preserving import time and a resolved Review', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const [initial] = await storage.listFavoriteSources({ limit: 1 });
    if (!initial) throw new Error('Expected imported source.');
    const work = createWork({ externalReferences: [], id: workId('work_frieren140'), mediaKind: 'manga', preferredTitle: 'Frieren' });
    const humanReviewId = reviewId('review_human1');
    await storage.transaction(['works', 'reviews', 'favoriteSources'], async (session) => {
      await session.putWork(work);
      await session.putReview(createReview({ decisionOrigin: 'human', id: humanReviewId, matchedWorkId: work.id, sourceLabel: initial.url, status: 'resolved', title: initial.title }));
      await session.putFavoriteSource({ ...initial, reviewId: humanReviewId });
    });

    const initialTask = await storage.getFavoriteResolutionTask('favorite-resolution_4_3432');
    await importFavoriteSources([{ ...favorite, folderPath: ['À lire'], order: 0, title: 'Frieren', url: 'https://reader.example/frieren' }], storage, '2026-09-06T01:00:00.000Z');
    const [updated] = await storage.listFavoriteSources({ limit: 1 });
    expect(updated).toMatchObject({ folderPath: ['À lire'], importedAt, order: 0, title: 'Frieren' });
    expect(await storage.getReview(humanReviewId)).toMatchObject({ decisionOrigin: 'human', matchedWorkId: work.id, status: 'resolved', title: initial.title });
    const revisedTask = await storage.getFavoriteResolutionTask('favorite-resolution_4_3432');
    expect(revisedTask).toMatchObject({ state: 'READY' });
    expect(revisedTask?.idempotencyKey).not.toBe(initialTask?.idempotencyKey);
  });

  it('rolls back a batch when one source is invalid', async () => {
    const storage = new MemoryStoragePort();
    const invalid = { ...favorite, bookmarkId: 'invalid', order: -1 };
    await expect(importFavoriteSources([favorite, invalid], storage, importedAt)).rejects.toThrow();
    await expect(storage.listFavoriteSources({ limit: 10 })).resolves.toEqual([]);
    await expect(storage.getReview(reviewId('review_4_3432'))).resolves.toBeUndefined();
    await expect(storage.getFavoriteResolutionTask('favorite-resolution_4_3432')).resolves.toBeUndefined();
  });

  it('Q-01 does not duplicate or reopen a committed resolution after a placement-only move', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([favorite], storage, importedAt);
    const taskId = 'favorite-resolution_4_3432';
    const task = await storage.getFavoriteResolutionTask(taskId);
    if (task === undefined) throw new Error('Expected resolution task.');
    const claimed = claimTask(task, 'claim', importedAt, '2026-09-06T00:01:00.000Z');
    await storage.putFavoriteResolutionTask(commitTask(recordTaskEffect(claimed, 'claim', 'resolved:test'), 'claim'));

    await importFavoriteSources([{ ...favorite, folderPath: ['Moved'], order: 0 }], storage, '2026-09-06T01:00:00.000Z');

    await expect(storage.getFavoriteResolutionTask(taskId)).resolves.toMatchObject({ state: 'COMMITTED' });
  });
});
