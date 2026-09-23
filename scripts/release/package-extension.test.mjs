import { describe, expect, it } from 'vitest';
import { createDeterministicZip, selectRollbackArtifact } from './deterministic-zip.mjs';
import { assertPreserved, importedBookmarks, installedConverged, installedReviewConfig, installedVerdict } from '../../apps/extension/scripts/installed-review.mjs';

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

describe('installed extension certification', () => {
  const snapshot = () => ({ inventory: 'complete', counts: { observed: 2, processing: 0, resolved: 1, review: 1, retryable: 0, blocked: 0, unsupported: 0 }, unresolved: 0, missingProjectedWorks: 0 });
  const retained = () => ({ aggregate: snapshot(), integrity: { sources: ['source'], works: ['work'], library: ['work'], humanReviews: ['human-decision'], progress: [{ identity: 'progress', value: 5 }] } });

  it('bounds time, observations and resume tokens, requiring private input online', () => {
    expect(installedReviewConfig({}).budgetSeconds).toBe(240);
    expect(installedReviewConfig({ TOBIRINK_REAL_RUN: '1', TOBIRINK_FAVORITES_EXPORT: 'private-input' }).budgetSeconds).toBe(600);
    expect(() => installedReviewConfig({ TOBIRINK_REAL_RUN: '1' })).toThrow(/private bookmark export/);
    expect(() => installedReviewConfig({ TOBIRINK_INSTALLED_BUDGET_SECONDS: '1801' })).toThrow(/bounded/);
    expect(() => installedReviewConfig({ TOBIRINK_INSTALLED_SESSION: '../profile' })).toThrow(/session token/);
    expect(() => installedReviewConfig({ TOBIRINK_INSTALLED_OBSERVE_SECONDS: Array(13).fill('1').join(',') })).toThrow(/twelve/);
    expect(installedReviewConfig({ TOBIRINK_INSTALLED_OBSERVE_SECONDS: '10,1,10' }).milestones).toEqual([1, 10]);
  });

  it('imports titled HTTP entries without hiding structural exclusions', () => {
    expect(importedBookmarks('<A HREF="https://reader.invalid/search/">Utility &amp; links</A><A HREF="https://reader.invalid/empty"> </A><A HREF="file:///private">Local</A>'))
      .toEqual([{ title: 'Utility & links', url: 'https://reader.invalid/search/' }]);
  });

  it('never calls pending, unknown, missing projection or partial inventory converged', () => {
    expect(installedConverged(snapshot(), 2)).toBe(true);
    expect(installedVerdict(snapshot(), 2, true)).toBe('converged');
    for (const patch of [{ inventory: 'running' }, { unresolved: 1 }, { missingProjectedWorks: 1 }, { counts: { ...snapshot().counts, processing: 1 } }, { counts: { ...snapshot().counts, review: 0, retryable: 1 } }, { counts: { ...snapshot().counts, review: 0 } }]) {
      expect(installedVerdict({ ...snapshot(), ...patch }, 2, true)).toBe('incomplete');
    }
    const pending = { ...snapshot(), counts: { ...snapshot().counts, review: 0, retryable: 1 } };
    expect(installedVerdict(pending, 2, false)).toBe('offline-regression-passed');
    expect(installedVerdict({ ...pending, unresolved: 1 }, 2, false)).toBe('incomplete');
    expect(installedVerdict({ ...pending, counts: { ...pending.counts, processing: 1 } }, 2, false)).toBe('incomplete');
  });

  it('detects source, Library, human decision loss and progress regression across restarts', () => {
    expect(() => assertPreserved(retained(), retained(), 2)).not.toThrow();
    for (const field of ['sources', 'works', 'library', 'humanReviews']) {
      const after = retained();
      after.integrity[field] = [];
      expect(() => assertPreserved(retained(), after, 2)).toThrow(/not retained/);
    }
    const after = retained();
    after.integrity.progress[0].value = 4;
    expect(() => assertPreserved(retained(), after, 2)).toThrow(/regressed/);
  });
});
