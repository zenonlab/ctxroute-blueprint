import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
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

test('a real stdio client lists and calls all Progress MCP tools', { skip: process.platform === 'win32' }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'progress-mcp-stdio-'));
  mkdirSync(join(fixture, '.project')); mkdirSync(join(fixture, 'docs'));
  await withClient(join(root, 'scripts/progress-mcp.mjs'), fixture, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...PROGRESS_TOOL_NAMES].sort());
    for (const name of ['progress_read', 'progress_status']) {
      const response = await client.callTool({ name, arguments: {} });
      assert.notEqual(response.isError, true, name);
    }
    const plan = { goalId: 'stdio-goal', title: 'Stdio proof', validationEvidence: ['npm test'], steps: [{ id: 'step-1', title: 'Verify transport', acceptance: ['All tools respond'], files: ['tests/mcp-stdio.test.mjs'], commands: ['npm test'] }] };
    const validated = await client.callTool({ name: 'progress_validate_plan', arguments: plan });
    assert.notEqual(validated.isError, true);
    const approved = await client.callTool({ name: 'progress_approve_plan', arguments: { ...plan, approved: true } });
    assert.notEqual(approved.isError, true);
    assert.notEqual((await client.callTool({ name: 'progress_set_mode', arguments: { goalId: plan.goalId, mode: 'autonomous', userConfirmed: true } })).isError, true);
    assert.notEqual((await client.callTool({ name: 'progress_update_step', arguments: { goalId: plan.goalId, stepId: 'step-1', status: 'DONE', evidence: ['npm test'] } })).isError, true);
    const next = await client.callTool({ name: 'progress_next', arguments: { goalId: plan.goalId } });
    assert.match(next.content[0].text, /"complete": true/u);
  });
});

async function withClient(script, cwd, operation) {
  const client = new Client({ name: 'ctxroute-test-client', version: '1.0.0' });
  const args = process.platform === 'win32'
    ? ['/d', '/c', process.execPath, script]
    : [script];
  const transport = new StdioClientTransport({ command: nodeCommand, args, cwd, stderr: 'pipe', env: process.platform === 'win32' ? process.env : undefined });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try { await client.connect(transport); await operation(client); }
  catch (error) { error.message += stderr ? `\nServer stderr:\n${stderr}` : ''; throw error; }
  finally { await client.close(); }
}
