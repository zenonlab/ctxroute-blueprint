import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const database = readFileSync(new URL('./database.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./dexie-storage-port.ts', import.meta.url), 'utf8');

describe('DexieStoragePort structure', () => {
  it('keeps Dexie inside the adapter and declares every private aggregate store', () => {
    expect(database).toMatch(/from 'dexie'/);
    for (const store of ['agenda', 'favoriteSources', 'libraries', 'progress', 'reminders', 'reviews', 'works']) {
      expect(database).toContain(`${store}: '&id`);
    }
    expect(adapter).toMatch(/implements StoragePort/);
  });

  it('opens explicit read-write scopes and revalidates domain records', () => {
    expect(adapter).toMatch(/transaction\('rw', this\.tables\(stores\)/);
    expect(adapter).toMatch(/outside the transaction scope/);
    for (const factory of ['createAgendaEntry', 'createFavoriteSource', 'createLibrary', 'createProgress', 'createReminder', 'createReview', 'createWork']) {
      expect(adapter).toContain(factory);
    }
  });
});
