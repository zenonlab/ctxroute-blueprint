import { describe, expect, it, vi } from 'vitest';
import { createDatabaseReadiness, extensionDatabaseName } from './local-storage';

function adapter(open: () => Promise<void>, schemaVersion = 3) {
  return { database: { open, verno: schemaVersion } };
}

describe('extension local storage composition', () => {
  it('constructs one adapter and coalesces lazy database opening', async () => {
    const open = vi.fn(async () => undefined);
    const createStorage = vi.fn(() => adapter(open));
    const database = createStorage().database;
    const ensureReady = createDatabaseReadiness(database);

    expect(createStorage).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
    await expect(Promise.all([ensureReady(), ensureReady()])).resolves.toEqual([
      { schemaVersion: 3 },
      { schemaVersion: 3 },
    ]);
    expect(open).toHaveBeenCalledOnce();
  });

  it('allows a later request to retry a failed open', async () => {
    const open = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValue(undefined);
    const ensureReady = createDatabaseReadiness(adapter(open).database);

    await expect(ensureReady()).rejects.toThrow('Extension IndexedDB failed to open');
    await expect(ensureReady()).resolves.toEqual({ schemaVersion: 3 });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('uses the stable private database name', () => {
    expect(extensionDatabaseName).toBe('tobirink-private');
  });
});
