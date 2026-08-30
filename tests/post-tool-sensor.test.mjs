import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hook = join(root, '.codex/hooks/post-tool-sensor.mjs');
function run(input) { return spawnSync(process.execPath, [hook], { cwd: root, input: JSON.stringify(input), encoding: 'utf8' }); }

test('PostToolUse ignores non-source paths and does not mutate policy', () => {
  const before = JSON.stringify({ hooks: 'dispatcher', policy: 'external' });
  const result = run({ tool_name: 'Write', tool_input: { file_path: 'AGENTS.md' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(before, JSON.stringify({ hooks: 'dispatcher', policy: 'external' }));
});

test('PostToolUse emits a stable diagnostic context for modified source files', () => {
  const result = run({ tool_name: 'Edit', tool_input: { file_path: '.project/sensor-rules.json' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  const sql = run({ tool_name: 'Edit', tool_input: { file_path: 'missing.sql' } });
  assert.equal(sql.status, 0);
  assert.match(sql.stdout, /sensor\/read-error/u);
});
