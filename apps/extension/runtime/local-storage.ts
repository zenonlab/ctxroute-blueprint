import { DexieStoragePort } from '@tobirink/adapters-indexeddb';

export const extensionDatabaseName = 'tobirink-private';

interface LocalDatabaseAdapter {
  database: {
    open(): Promise<void | object>;
    readonly verno: number;
  };
}

export interface ExtensionLocalStorage {
  ensureReady(): Promise<{ schemaVersion: number }>;
}

export function createExtensionLocalStorage(
  createStorage: () => LocalDatabaseAdapter = () => new DexieStoragePort(extensionDatabaseName),
): ExtensionLocalStorage {
  const storage = createStorage();
  let readiness: Promise<{ schemaVersion: number }> | undefined;

  return {
    ensureReady() {
      const pending = readiness ?? storage.database.open()
        .then(() => ({ schemaVersion: storage.database.verno }))
        .catch(() => {
          readiness = undefined;
          throw new Error('Extension IndexedDB failed to open.');
        });
      readiness = pending;
      return pending;
    },
  };
}
