import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const database = readFileSync(new URL('./database.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./dexie-storage-port.ts', import.meta.url), 'utf8');

describe('DexieStoragePort structure', () => {
  it('keeps Dexie inside the adapter and declares every private aggregate store', () => {
    expect(database).toMatch(/from 'dexie'/);
    for (const store of ['agenda', 'favoriteSources', 'libraries', 'organizer', 'progress', 'reminders', 'reviews', 'works']) {
      expect(database).toContain(`${store}: '&id`);
    }
    expect(adapter).toMatch(/implements StoragePort/);
    expect(adapter).toMatch(/reviews\.where\('status'\)\.equals\(status\)\.limit\(limit\)/);
    expect(database).toMatch(/reviews: '&id, status, matchedWorkId'/);
    expect(adapter).toMatch(/reviews\.where\('matchedWorkId'\)\.equals\(query\.workId\)\.limit\(query\.limit\)/);
    expect(adapter).toMatch(/favoriteSources\.where\('reviewId'\)\.equals\(reviewId\)\.limit\(2\)/);
    expect(adapter).toMatch(/agenda\.where\('occursAt'\)\.between\(query\.from, query\.to, true, false\)\.limit\(query\.limit\)/);
    expect(adapter).toMatch(/getOrganizerConfiguration:[\s\S]*createOrganizerConfiguration\(configuration\)/);
    expect(adapter).toMatch(/putOrganizerConfiguration:[\s\S]*createOrganizerConfiguration\(configuration\)/);
  });

  it('opens explicit read-write scopes and revalidates domain records', () => {
    expect(adapter).toMatch(/transaction\('rw', this\.tables\(stores\)/);
    expect(adapter).toMatch(/outside the transaction scope/);
    for (const factory of ['createAgendaEntry', 'createFavoriteSource', 'createLibrary', 'createOrganizerConfiguration', 'createProgress', 'createReminder', 'createReview', 'createWork']) {
      expect(adapter).toContain(factory);
    }
  });
});
