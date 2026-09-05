import { describe, expect, it } from 'vitest';
import { createDeterministicZip, selectRollbackArtifact } from './deterministic-zip.mjs';

describe('extension release packaging', () => {
  it('creates identical ZIP bytes regardless of input order', () => {
    const first = createDeterministicZip([
      { content: 'manifest', name: 'manifest.json' },
      { content: 'worker', name: 'background.js' },
    ]);
    const second = createDeterministicZip([
      { content: 'worker', name: 'background.js' },
      { content: 'manifest', name: 'manifest.json' },
    ]);

    expect(first.equals(second)).toBe(true);
    expect(first.readUInt32LE(0)).toBe(0x04034b50);
    expect(first.subarray(-22).readUInt32LE(0)).toBe(0x06054b50);
    expect(() => createDeterministicZip([{ content: 'escape', name: '../manifest.json' }])).toThrow(/Unsafe ZIP entry name/);
  });

  it('selects only a verified previous version for rollback', () => {
    const history = [
      { artifact: 'tobirink-1.0.0.zip', sha256: 'old-hash', version: '1.0.0' },
      { artifact: 'tobirink-1.1.0.zip', sha256: 'new-hash', version: '1.1.0' },
    ];

    expect(selectRollbackArtifact(history, '1.1.0')).toEqual(history[0]);
    expect(() => selectRollbackArtifact([history[1]], '1.1.0')).toThrow(/No verified previous artifact/);
  });
});
