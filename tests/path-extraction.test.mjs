import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPathEntries, extractPaths } from '../.codex/hooks/path-extraction.mjs';

test('path extraction covers file arrays, patch paths, and renames', () => {
  assert.deepEqual(extractPaths({
    files: ['src/a.js', { filePath: 'src/b.ts' }],
    old_path: 'src/old.py',
    new_path: 'src/new.py',
    patch: '*** Update File: src/c.css\n.body {}'
  }).sort(), ['src/a.js', 'src/b.ts', 'src/c.css', 'src/new.py', 'src/old.py']);
  assert.deepEqual(extractPathEntries({ old_path: 'src/old.py', new_path: 'src/new.py' }), [
    { path: 'src/old.py', key: 'old_path' },
    { path: 'src/new.py', key: 'new_path' }
  ]);
  assert.deepEqual(extractPaths({ files: ['src/a.js'] }), ['src/a.js']);
});
