import { describe, expect, it, vi } from 'vitest';
import { emptySyncedProviderIds, readProviderIdentitySnapshots } from './provider-identity-snapshot';
import type { ProviderSyncItem, ProviderSyncStorageValues } from './provider-identity-snapshot';
import { ProviderIdentitySyncPublisher } from './provider-identity-sync';
import type { ProviderIdentitySyncState } from './provider-identity-sync';

const ids = { ...emptySyncedProviderIds(), anilist: ['1'] };
function fixture(values: ProviderSyncStorageValues = {}) {
  let saved: ProviderIdentitySyncState | undefined;
  let clock = 10000;
  let failCompletion = false;
  const sync = {
    readAll: async () => structuredClone(values),
    write: vi.fn(async (items: Readonly<Record<string, ProviderSyncItem>>) => { Object.assign(values, structuredClone(items)); }),
  };
  const state = {
    read: async () => structuredClone(saved),
    save: vi.fn(async (next: ProviderIdentitySyncState) => {
      if (next.pending === undefined && failCompletion) { failCompletion = false; throw new Error('checkpoint interruption'); }
      saved = structuredClone(next);
    }),
  };
  return { sync, state, values, advance: (milliseconds = 2100) => { clock += milliseconds; }, failCompletion: () => { failCompletion = true; }, publisher: () => new ProviderIdentitySyncPublisher(sync, state, () => clock) };
}

describe('durable snapshot publication', () => {
  it('publishes its manifest only after fragments and cadence survive a new MV3 instance', async () => {
    const test = fixture();
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'STAGED', retryAt: 12100 });
    expect((await readProviderIdentitySnapshots(test.values)).validGenerations).toBe(0);
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'DEFERRED', retryAt: 12100 });
    expect(test.sync.write).toHaveBeenCalledTimes(1);
    test.advance();
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'PUBLISHED' });
    expect(await readProviderIdentitySnapshots(test.values)).toMatchObject({ ids, validGenerations: 1 });
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'UNCHANGED' });
    expect(test.sync.write).toHaveBeenCalledTimes(2);
  });

  it('resumes after a failed fragment write without losing the pending IDs or cadence', async () => {
    const test = fixture();
    test.sync.write.mockRejectedValueOnce(new Error('interrupted'));
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'RETRYABLE' });
    expect(await test.state.read()).toMatchObject({ pending: { ids }, lastWriteAt: 10000 });
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'DEFERRED', retryAt: 12100 });
    test.advance();
    expect(await test.publisher().publish(ids)).toMatchObject({ kind: 'STAGED' });
    test.advance();
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'PUBLISHED' });
  });

  it('recognizes a committed manifest after interruption before the local receipt', async () => {
    const test = fixture();
    await test.publisher().publish(ids); test.advance(); test.failCompletion();
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'RETRYABLE' });
    expect((await readProviderIdentitySnapshots(test.values)).ids).toEqual(ids);
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'PUBLISHED' });
    expect(test.sync.write).toHaveBeenCalledTimes(2);
  });

  it('preserves both installations when their generation numbers coincide', async () => {
    const values: ProviderSyncStorageValues = {};
    const first = fixture(values); const second = fixture(values);
    const other = { ...emptySyncedProviderIds(), mangaUpdates: ['2'] };
    await first.publisher().publish(ids); await second.publisher().publish(other);
    first.advance(); second.advance();
    await second.publisher().publish(other); await first.publisher().publish(ids);
    expect(await readProviderIdentitySnapshots(values)).toMatchObject({ validGenerations: 2, ids: { ...ids, mangaUpdates: ['2'] } });
  });

  it('defers quota overflow without removing existing keys or starting a partial generation', async () => {
    const values = Object.fromEntries(Array.from({ length: 511 }, (_, index) => [`kept-${index}`, 'value']));
    const test = fixture(values);
    expect(await test.publisher().publish(ids)).toEqual({ kind: 'QUOTA_EXCEEDED' });
    expect(Object.keys(values)).toHaveLength(511);
    expect(test.sync.write).not.toHaveBeenCalled();
  });
});
