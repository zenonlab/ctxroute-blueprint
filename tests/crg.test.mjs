import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldUpdate } from '../.codex/hooks/post-tool-crg.mjs';
import { CRG_MCP_TOOLS, CRG_VERSION, MAX_OUTPUT_BYTES, crgInvocation, runCrgCommand, runCrgUpdate } from '../scripts/crg-runner.mjs';

const nodeChild = source => () => spawn(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('CRG invocation is frozen, project-local, and exactly pinned', () => {
  const invocation = crgInvocation(['--version'], '/workspace');
  assert.equal(invocation.executable, 'uv');
  assert.deepEqual(invocation.args.slice(0, 3), ['run', '--project', resolve('/workspace', 'packages/code-review-graph')]);
  assert.ok(invocation.args.includes('--frozen'));
  assert.equal(CRG_VERSION, '2.3.8');
  const mcp = crgInvocation(['serve', '--repo', '/workspace'], '/workspace');
  assert.deepEqual(mcp.args.slice(-2), ['--tools', CRG_MCP_TOOLS.join(',')]);
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
  assert.equal(shouldUpdate({ tool_name: 'exec_command', tool_input: { cmd: 'rg TODO .' }, tool_response: {} }), false);
  assert.equal(shouldUpdate({ tool_name: 'exec_command', tool_input: { cmd: 'npm test' }, tool_response: {} }), false);
});

test('embeddings remain absent by default and cloud egress requires explicit consent', () => {
  const project = readFileSync(join(repositoryRoot, 'packages/code-review-graph/pyproject.toml'), 'utf8');
  const decision = readFileSync(join(repositoryRoot, 'docs/decisions/ADR-0018-official-code-review-graph.md'), 'utf8');
  assert.match(project, /code-review-graph==2\.3\.8/u);
  assert.doesNotMatch(project, /code-review-graph\[(?:embeddings|google-embeddings|all)\]/u);
  assert.match(decision, /Local embeddings require an\nexplicit optional installation/u);
  assert.match(decision, /CRG_ACCEPT_CLOUD_EMBEDDINGS=1/u);
  assert.match(decision, /secrets and provider configuration are never\nversioned/u);
});
