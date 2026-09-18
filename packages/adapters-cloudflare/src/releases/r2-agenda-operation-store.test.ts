import { describe, expect, it, vi } from 'vitest';
import { R2AgendaOperationStore } from './r2-agenda-operation-store';

class MemoryBucket {
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
    if ('etagDoesNotMatch' in options.onlyIf ? current !== undefined : current?.etag !== options.onlyIf.etagMatches) throw new Error('precondition-failed');
    this.objects.set(key, { body, etag: String((Number(current?.etag ?? '0') + 1)) });
  }
}

describe('R2AgendaOperationStore', () => {
  const laneInput = {
    provider: 'anilist' as const, scheduledFor: '2026-09-20T03:23:00.000Z',
    window: { from: '2026-09-20', to: '2026-10-20' },
    now: '2026-09-20T03:23:00.000Z', leaseUntil: '2026-09-20T03:24:00.000Z',
    tokenDigest: 'a'.repeat(64), collectionId: 'resume-regression',
  };

  // Expected failures are removed by the following recovery step.
  it.fails('propagates R2 transport failure instead of reporting a live lease', async () => {
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

    const temporary = await bucket.get('agenda-operations/v1/work/anilist/job/page-1.json');
    expect(await temporary?.json<{ expiresAt: string | null }>()).toMatchObject({ expiresAt: '2026-09-24T00:00:00.000Z' });
    await store.writePageVersion({ key: 'snapshots/anilist/job', payload, ownerToken: 'c'.repeat(32), now: '2026-09-17T00:00:00.000Z', retention: 'retained' });
    const retained = await bucket.get('agenda-operations/v1/work/snapshots/anilist/job.json');
    expect(await retained?.json<{ expiresAt: string | null }>()).toMatchObject({ expiresAt: null });
  });

  it('persists the recoverable work signal before Queue delivery', async () => {
    const bucket = new MemoryBucket();
    const store = new R2AgendaOperationStore(bucket);
    const scheduledFor = '2026-09-20T03:23:00.000Z';
    await store.writePendingSignal({ scheduledFor, ownerToken: 'q'.repeat(32), now: scheduledFor });
    const signal = await bucket.get('agenda-operations/v1/signals/2026-09-20T03%3A23%3A00.000Z.json');
    expect(await signal?.json<unknown>()).toMatchObject({ scheduledFor, state: 'PENDING', expiresAt: '2026-09-27T03:23:00.000Z' });
  });
});
