import { describe, expect, it } from 'vitest';
import { createReview, createWork, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { ImportableFavorite } from '../resolution';
import { blockTask, claimTask, commitTask, createDurableTask, recordTaskEffect } from '../tasks';
import { importFavoriteSources } from './import-favorite-sources';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters } from '../favorites/site-rules';

const importedAt = '2026-09-06T00:00:00.000Z';
const favorite: ImportableFavorite = {
  bookmarkId: '42',
  folderPath: ['Lectures', 'Manga'],
  order: 3,
  state: 'eligible',
  title: 'Frieren chapitre 140',
  url: 'https://reader.example/manga/frieren/chapter-140',
};

describe('importFavoriteSources', () => {
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
    expect(newArtifact?.artifact).toMatchObject({ displayTitle: 'kage no jitsuryokusha ni naritakute', parserVersion: 'favorite-parser-v3', progress: { value: 66.1 }, transformations: ['numeric-routing-suffix'] });
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
    expect(after?.id).toBe(before?.id);
    expect(after?.resolution).toBeUndefined();
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
    const receipt = await storage.getFavoriteResolutionReceipt(`${source.id}:queue-recovery-v2`);
    expect(receipt).toMatchObject({ correction: { task: { state: 'BLOCKED', blockedReason: 'AUTOMATIC_ATTEMPT_LIMIT' } } });
    await importFavoriteSources([favorite], storage, importedAt);
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:queue-recovery-v2`)).toEqual(receipt);
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
