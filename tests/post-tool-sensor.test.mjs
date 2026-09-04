import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('..', import.meta.url));
const hook = join(root, '.codex/hooks/post-tool-sensor.mjs');
const state = mkdtempSync(join(tmpdir(), 'post-tool-sensor-state-'));
process.on('exit', () => rmSync(state, { recursive: true, force: true }));
function run(input) { return spawnSync(process.execPath, [hook], { cwd: root, env: { ...process.env, CTXROUTE_STATE_DIR: state }, input: JSON.stringify(input), encoding: 'utf8' }); }

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

test('PostToolUse forwards an unsafe SQL sink diagnostic to the agent context', () => {
  const directory = mkdtempSync(join(tmpdir(), 'post-tool-sensor-'));
  const path = join(directory, 'query.js');
  writeFileSync(path, "db.query('SELECT * FROM users WHERE id = ' + userId);\n");
  const result = run({ tool_name: 'Edit', tool_input: { file_path: path } });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /sensor\/sql-injection/u);
  assert.match(output.hookSpecificOutput.additionalContext, /"verdict":"UNSAFE"/u);
  assert.match(output.hookSpecificOutput.additionalContext, /"rateLimitRuntimeProof":false/u);
  assert.equal('decision' in output, false);
  assert.match(output.hookSpecificOutput.additionalContext, /already exists/u);
});
test('PostToolUse forwards diagnostics from a Svelte component', () => {
  const directory = mkdtempSync(join(tmpdir(), 'post-tool-sensor-svelte-'));
  const path = join(directory, 'Query.svelte');
  writeFileSync(path, '<script>db.query(`SELECT * FROM users WHERE id = ${userId}`);</script>\n');
  const result = run({ tool_name: 'Edit', tool_input: { file_path: path } });
  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.hookSpecificOutput.additionalContext, /sensor\/sql-injection/u);
  assert.equal('decision' in output, false);
});

test('PostToolUse emits WARN once per session and keeps it compact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'post-tool-sensor-warn-'));
  const path = join(directory, 'debug.js');
  writeFileSync(path, 'console.log(value);\n');
  const input = { session_id: 'warn-session', tool_name: 'Edit', tool_input: { file_path: path } };
  const first = run(input);
  const second = run(input);
  const context = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  assert.match(context, /Sensor WARN/u);
  assert.ok(context.length <= 300);
  assert.equal(second.stdout, '');
});

test('PostToolUse does not treat an intentional delete as a read failure', () => {
  const result = run({ tool_name: 'Delete', tool_input: { file_path: 'removed.js' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});

test('PostToolUse fails open with a visible message for invalid JSON', () => {
  const result = spawnSync(process.execPath, [hook], { cwd: root, input: '{', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /invalid JSON input/u);
});
