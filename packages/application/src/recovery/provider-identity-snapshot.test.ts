import { describe, expect, it } from 'vitest';
import { assertProviderSyncQuota, emptySyncedProviderIds, mergeSyncedProviderIds, prepareProviderIdentitySnapshot, providerSyncItemBytes, readProviderIdentitySnapshots, syncedProviderIdsSchema } from './provider-identity-snapshot';
import type { ProviderIdentitySnapshot } from './provider-identity-snapshot';

function complete(snapshot: ProviderIdentitySnapshot) { return { ...snapshot.fragments, [snapshot.manifestKey]: snapshot.manifest }; }

describe('synchronized provider identity snapshots', () => {
  it('sorts and deduplicates IDs while rejecting titles, URLs and extra private fields', () => {
    expect(mergeSyncedProviderIds({ ...emptySyncedProviderIds(), anilist: ['2', '1', '2'] }).anilist).toEqual(['1', '2']);
    expect(() => syncedProviderIdsSchema.parse({ ...emptySyncedProviderIds(), title: 'Synthetic title' })).toThrow();
    expect(() => syncedProviderIdsSchema.parse({ ...emptySyncedProviderIds(), anilist: ['https://anilist.co/anime/1'] })).toThrow();
    expect(() => syncedProviderIdsSchema.parse({ ...emptySyncedProviderIds(), mangaUpdates: ['raw-title'] })).toThrow();
  });

  it('fragments under the actual per-item byte budget and verifies the full digest', async () => {
    const ids = { ...emptySyncedProviderIds(), anilist: Array.from({ length: 5000 }, (_, index) => String(index + 1)) };
    const snapshot = await prepareProviderIdentitySnapshot(ids, 1);
    expect(snapshot.manifest.fragmentCount).toBeGreaterThan(1);
    expect(Object.entries(complete(snapshot)).every(([key, value]) => providerSyncItemBytes(key, value) < 8192)).toBe(true);
    expect(() => assertProviderSyncQuota({}, complete(snapshot))).not.toThrow();
    expect(await readProviderIdentitySnapshots(complete(snapshot))).toMatchObject({ ids: mergeSyncedProviderIds(ids), generation: 1, validGenerations: 1, invalidGenerations: 0 });
  });

  it('keeps the preceding snapshot when a newer generation is corrupt or incomplete', async () => {
    const old = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    const next = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1', '2'] }, 2);
    const [fragmentKey] = Object.keys(next.fragments);
    if (fragmentKey === undefined) throw new Error('Expected fragment.');
    const corrupt = { ...complete(old), ...complete(next), [fragmentKey]: { schemaVersion: 1, generation: 2, index: 0, payload: '{}' } };
    expect(await readProviderIdentitySnapshots(corrupt)).toMatchObject({ ids: { ...emptySyncedProviderIds(), anilist: ['1'] }, generation: 1, invalidGenerations: 1 });
    expect(await readProviderIdentitySnapshots({ ...complete(old), ...next.fragments })).toMatchObject({ ids: { ...emptySyncedProviderIds(), anilist: ['1'] }, validGenerations: 1 });
  });

  it('retains concurrent and stale-generation additions without cross-generation fragment mixing', async () => {
    const first = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 10);
    const concurrent = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), mangaUpdates: ['2'] }, 10);
    const older = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), kitsuAnime: ['3'] }, 9);
    expect(first.manifestKey).not.toBe(concurrent.manifestKey);
    expect(await readProviderIdentitySnapshots({ ...complete(first), ...complete(concurrent), ...complete(older) })).toMatchObject({ generation: 10, validGenerations: 3, ids: { ...emptySyncedProviderIds(), anilist: ['1'], mangaUpdates: ['2'], kitsuAnime: ['3'] } });
  });

  it('includes retained generations and unrelated items in the quota reservation', async () => {
    const snapshot = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    const existing = Object.fromEntries(Array.from({ length: 511 }, (_, index) => [`existing-${index}`, 'kept']));
    expect(() => assertProviderSyncQuota(existing, complete(snapshot))).toThrow('QUOTA');
    const bytes = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`existing-${index}`, 'x'.repeat(5000)]));
    expect(() => assertProviderSyncQuota(bytes, complete(snapshot))).toThrow('QUOTA');
  });
});
