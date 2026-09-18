import { describe, expect, it, vi } from 'vitest';
import { R2AgendaOperationStore } from './r2-agenda-operation-store';

class MemoryBucket {
  rejectNextWrite = false;
  private readonly objects = new Map<string, { body: string; etag: string }>();
  async get(key: string) {
    const item = this.objects.get(key);
    if (item === undefined) return null;
    return { etag: item.etag, json: async <T>() => {
      // SAFETY: the production adapter immediately validates every parsed fake object with its owning Zod schema.
      return JSON.parse(item.body) as T;
    } };
  }
  async put(key: string, body: string, options: { onlyIf: { etagDoesNotMatch: string } | { etagMatches: string } }) {
    const current = this.objects.get(key);
    if (this.rejectNextWrite) { this.rejectNextWrite = false; return null; }
    if ('etagDoesNotMatch' in options.onlyIf ? current !== undefined : current?.etag !== options.onlyIf.etagMatches) return null;
    this.objects.set(key, { body, etag: String((Number(current?.etag ?? '0') + 1)) });
    return { etag: String(Number(current?.etag ?? '0') + 1) };
  }
}

describe('R2AgendaOperationStore', () => {
  const laneInput = {
    provider: 'anilist' as const, scheduledFor: '2026-09-20T03:23:00.000Z',
    window: { from: '2026-09-20', to: '2026-10-20' },
    now: '2026-09-20T03:23:00.000Z', leaseUntil: '2026-09-20T03:24:00.000Z',
    tokenDigest: 'a'.repeat(64), collectionId: 'resume-regression',
  };

  it('propagates R2 transport failure instead of reporting a live lease', async () => {
    const bucket = new MemoryBucket();
    vi.spyOn(bucket, 'put').mockRejectedValueOnce(new Error('r2-transport-unavailable'));
    await expect(new R2AgendaOperationStore(bucket).claimLane(laneInput)).rejects.toThrow('r2-transport-unavailable');
  });

  it('retains collection identity and checkpoint when another owner resumes an expired lease', async () => {
    const store = new R2AgendaOperationStore(new MemoryBucket());
    await expect(store.claimLane(laneInput)).resolves.toMatchObject({ status: 'claimed' });
    await store.advanceLane({ ...laneInput, checkpoint: {
      complete: false, events: [], page: 1, nextPage: 2, provider: 'anilist', received: 3, skippedUnidentified: 1,
    } });
    await expect(store.claimLane({ ...laneInput, tokenDigest: 'b'.repeat(64) })).resolves.toMatchObject({ status: 'leased' });
    await expect(store.claimLane({ ...laneInput, now: laneInput.leaseUntil, leaseUntil: '2026-09-20T03:25:00.000Z', tokenDigest: 'b'.repeat(64), collectionId: 'replacement' }))
      .resolves.toMatchObject({ status: 'claimed', claim: { collectionId: laneInput.collectionId, nextPage: 2, received: 3, skippedUnidentified: 1, tokenDigest: 'b'.repeat(64) } });
    await expect(store.advanceLane({ ...laneInput, now: laneInput.leaseUntil, checkpoint: {
      complete: true, events: [], page: 2, provider: 'anilist', received: 4, skippedUnidentified: 1,
    } })).rejects.toThrow('agenda-lane-lease-lost');
  });

  it('rejects checkpoint and active pointer changes at the exact lease expiry', async () => {
    const store = new R2AgendaOperationStore(new MemoryBucket());
    await store.claimLane(laneInput);
    const before = await store.readLane('anilist');
    await expect(store.advanceLane({ ...laneInput, now: laneInput.leaseUntil, checkpoint: {
      complete: true, events: [], page: 1, provider: 'anilist', received: 0, skippedUnidentified: 0,
    } })).rejects.toThrow('agenda-lane-lease-lost');
    await expect(store.completeLane({ ...laneInput, checkedAt: laneInput.leaseUntil, digest: 'd'.repeat(64), changed: true }))
      .rejects.toThrow('agenda-lane-lease-lost');
    expect(await store.readLane('anilist')).toEqual(before);
  });

  it.each(['checkpoint', 'failure', 'completion'] as const)('rejects a null conditional %s write without advancing state', async (operation) => {
    const bucket = new MemoryBucket();
    const store = new R2AgendaOperationStore(bucket);
    await store.claimLane(laneInput);
    const before = await store.readLane('anilist');
    bucket.rejectNextWrite = true;
    const write = operation === 'checkpoint'
      ? store.advanceLane({ ...laneInput, checkpoint: { complete: true, events: [], page: 1, provider: 'anilist', received: 0, skippedUnidentified: 0 } })
      : operation === 'failure'
        ? store.failLane({ ...laneInput, retryAt: laneInput.leaseUntil })
        : store.completeLane({ ...laneInput, checkedAt: laneInput.now, digest: 'd'.repeat(64), changed: true });
    await expect(write).rejects.toThrow('agenda-r2-precondition-failed');
    expect(await store.readLane('anilist')).toEqual(before);
  });

  it('resumes the terminal checkpoint without requesting the last provider page again', async () => {
    const store = new R2AgendaOperationStore(new MemoryBucket());
    const first = await store.claimLane(laneInput);
    if (first.status !== 'claimed') throw new Error('Expected claim.');
    await store.saveLanePage(first.claim, { complete: true, events: [], page: 1, provider: 'anilist', received: 0, skippedUnidentified: 0 }, laneInput.now);
    await expect(store.claimLane({ ...laneInput, now: laneInput.leaseUntil, leaseUntil: '2026-09-20T03:25:00.000Z', tokenDigest: 'b'.repeat(64) }))
      .resolves.toMatchObject({ status: 'claimed', claim: { collectionComplete: true } });
  });

  it('rechecks the clock after a page write that outlives its lease', async () => {
    const bucket = new MemoryBucket();
    let observedNow = laneInput.now;
    const store = new R2AgendaOperationStore(bucket, undefined, () => observedNow);
    const claim = await store.claimLane(laneInput);
    if (claim.status !== 'claimed') throw new Error('Expected claim.');
    const originalPut = bucket.put.bind(bucket);
    vi.spyOn(bucket, 'put').mockImplementation(async (key, body, options) => {
      const result = await originalPut(key, body, options);
      if (key.includes('/work/pages/')) observedNow = laneInput.leaseUntil;
      return result;
    });
    await expect(store.saveLanePage(claim.claim, { complete: true, events: [], page: 1, provider: 'anilist', received: 0, skippedUnidentified: 0 }, laneInput.now))
      .rejects.toThrow('agenda-lane-lease-lost');
    expect(await store.readLane('anilist')).toMatchObject({ collectionComplete: false, pages: [], nextPage: 1 });
  });

  it('resumes legacy pages in v2 while preserving the v1 objects for rollback', async () => {
    const bucket = new MemoryBucket();
    const legacyLane = {
      schemaVersion: 1, provider: 'anilist', activeSnapshotId: null, activeDigest: null, previousSnapshotIds: [],
      completedFor: null, collectionId: laneInput.collectionId, scheduledFor: laneInput.scheduledFor,
      windowFrom: laneInput.window.from, windowTo: laneInput.window.to, nextPage: 2, received: 0, skipped: 0,
      notBefore: null, ownerToken: laneInput.tokenDigest, leaseUntil: laneInput.leaseUntil, checkedAt: null,
    };
    await bucket.put('agenda-operations/v1/lanes/anilist.json', JSON.stringify(legacyLane), { onlyIf: { etagDoesNotMatch: '*' } });
    const legacy = new R2AgendaOperationStore(bucket, 'agenda-operations/v1');
    const firstPage = { complete: false, events: [], page: 1, nextPage: 2, provider: 'anilist' as const, received: 0, skippedUnidentified: 0 };
    await legacy.writePageVersion({ key: `pages/anilist/${laneInput.collectionId}/1`, payload: firstPage, ownerToken: laneInput.tokenDigest, now: laneInput.now });
    const current = new R2AgendaOperationStore(bucket);
    const resumed = await current.claimLane({ ...laneInput, now: laneInput.leaseUntil, leaseUntil: '2026-09-20T03:25:00.000Z', tokenDigest: 'b'.repeat(64) });
    if (resumed.status !== 'claimed') throw new Error('Expected migrated claim.');
    const secondPage = { complete: true, events: [], page: 2, provider: 'anilist' as const, received: 0, skippedUnidentified: 0 };
    await current.saveLanePage(resumed.claim, secondPage, laneInput.leaseUntil);
    await expect(current.readLanePages('anilist', laneInput.collectionId)).resolves.toEqual([firstPage, secondPage]);
    expect(await (await bucket.get('agenda-operations/v1/lanes/anilist.json'))?.json<unknown>()).toEqual(legacyLane);
  });

  it('retains more than twenty durable signals and permits bounded delivery after a lost send', async () => {
    const store = new R2AgendaOperationStore(new MemoryBucket());
    const dates = Array.from({ length: 25 }, (_, index) => new Date(Date.parse(laneInput.now) + index * 604_800_000).toISOString());
    for (const scheduledFor of dates) await store.writePendingSignal({ scheduledFor, ownerToken: 's'.repeat(64), now: laneInput.now });
    await expect(store.pendingSignal()).resolves.toBe(dates[0]);
    await expect(store.reserveSignalDelivery(laneInput.now)).resolves.toBe(dates[0]);
    await expect(store.reserveSignalDelivery(laneInput.now)).resolves.toBeUndefined();
    await expect(store.reserveSignalDelivery(laneInput.leaseUntil)).resolves.toBe(dates[0]);
    await store.finishSignal(dates[0]!);
    await expect(store.pendingSignal()).resolves.toBe(dates[0]);
  });

  it('deduplicates and retains only twelve observations with ownership verification', async () => {
    const store = new R2AgendaOperationStore(new MemoryBucket());
    const observations = Array.from({ length: 14 }, (_, index) => ({ chapter: index + 1, releasedOn: `2026-09-${String(index + 1).padStart(2, '0')}` }));
    const saved = await store.mergeObservations({ workId: 'work_1', observations, ownerToken: 'a'.repeat(32), now: '2026-09-17T00:00:00.000Z' });
    expect(saved).toHaveLength(12);
    await expect(store.mergeObservations({ workId: 'work_1', observations: [observations[13]!], ownerToken: 'b'.repeat(32), now: '2026-09-18T00:00:00.000Z' })).resolves.toHaveLength(12);
    await expect(store.readObservations('work_1')).resolves.toEqual(saved);
  });

  it('writes and verifies a bounded temporary work version', async () => {
    const bucket = new MemoryBucket();
    const store = new R2AgendaOperationStore(bucket);
    const payload = { complete: true, events: [], page: 1, provider: 'anilist' as const, received: 0, skippedUnidentified: 0 };
    await expect(store.writePageVersion({ key: 'anilist/job/page-1', payload, ownerToken: 'c'.repeat(32), now: '2026-09-17T00:00:00.000Z' })).resolves.toBeUndefined();
    await expect(store.readPageVersion('anilist/job/page-1', 'c'.repeat(32))).resolves.toEqual(payload);
    await expect(store.readPageVersion('anilist/job/page-1', 'd'.repeat(32))).rejects.toThrow('agenda-r2-work-ownership-lost');

    const temporary = await bucket.get('agenda-operations/v2/work/anilist/job/page-1.json');
    expect(await temporary?.json<{ expiresAt: string | null }>()).toMatchObject({ expiresAt: '2026-09-24T00:00:00.000Z' });
    await store.writePageVersion({ key: 'snapshots/anilist/job', payload, ownerToken: 'c'.repeat(32), now: '2026-09-17T00:00:00.000Z', retention: 'retained' });
    const retained = await bucket.get('agenda-operations/v2/work/snapshots/anilist/job.json');
    expect(await retained?.json<{ expiresAt: string | null }>()).toMatchObject({ expiresAt: null });
  });

  it('persists the recoverable work signal before Queue delivery', async () => {
    const bucket = new MemoryBucket();
    const store = new R2AgendaOperationStore(bucket);
    const scheduledFor = '2026-09-20T03:23:00.000Z';
    await store.writePendingSignal({ scheduledFor, ownerToken: 'q'.repeat(32), now: scheduledFor });
    const signal = await bucket.get('agenda-operations/v2/signals/2026-09-20T03%3A23%3A00.000Z.json');
    expect(await signal?.json<unknown>()).toMatchObject({ scheduledFor, state: 'PENDING', expiresAt: '2026-09-27T03:23:00.000Z' });
  });
});
