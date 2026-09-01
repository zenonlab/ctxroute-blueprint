import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shouldUpdate } from '../.codex/hooks/post-tool-crg.mjs';
import { CRG_VERSION, MAX_OUTPUT_BYTES, crgInvocation, runCrgCommand, runCrgUpdate } from '../scripts/crg-runner.mjs';

const nodeChild = source => () => spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });

test('CRG invocation is frozen, project-local, and exactly pinned', () => {
  const invocation = crgInvocation(['--version'], '/workspace');
  assert.equal(invocation.executable, 'uv');
  assert.deepEqual(invocation.args.slice(0, 3), ['run', '--project', '/workspace/packages/code-review-graph']);
  assert.ok(invocation.args.includes('--frozen'));
  assert.equal(CRG_VERSION, '2.3.8');
});

test('CRG update builds a missing graph and updates an existing graph', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crg-runner-'));
  let result = await runCrgUpdate({ root, spawnImpl: nodeChild('process.stdout.write("built")') });
  assert.deepEqual(result.command, ['build', '--repo', root]);
  assert.equal(result.stdout, 'built');
  await writeFile(join(root, '.code-review-graph', 'graph.db'), 'fixture');
  result = await runCrgUpdate({ root, spawnImpl: nodeChild('process.stdout.write("updated")') });
  assert.deepEqual(result.command, ['update', '--repo', root, '--skip-flows']);
  assert.equal(result.stdout, 'updated');
});

test('CRG update lock is cross-process single-flight and fail-open', async () => {
  const root = await mkdtemp(join(tmpdir(), 'crg-lock-'));
  await mkdir(join(root, '.code-review-graph', '.ctxroute-update.lock'), { recursive: true });
  const result = await runCrgUpdate({ root, spawnImpl: () => { throw new Error('must not spawn'); } });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'update already running');
});

test('CRG child timeout and output are bounded', async () => {
  const result = await runCrgCommand({
    root: process.cwd(),
    timeoutMs: 25,
    spawnImpl: nodeChild(`process.stdout.write('x'.repeat(${MAX_OUTPUT_BYTES * 2})); setInterval(() => {}, 1000)`),
  });
  assert.equal(result.timedOut, true);
  assert.ok(Buffer.byteLength(result.stdout) <= MAX_OUTPUT_BYTES);
});

test('PostToolUse triggers only one successful normal write', () => {
  assert.equal(shouldUpdate({ tool_name: 'Edit', tool_input: { file_path: 'src/a.js' }, tool_response: {} }), true);
  assert.equal(shouldUpdate({ tool_name: 'Read', tool_input: { file_path: 'src/a.js' }, tool_response: {} }), false);
  assert.equal(shouldUpdate({ tool_name: 'Edit', tool_input: { file_path: 'src/a.js' }, tool_response: { isError: true } }), false);
  assert.equal(shouldUpdate({ tool_name: 'exec_command', tool_input: { cmd: 'npm run crg:update' }, tool_response: {} }), false);
});
