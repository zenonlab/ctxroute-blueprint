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

  it('round-trips version 2 fingerprint associations while keeping version 1 generations readable', async () => {
    const association = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: 'parser-v4', siteRulesVersion: 'rules-v3', references: [{ provider: 'anilist' as const, externalId: '154587' }] };
    const legacy = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    const current = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['154587'], associations: [association], snapshotVersion: 2 }, 2);
    expect(legacy.manifest.schemaVersion).toBe(1); expect(current.manifest.schemaVersion).toBe(2);
    const restored = await readProviderIdentitySnapshots({ ...complete(legacy), ...complete(current) });
    expect(restored.ids).toMatchObject({ anilist: ['1', '154587'], associations: [association], snapshotVersion: 2 });
    expect(() => syncedProviderIdsSchema.parse({ ...emptySyncedProviderIds(), associations: [{ ...association, title: 'private' }], snapshotVersion: 2 })).toThrow();
  });

  it('drops a conflicting synchronized identity instead of selecting a first reference', () => {
    const base = { fingerprint: 'b'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: 'parser-v4', siteRulesVersion: 'rules-v3' };
    const merged = mergeSyncedProviderIds(
      { ...emptySyncedProviderIds(), associations: [{ ...base, references: [{ provider: 'anilist', externalId: '1' }] }], snapshotVersion: 2 },
      { ...emptySyncedProviderIds(), associations: [{ ...base, references: [{ provider: 'anilist', externalId: '2' }] }], snapshotVersion: 2 },
    );
    expect(merged.associations).toEqual([]);
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

  it('restores only the newest generation and its validated rollback generation', async () => {
    const oldest = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    const rollback = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), mangaUpdates: ['2'] }, 2);
    const newest = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), kitsuAnime: ['3'] }, 3);
    const values = { ...complete(oldest), ...complete(rollback), ...complete(newest) };
    const result = await readProviderIdentitySnapshots(values);
    expect(result.ids).toEqual({ ...emptySyncedProviderIds(), mangaUpdates: ['2'], kitsuAnime: ['3'] });
    expect(result.newestIds).toEqual({ ...emptySyncedProviderIds(), kitsuAnime: ['3'] });
    expect(result.validGenerations).toBe(2);
    expect(result.obsoleteKeys).toEqual(expect.arrayContaining(Object.keys(complete(oldest))));
  });

  it('includes retained generations and unrelated items in the quota reservation', async () => {
    const snapshot = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    const existing = Object.fromEntries(Array.from({ length: 511 }, (_, index) => [`existing-${index}`, 'kept']));
    expect(() => assertProviderSyncQuota(existing, complete(snapshot))).toThrow('QUOTA');
    const bytes = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`existing-${index}`, 'x'.repeat(5000)]));
    expect(() => assertProviderSyncQuota(bytes, complete(snapshot))).toThrow('QUOTA');
  });
});
