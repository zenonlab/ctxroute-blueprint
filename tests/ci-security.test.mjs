import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

test('GitHub Actions runtime remains retired', () => {
  const workflowDirectory = join(root, '.github/workflows');
  assert.equal(
    !existsSync(workflowDirectory) || readdirSync(workflowDirectory).length === 0,
    true,
  );
});

test('local verification retains the complete quality boundary', () => {
  const manifest = JSON.parse(read('package.json'));
  for (const command of [
    'validate',
    'typecheck',
    'test:parser-equivalence',
    'test:performance',
    'crg:smoke',
    'integration',
    'npm audit --audit-level=high',
    'build:docs',
  ]) {
    assert.equal(manifest.scripts.verify.includes(command), true, command);
  }
  assert.equal(read('.github/code-review-graph-constraints.txt').trim().endsWith('code-review-graph==2.3.8'), true);
});
