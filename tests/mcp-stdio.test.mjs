import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { ORCHESTRATOR_TOOL_NAMES } from '../scripts/orchestrator-mcp.mjs';
import { validateMcpInstallation } from '../scripts/validate-mcp-installation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const nodeCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : process.execPath;

test('project-local MCP manifests expose orchestrator and context without Progress', () => {
  const result = validateMcpInstallation(root);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.servers, ['ctxroute-orchestrator', 'code-review-graph']);
  assert.deepEqual(result.contextProviders, ['ctxroute@2.0.0', 'code-review-graph@2.3.8']);
});

test('a real stdio client reads and mutates the orchestrator idempotently', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'orchestrator-mcp-stdio-'));
  mkdirSync(join(fixture, '.project'));
  await withClient(join(root, 'scripts/orchestrator-mcp.mjs'), fixture, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...ORCHESTRATOR_TOOL_NAMES].sort());
    assert.ok(listed.tools.some(tool => tool.name === 'orchestrator_reconcile_worktrees'));
    assert.ok(listed.tools.some(tool => tool.name === 'orchestrator_rollback_mission'));
    assert.ok(!listed.tools.some(tool => tool.name.includes('purge')));
    assert.ok(JSON.stringify(listed.tools).length < 8000);
    const initial = await client.callTool({ name: 'orchestrator_read', arguments: {} });
    assert.match(initial.content[0].text, /"mode": "SWARM_ON"/u);
    const transaction = { operation_id: 'set-off', expected_revision: 0, action: 'mode.set', payload: { mode: 'SWARM_OFF' } };
    const first = await client.callTool({ name: 'orchestrator_mutate', arguments: transaction });
    const replay = await client.callTool({ name: 'orchestrator_mutate', arguments: transaction });
    assert.notEqual(first.isError, true);
    assert.match(replay.content[0].text, /"replayed": true/u);
  });
});

test('CTXRoute remains queryable on demand through the MCP without Progress', async () => {
  await withClient(join(root, 'scripts/orchestrator-mcp.mjs'), root, async client => {
    const response = await client.callTool({ name: 'ctxroute_context_query', arguments: { paths: ['.project/project-config.json'], session_id: `mcp-query-${process.pid}-${Date.now()}` } });
    assert.notEqual(response.isError, true);
    assert.match(response.content[0].text, /"references"/u);
    assert.doesNotMatch(response.content[0].text, /conversation_history|last_assistant_message/u);
  });
});

async function withClient(script, cwd, operation) {
  const client = new Client({ name: 'ctxroute-test-client', version: '1.0.0' });
  const args = process.platform === 'win32' ? ['/d', '/c', process.execPath, script] : [script];
  const transport = new StdioClientTransport({ command: nodeCommand, args, cwd, stderr: 'pipe', env: process.platform === 'win32' ? process.env : undefined });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try { await client.connect(transport); await operation(client); }
  catch (error) { error.message += stderr ? `\nServer stderr:\n${stderr}` : ''; throw error; }
  finally { await client.close(); }
}
