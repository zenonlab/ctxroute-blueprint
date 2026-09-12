import { describe, expect, it } from 'vitest';
import { extensionDiagnosticsEventsKey, extensionDiagnosticsLockKey, extensionDiagnosticsLockValue, WebExtensionDiagnostics } from './extension-diagnostics';

interface MemoryDiagnosticValues {
  'tobirink.extensionDiagnostics'?: string;
  'tobirink.extensionDiagnostics.events.v1'?: readonly object[];
}

class MemoryLocalStorage {
  readonly values: MemoryDiagnosticValues = {};
  async get(_keys: typeof extensionDiagnosticsLockKey | readonly [typeof extensionDiagnosticsLockKey, typeof extensionDiagnosticsEventsKey]) {
    return {
      [extensionDiagnosticsLockKey]: this.values[extensionDiagnosticsLockKey],
      [extensionDiagnosticsEventsKey]: this.values[extensionDiagnosticsEventsKey],
    };
  }
  async set(items: MemoryDiagnosticValues) {
    if (items[extensionDiagnosticsLockKey] !== undefined) this.values[extensionDiagnosticsLockKey] = items[extensionDiagnosticsLockKey];
    if (items[extensionDiagnosticsEventsKey] !== undefined) this.values[extensionDiagnosticsEventsKey] = items[extensionDiagnosticsEventsKey];
  }
}

describe('WebExtensionDiagnostics', () => {
  it('requires the exact lock value and preserves events when disabled', async () => {
    const storage = new MemoryLocalStorage();
    const diagnostics = new WebExtensionDiagnostics(storage, () => '2026-09-12T12:00:00.000Z', () => 'sequence-1');
    await diagnostics.record({ outcome: 'started', runId: 'run-1', stage: 'run' });
    expect((await diagnostics.read()).events).toHaveLength(0);
    await diagnostics.initializeEnabled();
    expect(storage.values[extensionDiagnosticsLockKey]).toBe(extensionDiagnosticsLockValue);
    await diagnostics.record({ counts: { completed: 4, retried: 1 }, outcome: 'complete', runId: 'run-1', stage: 'resolution' });
    await diagnostics.setEnabled(false);
    await diagnostics.record({ outcome: 'failed', runId: 'run-2', stage: 'run' });
    const snapshot = await diagnostics.read();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.events).toHaveLength(1);
    expect(JSON.stringify(storage.values[extensionDiagnosticsEventsKey])).not.toMatch(/title|url|folder|progress|secret/iu);
  });

  it('keeps a bounded ring of valid technical events', async () => {
    const storage = new MemoryLocalStorage();
    const diagnostics = new WebExtensionDiagnostics(storage, () => '2026-09-12T12:00:00.000Z', () => 'sequence');
    await diagnostics.initializeEnabled();
    for (let index = 0; index < 105; index += 1) {
      await diagnostics.record({ counts: { observed: index }, outcome: 'complete', runId: `run-${index}`, stage: 'inventory' });
    }
    expect((await diagnostics.read()).events).toHaveLength(100);
  });
});
