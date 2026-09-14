import { describe, expect, it, vi } from 'vitest';
import { emptySyncedProviderIds, prepareProviderIdentitySnapshot } from '@tobirink/application';
import { WebExtensionProviderIdentitySyncAdapter, WebExtensionProviderIdentitySyncStateAdapter } from './web-extension-provider-identity-sync-adapter';

function area() { return { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}), set: vi.fn(async () => {}), setAccessLevel: vi.fn(async () => {}) }; }

describe('trusted extension identity storage adapters', () => {
  it('requires an explicit Firefox policy when native restrictions are unavailable', async () => {
    const storage = { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) };
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage).readAll()).rejects.toThrow('Native storage');
    expect(storage.get).not.toHaveBeenCalled();
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage, 'firefox-background-only').readAll()).resolves.toEqual({});
    await new WebExtensionProviderIdentitySyncStateAdapter(storage, 'firefox-background-only').save({ schemaVersion: 1, lastWriteAt: 0 });
    expect(storage.set).toHaveBeenCalledOnce();
  });

  it('does not bypass a failed native restriction with the Firefox policy', async () => {
    const storage = area(); storage.setAccessLevel.mockRejectedValueOnce(new Error('denied'));
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage, 'firefox-background-only').readAll()).rejects.toThrow('denied');
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('rejects writes outside the identity namespace before a storage mutation', async () => {
    const storage = area();
    const snapshot = await prepareProviderIdentitySnapshot(emptySyncedProviderIds(), 1);
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage).write({ unrelated: snapshot.manifest })).rejects.toThrow();
    expect(storage.set).not.toHaveBeenCalled();
  });
  it('restricts the sync area before any read or write', async () => {
    const storage = area(); const adapter = new WebExtensionProviderIdentitySyncAdapter(storage);
    await adapter.readAll();
    const snapshot = await prepareProviderIdentitySnapshot({ ...emptySyncedProviderIds(), anilist: ['1'] }, 1);
    await adapter.write(snapshot.fragments);
    await adapter.remove(Object.keys(snapshot.fragments));
    expect(storage.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(storage.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(storage.get.mock.invocationCallOrder[0] ?? 0);
    expect(storage.setAccessLevel.mock.invocationCallOrder[0]).toBeLessThan(storage.set.mock.invocationCallOrder[0] ?? 0);
    expect(storage.remove).toHaveBeenCalledWith(Object.keys(snapshot.fragments));
  });

  it('rejects removal outside the provider snapshot namespace', async () => {
    const storage = area();
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage).remove(['unrelated'])).rejects.toThrow();
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('does not read an area when the browser rejects the access restriction', async () => {
    const storage = area(); storage.setAccessLevel.mockRejectedValueOnce(new Error('unsupported restriction'));
    await expect(new WebExtensionProviderIdentitySyncAdapter(storage).readAll()).rejects.toThrow('unsupported restriction');
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  });

  it('keeps publication checkpoints in the supplied local area and validates their fields', async () => {
    const storage = area(); const adapter = new WebExtensionProviderIdentitySyncStateAdapter(storage);
    await adapter.save({ schemaVersion: 1, lastWriteAt: 10000 });
    expect(storage.set).toHaveBeenCalledWith({ 'tobirink-provider-identity-sync-state-v1': { schemaVersion: 1, lastWriteAt: 10000 } });
    expect(storage.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    await expect(adapter.save({ schemaVersion: 1, lastWriteAt: -1 })).rejects.toThrow();
  });

});
