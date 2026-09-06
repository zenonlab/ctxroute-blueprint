import { describe, expect, it } from 'vitest';
import type { PrivateSnapshot } from '../../../application/src/recovery/private-export';
import { MemoryRecoveryStore } from './memory-recovery-store';

const empty: PrivateSnapshot = { agenda: [], favoriteSources: [], libraries: [], progress: [], reminders: [], reviews: [], works: [] };

describe('RecoveryStorePort contract', () => {
  it('does not publish state when replacement fails', async () => {
    const store = new MemoryRecoveryStore(empty);
    const before = await store.readSnapshot();
    store.failNextReplace = true;
    await expect(store.replaceSnapshot({ ...empty, works: [] })).rejects.toThrow('simulated');
    expect(await store.readSnapshot()).toEqual(before);
  });
});
