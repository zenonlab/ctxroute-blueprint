import { DexieStoragePort } from '@tobirink/adapters-indexeddb';

export const extensionDatabaseName = 'tobirink-private';

interface LocalDatabaseConnection {
  open(): Promise<void | object>;
  readonly verno: number;
}

export interface ExtensionLocalStorage {
  ensureReady(): Promise<{ schemaVersion: number }>;
  storage: DexieStoragePort;
}

export function createDatabaseReadiness(database: LocalDatabaseConnection) {
  let readiness: Promise<{ schemaVersion: number }> | undefined;

  return function ensureReady(): Promise<{ schemaVersion: number }> {
    const pending = readiness ?? database.open()
      .then(() => ({ schemaVersion: database.verno }))
      .catch(() => {
        readiness = undefined;
        throw new Error('Extension IndexedDB failed to open.');
      });
    readiness = pending;
    return pending;
  };
}

export function createExtensionLocalStorage(): ExtensionLocalStorage {
  const storage = new DexieStoragePort(extensionDatabaseName);
  return { ensureReady: createDatabaseReadiness(storage.database), storage };
}
