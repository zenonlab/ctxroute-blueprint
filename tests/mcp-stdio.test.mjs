import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { CONTEXT_TOOL_NAMES } from '../scripts/context-mcp.mjs';
import { PROGRESS_TOOL_NAMES } from '../scripts/progress-mcp.mjs';
import { validateMcpInstallation } from '../scripts/validate-mcp-installation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
// Use the runner's PATH-resolved node command on Windows; this avoids
// cross-spawn treating the absolute node.exe path as a shell command.
const nodeCommand = process.platform === 'win32' ? 'node' : process.execPath;

test('project-local MCP manifests have exact server commands and disjoint tools', () => {
  const result = validateMcpInstallation(root);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.servers, ['ctxroute-progress', 'ctxroute-context-ast']);
  assert.equal(result.progressTools.some(name => result.contextTools.includes(name)), false);
});

test('a real stdio client lists and calls all five Context MCP tools', async () => {
  await withClient(join(root, 'scripts/context-mcp.mjs'), root, async client => {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [...CONTEXT_TOOL_NAMES].sort());
    const calls = [
      ['list_symbols', { path: '.githooks/sensor-engine.mjs', max_tokens: 300 }],
      ['summarize_file', { path: '.githooks/sensor-engine.mjs', max_tokens: 300 }],
      ['find_definition', { symbol: 'analyzePaths', path: '.githooks', scope: 'blueprint', max_tokens: 300 }],
      ['find_references', { symbol: 'analyzePaths', path: '.githooks', scope: 'blueprint', max_tokens: 300 }],
      ['get_relevant_context', { query: 'sensor analysis', paths: ['.githooks'], scope: 'blueprint', max_tokens: 300 }],
    ];
    for (const [name, args] of calls) {
      const response = await client.callTool({ name, arguments: args });
      assert.notEqual(response.isError, true, name);
      const body = JSON.parse(response.content[0].text);
      assert.equal(body.schemaVersion, 1, name);
      assert.equal(body.tokenizer, 'gpt-tokenizer@4.0.0', name);
      assert.ok(body.estimatedTokens <= 300, name);
    }
    const rejected = await client.callTool({ name: 'summarize_file', arguments: { path: '/etc/passwd', max_tokens: 300 } });
    assert.equal(rejected.isError, true);
    assert.equal(JSON.parse(rejected.content[0].text).data.error.code, 'ABSOLUTE_PATH');
  });
});

test('Context MCP transports syntax failures with isError true', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'context-mcp-error-'));
  mkdirSync(join(fixture, '.project')); mkdirSync(join(fixture, 'app'));
  writeFileSync(join(fixture, '.gitignore'), '');
  writeFileSync(join(fixture, '.project/project-config.json'), JSON.stringify({ directories: { generated: [] }, starter: { infrastructureRoots: ['.project/'], rootFiles: [] } }));
  writeFileSync(join(fixture, 'app/broken.rb'), 'def broken(\n');
  await withClient(join(root, 'scripts/context-mcp.mjs'), fixture, async client => {
    const response = await client.callTool({ name: 'summarize_file', arguments: { path: 'app/broken.rb', max_tokens: 300 } });
    assert.equal(response.isError, true);
    assert.equal(JSON.parse(response.content[0].text).data.error.code, 'SYNTAX_ERROR');
  });
});

test('a real stdio client lists and calls all four Progress MCP tools', async () => {
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
  });
});

async function withClient(script, cwd, operation) {
  const client = new Client({ name: 'ctxroute-test-client', version: '1.0.0' });
  const args = [script];
  const transport = new StdioClientTransport({ command: nodeCommand, args, cwd, stderr: 'pipe', env: process.platform === 'win32' ? process.env : undefined });
  let stderr = '';
  transport.stderr?.on('data', chunk => { stderr += chunk; });
  try { await client.connect(transport); await operation(client); }
  catch (error) { error.message += stderr ? `\nServer stderr:\n${stderr}` : ''; throw error; }
  finally { await client.close(); }
}
