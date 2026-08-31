import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('workspace inventory is reproducible and Node 22 compatible', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['scripts/check-workspaces.mjs'], { cwd: root, encoding: 'utf8' }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.workspaces, ['packages/ctxroute', 'packages/archify', 'packages/code-review-graph']);
});
