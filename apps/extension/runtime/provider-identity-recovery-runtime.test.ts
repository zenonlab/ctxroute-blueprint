import { emptySyncedProviderIds, prepareProviderIdentitySnapshot } from '@tobirink/application';
import type { ProviderIdentityRecoveryState } from '@tobirink/application';
import { MemoryStoragePort } from '@tobirink/contracts';
import { workId } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { createProviderIdentityRecoveryRuntime } from './provider-identity-recovery-runtime';

describe('provider identity recovery orchestration', () => {
  it('reads a validated snapshot, restores exact metadata, then completes its Work ID scan', async () => {
    const ids = { ...emptySyncedProviderIds(), anilist: ['1'] };
    const snapshot = await prepareProviderIdentitySnapshot(ids, 1);
    const values = { ...snapshot.fragments, [snapshot.manifestKey]: snapshot.manifest };
    let state: ProviderIdentityRecoveryState | undefined;
    const hydrate = vi.fn(async () => ({ provider: 'anilist' as const, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, titles: ['Synthetic title'] }));
    const unused = { hydrate: async () => { throw new Error('Wrong provider'); } };
    const publish = vi.fn(async () => ({ kind: 'UNCHANGED' as const }));
    const runtime = createProviderIdentityRecoveryRuntime({
      checkpoints: { read: async () => state, save: async (value) => { state = value; } },
      hydration: { anilist: { hydrate }, mangadex: unused, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused },
      now: () => '2026-09-08T00:00:00.000Z', publisher: { publish }, storage: new MemoryStoragePort(),
      sync: { readAll: async () => values, remove: vi.fn(), write: vi.fn() },
    });
    expect(await runtime.prepare()).toEqual({ kind: 'COMPLETE', hydrated: 1 });
    expect(hydrate).toHaveBeenCalledExactlyOnceWith({ provider: 'anilist', externalId: '1' });
    expect(await runtime.publish()).toEqual({ kind: 'UNCHANGED' });
    expect(publish).toHaveBeenCalledExactlyOnceWith({ ...ids, associations: [], snapshotVersion: 2 });
    expect(state?.scan).toBeUndefined();
    expect(state?.restoration?.complete).toBe(true);
  });

  it('does not treat a rejected storage access restriction as an empty snapshot', async () => {
    const unused = { hydrate: vi.fn() };
    const runtime = createProviderIdentityRecoveryRuntime({
      checkpoints: { read: async () => undefined, save: vi.fn() }, hydration: { anilist: unused, mangadex: unused, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused },
      now: () => '2026-09-08T00:00:00.000Z', publisher: { publish: vi.fn() }, storage: new MemoryStoragePort(),
      sync: { readAll: async () => { throw new Error('Access level rejected'); }, remove: vi.fn(), write: vi.fn() },
    });
    expect(await runtime.prepare()).toMatchObject({ kind: 'RETRYABLE', hydrated: 0 }); expect(unused.hydrate).not.toHaveBeenCalled();
  });

  it('persists the cover repair cursor across MV3 runtime instances', async () => {
    let state: ProviderIdentityRecoveryState | undefined;
    const unused = { hydrate: vi.fn() };
    const dependencies = {
      checkpoints: { read: async () => state, save: async (value: ProviderIdentityRecoveryState) => { state = value; } },
      hydration: { anilist: unused, mangadex: unused, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused },
      now: () => '2026-09-08T00:00:00.000Z', publisher: { publish: vi.fn() }, storage: new MemoryStoragePort(),
      sync: { readAll: async () => ({}), remove: vi.fn(), write: vi.fn() },
    };
    const first = createProviderIdentityRecoveryRuntime(dependencies);
    await first.saveCoverRepairAfterId?.(workId('work_anilist_1'));
    const resumed = createProviderIdentityRecoveryRuntime(dependencies);
    await expect(resumed.coverRepairAfterId?.()).resolves.toBe('work_anilist_1');
    await resumed.saveCoverRepairAfterId?.(undefined);
    await expect(first.coverRepairAfterId?.()).resolves.toBeUndefined();
  });
});
