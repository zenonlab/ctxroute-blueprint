import { describe, expect, it } from 'vitest';
import { MemoryRecoveryStore } from '../../../contracts/src/export/memory-recovery-store';
import { createPrivateExport, importPrivateExport, validatePrivateExport } from './private-export';

const empty = { agenda: [], libraries: [], progress: [], reminders: [], reviews: [], works: [] };

describe('private recovery', () => {
  it('creates and validates a versioned export', async () => {
    const value = await createPrivateExport(new MemoryRecoveryStore(empty), '2026-09-04T10:00:00.000Z');
    expect(validatePrivateExport(JSON.stringify(value))).toEqual(value);
  });

  it('validates everything and requires confirmation before atomic replacement', async () => {
    const store = new MemoryRecoveryStore(empty);
    const value = await createPrivateExport(store, '2026-09-04T10:00:00.000Z');
    await expect(importPrivateExport(JSON.stringify({ ...value, version: 2 }), store, 'replace-private-state')).rejects.toThrow();
    await expect(importPrivateExport(JSON.stringify(value), store, 'no')).rejects.toThrow('confirmation');
    await importPrivateExport(JSON.stringify(value), store, 'replace-private-state');
    expect(store.replaceCount).toBe(1);
  });
});
