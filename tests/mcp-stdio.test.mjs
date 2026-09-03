import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { PROGRESS_TOOL_NAMES } from '../scripts/progress-mcp.mjs';
import { validateMcpInstallation } from '../scripts/validate-mcp-installation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Delegate to ComSpec on Windows so the runner handles node.exe consistently.
const nodeCommand = process.platform === 'win32'
  ? (process.env.ComSpec ?? 'cmd.exe')
  : process.execPath;

test('project-local MCP manifests have exact server commands and disjoint tools', () => {
  const result = validateMcpInstallation(root);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.servers, ['ctxroute-progress', 'code-review-graph']);
  assert.equal(result.contextProvider, 'code-review-graph@2.3.8');
});

test('Codex MCP validation rejects a server outside the repository root', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'progress-mcp-config-'));
  mkdirSync(join(fixture, '.codex'));
  writeFileSync(join(fixture, '.mcp.json'), readFileSync(join(root, '.mcp.json')));
  writeFileSync(join(fixture, '.codex/config.toml'), readFileSync(join(root, '.codex/config.toml'), 'utf8').replace('cwd = "."', 'cwd = ".."'));
  const result = validateMcpInstallation(fixture);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /repository root/u);
});

test('Codex MCP validation enforces the bounded optional startup grace', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'progress-mcp-grace-'));
  mkdirSync(join(fixture, '.codex'));
  writeFileSync(join(fixture, '.mcp.json'), readFileSync(join(root, '.mcp.json')));
  const config = readFileSync(join(root, '.codex/config.toml'), 'utf8')
    .replace('mcp_optional_startup_grace_ms = 3000', 'mcp_optional_startup_grace_ms = 1000');
  writeFileSync(join(fixture, '.codex/config.toml'), config);
  const result = validateMcpInstallation(fixture);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /3000 ms/u);
});

test('a real stdio client lists and calls all Progress MCP tools', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'progress-mcp-stdio-'));
  mkdirSync(join(fixture, '.project')); mkdirSync(join(fixture, 'docs'));
  await withClient(join(root, 'scripts/progress-mcp.mjs'), fixture, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...PROGRESS_TOOL_NAMES].sort());
    assert.equal(listed.tools.some(tool => tool.name === 'progress_read'), false);
    assert.ok(JSON.stringify(listed.tools).length < 6000, 'Progress MCP schemas must remain below 6,000 characters');
    const statusResponse = await client.callTool({ name: 'progress_status', arguments: {} });
    assert.notEqual(statusResponse.isError, true);
    const resources = await client.listResources();
    assert.deepEqual(resources.resources.map(resource => resource.uri), ['ctxroute://progress/full']);
    const full = await client.readResource({ uri: 'ctxroute://progress/full' });
    assert.deepEqual(JSON.parse(full.contents[0].text), { schemaVersion: 1, goals: [] });
    const opened = JSON.parse((await client.callTool({ name: 'progress_open_dashboard', arguments: {} })).content[0].text);
    assert.match(opened.url, /^http:\/\/localhost:\d+\/#/u);
    assert.equal(opened.reused, false);
    const reused = JSON.parse((await client.callTool({ name: 'progress_open_dashboard', arguments: {} })).content[0].text);
    assert.equal(reused.reused, true);
    assert.equal(reused.instanceId, opened.instanceId);
    const plan = { goalId: 'stdio-goal', title: 'Stdio proof', validationEvidence: ['npm test'], steps: [{ id: 'step-1', title: 'Verify transport', acceptance: ['All tools respond'], files: ['tests/mcp-stdio.test.mjs'], commands: ['npm test'] }] };
    const validated = await client.callTool({ name: 'progress_validate_plan', arguments: plan });
    assert.notEqual(validated.isError, true);
    assert.deepEqual(JSON.parse(validated.content[0].text), { ok: true, errors: [] });
    const approved = await client.callTool({ name: 'progress_approve_plan', arguments: { ...plan, approved: true } });
    assert.notEqual(approved.isError, true);
    assert.equal(JSON.parse(approved.content[0].text).progress, undefined);
    const premature = await client.callTool({ name: 'progress_update_step', arguments: { goalId: plan.goalId, stepId: 'step-1', agentId: 'stdio-agent', status: 'DONE', evidence: ['npm test'] } });
    assert.equal(premature.isError, true);
    const claim = JSON.parse((await client.callTool({ name: 'progress_claim_ticket', arguments: { goalId: plan.goalId, agentId: 'stdio-agent' } })).content[0].text);
    assert.equal(claim.ticket.assignee, 'stdio-agent');
    const unclassifiedManual = await client.callTool({ name: 'progress_set_mode', arguments: { goalId: plan.goalId, mode: 'manual' } });
    assert.equal(unclassifiedManual.isError, true);
    const mode = JSON.parse((await client.callTool({ name: 'progress_set_mode', arguments: { goalId: plan.goalId, mode: 'manual', reason: 'visual-review' } })).content[0].text);
    assert.deepEqual(mode.goal, { id: plan.goalId, status: 'ACTIVE', executionMode: 'manual', steps: 1, manualReason: 'visual-review' });
    assert.equal(mode.progress, undefined);
    const updateResponse = await client.callTool({ name: 'progress_update_step', arguments: { goalId: plan.goalId, stepId: 'step-1', agentId: 'stdio-agent', status: 'DONE', evidence: ['npm test'] } });
    const update = JSON.parse(updateResponse.content[0].text);
    assert.equal(update.goal.status, 'DONE');
    assert.deepEqual(update.ticket, { stepId: 'step-1', status: 'DONE', assignee: 'stdio-agent', evidence: ['npm test'] });
    const next = await client.callTool({ name: 'progress_next', arguments: { goalId: plan.goalId } });
    assert.match(next.content[0].text, /"complete":true/u);
    assert.ok(validated.content[0].text.length < 100 && approved.content[0].text.length < 300 && updateResponse.content[0].text.length < 400);
    const state = JSON.parse(readFileSync(join(fixture, '.ctxroute/state/progress-dashboard.json'), 'utf8'));
    try { process.kill(state.pid, 'SIGTERM'); } catch {}
  });
});

test('the Codex npm command launches the real Progress MCP transport', { skip: process.platform === 'win32' }, async () => {
  await withTransport({ command: 'npm', args: ['run', 'progress:mcp'], cwd: root }, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...PROGRESS_TOOL_NAMES].sort());
    const status = await client.callTool({ name: 'progress_status', arguments: {} });
    assert.notEqual(status.isError, true);
  });
});

async function withClient(script, cwd, operation) {
  const args = process.platform === 'win32'
    ? ['/d', '/c', process.execPath, script]
    : [script];
  return withTransport({ command: nodeCommand, args, cwd, env: process.platform === 'win32' ? process.env : undefined }, operation);
}

async function withTransport({ command, args, cwd, env }, operation) {
  const client = new Client({ name: 'ctxroute-test-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command, args, cwd, stderr: 'pipe', env });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try { await client.connect(transport); await operation(client); }
  catch (error) { error.message += stderr ? `\nServer stderr:\n${stderr}` : ''; throw error; }
  finally { await client.close(); }
}
