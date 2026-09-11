import { createWork, libraryId, workId } from '@tobirink/domain';
import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { emptySyncedProviderIds } from './provider-identity-snapshot';
import { finishProviderIdentityScan, restoreProviderIdentities, scanHydratedProviderIds } from './provider-identity-recovery';
import type { ProviderIdentityRecoveryState, ProviderIdentityRecoveryStatePort } from './provider-identity-recovery';

function checkpoints(): ProviderIdentityRecoveryStatePort {
  let state: ProviderIdentityRecoveryState | undefined;
  return { read: async () => structuredClone(state), save: async (value) => { state = structuredClone(value); } };
}
const unused = { hydrate: async () => { throw new Error('Unexpected provider'); } };
const ids = { ...emptySyncedProviderIds(), anilist: ['1', '2', '3'] };
const candidate = (id: string) => ({ provider: 'anilist' as const, externalId: id, mediaKind: 'ANIME' as const, preSerialization: false, titles: [`Synthetic Series ${id}`] });

describe('provider identities after private database reset', () => {
  it('restores a different provider while retaining unavailable IDs for a later wake', async () => {
    const storage = new MemoryStoragePort();
    const state = checkpoints();
    let clock = '2026-09-08T00:00:00.000Z';
    const anilist = vi.fn(async () => candidate('1')).mockRejectedValueOnce(new Error('offline'));
    const manga = { ...candidate('2'), provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const };
    const mangaupdates = vi.fn(async () => manga);
    const dependencies = { checkpoints: state, storage, now: () => clock, hydration: { anilist: { hydrate: anilist }, mangaupdates: { hydrate: mangaupdates }, mangadex: unused, 'kitsu-anime': unused, 'kitsu-manga': unused } };
    const mixed = { ...emptySyncedProviderIds(), anilist: ['1'], mangaUpdates: ['2'] };
    expect(await restoreProviderIdentities(mixed, dependencies)).toMatchObject({ kind: 'RETRYABLE', hydrated: 1 });
    expect(mangaupdates).toHaveBeenCalledOnce();
    expect((await state.read())?.restoration?.deferred).toHaveLength(1);
    clock = '2026-09-08T00:15:00.000Z';
    expect(await restoreProviderIdentities(mixed, dependencies)).toMatchObject({ kind: 'COMPLETE', hydrated: 1 });
    expect(mangaupdates).toHaveBeenCalledOnce();
    expect(anilist).toHaveBeenCalledTimes(2);
  });

  it('hydrates exact IDs in bounded resumable slices without inventing favorites, Reviews or Library entries', async () => {
    const storage = new MemoryStoragePort();
    const state = checkpoints();
    const hydrate = vi.fn(async (reference: { externalId: string }) => candidate(reference.externalId));
    const hydration = { anilist: { hydrate }, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused };
    const dependencies = { checkpoints: state, hydration, now: () => '2026-09-08T00:00:00.000Z', storage };
    expect(await restoreProviderIdentities(ids, dependencies)).toEqual({ kind: 'PENDING', hydrated: 2 });
    expect(await restoreProviderIdentities(ids, { ...dependencies })).toEqual({ kind: 'COMPLETE', hydrated: 1 });
    expect(await restoreProviderIdentities(ids, dependencies)).toEqual({ kind: 'COMPLETE', hydrated: 0 });
    expect(hydrate.mock.calls.map(([reference]) => reference.externalId)).toEqual(['1', '2', '3']);
    expect(await storage.listFavoriteSources({ limit: 100 })).toEqual([]);
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
    expect(await storage.getLibrary(libraryId('library_primary'))).toBeUndefined();
    expect(await storage.listWorksByIdentityKey({ key: 'synthetic series 1', kind: 'provider-title', limit: 1 })).toHaveLength(1);
    const reset = { ...dependencies, checkpoints: checkpoints(), storage: new MemoryStoragePort() };
    await restoreProviderIdentities(ids, reset); await restoreProviderIdentities(ids, reset);
    expect(hydrate).toHaveBeenCalledTimes(6);
  });

  it('persists a failed hydration at its exact cursor and retries without losing prior Works', async () => {
    const storage = new MemoryStoragePort(); const state = checkpoints();
    let clock = '2026-09-08T00:00:00.000Z';
    const hydrate = vi.fn(async (reference: { externalId: string }) => candidate(reference.externalId))
      .mockResolvedValueOnce(candidate('1')).mockRejectedValueOnce(new Error('offline'));
    const dependencies = { checkpoints: state, hydration: { anilist: { hydrate }, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused }, now: () => clock, storage };
    expect(await restoreProviderIdentities(ids, dependencies)).toMatchObject({ kind: 'RETRYABLE', hydrated: 1 });
    expect(await state.read()).toMatchObject({ restoration: { index: 3, complete: false, deferred: [{ index: 1, retryAt: Date.parse('2026-09-08T00:15:00.000Z') }, { index: 2, retryAt: Date.parse('2026-09-08T00:15:00.000Z') }] } });
    expect(await restoreProviderIdentities(ids, dependencies)).toMatchObject({ kind: 'RETRYABLE', hydrated: 0 });
    expect(hydrate).toHaveBeenCalledTimes(2);
    clock = '2026-09-08T00:15:00.000Z';
    expect(await restoreProviderIdentities(ids, dependencies)).toMatchObject({ kind: 'COMPLETE', hydrated: 2 });
    expect(hydrate.mock.calls.map(([reference]) => reference.externalId)).toEqual(['1', '2', '2', '3']);
  });

  it('does not restart restoration because a provider has removed the first exact ID', async () => {
    const hydrate = vi.fn(async () => undefined);
    const dependencies = { checkpoints: checkpoints(), hydration: { anilist: { hydrate }, mangaupdates: unused, 'kitsu-anime': unused, 'kitsu-manga': unused }, now: () => '2026-09-08T00:00:00.000Z', storage: new MemoryStoragePort() };
    const one = { ...emptySyncedProviderIds(), anilist: ['1'] };
    expect(await restoreProviderIdentities(one, dependencies)).toEqual({ kind: 'COMPLETE', hydrated: 1 });
    expect(await restoreProviderIdentities(one, dependencies)).toEqual({ kind: 'COMPLETE', hydrated: 0 });
    expect(hydrate).toHaveBeenCalledTimes(1);
  });

  it('collects provider IDs through an indexed Work cursor before publishing a complete scan', async () => {
    const storage = new MemoryStoragePort(); const state = checkpoints();
    for (let index = 0; index < 105; index += 1) await storage.putWork(createWork({ id: workId(`work_scan_${String(index).padStart(4, '0')}`), mediaKind: 'anime', preferredTitle: 'Synthetic title', externalReferences: [{ provider: 'anilist', externalId: String(index + 1) }] }));
    const listing = vi.spyOn(storage, 'listWorks');
    expect(await scanHydratedProviderIds(storage, state)).toMatchObject({ complete: false });
    const complete = await scanHydratedProviderIds(storage, state);
    expect(complete.complete).toBe(true); expect(complete.ids.anilist).toHaveLength(105);
    await scanHydratedProviderIds(storage, state);
    expect(listing).toHaveBeenCalledTimes(2);
    expect(listing).toHaveBeenLastCalledWith({ afterId: workId('work_scan_0099'), limit: 100 });
    await finishProviderIdentityScan(state);
    expect((await state.read())?.scan).toBeUndefined();
  });
});
