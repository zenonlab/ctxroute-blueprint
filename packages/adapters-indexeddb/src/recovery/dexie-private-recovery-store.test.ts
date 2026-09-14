import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adapter = readFileSync(new URL('./dexie-private-recovery-store.ts', import.meta.url), 'utf8');

describe('Dexie private recovery boundary', () => {
  it('uses one explicit transaction without restoring retired owner state', () => {
    expect(adapter).toContain("this.database.transaction('rw', snapshotTables(this.database)");
    for (const store of ['agenda', 'favoriteSources', 'libraries', 'organizer', 'progress', 'reminders', 'reviews', 'works']) expect(adapter).toContain(`database.${store}`);
    for (const derived of ['favoriteArtifacts', 'favoriteResolutionTasks', 'providerIdentityRecovery']) expect(adapter).toContain(`database.${derived}`);
    expect(adapter).not.toMatch(/owner|collective|journal/iu);
    expect(adapter).toContain('validatePrivateSnapshot(input)');
  });
});
