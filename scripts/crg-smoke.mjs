import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { CRG_VERSION, CRG_MCP_TOOLS, crgInvocation, runCrgCommand } from './crg-runner.mjs';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'ctxroute-crg-smoke-'));
mkdirSync(join(fixture, 'src'));
writeFileSync(join(fixture, 'src', 'math.py'), 'def add(left, right):\n    return left + right\n');
execFileSync('git', ['init', '-q'], { cwd: fixture });
execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: fixture });
execFileSync('git', ['config', 'user.name', 'CRG smoke'], { cwd: fixture });
execFileSync('git', ['add', '.'], { cwd: fixture });
execFileSync('git', ['commit', '-qm', 'chore: fixture'], { cwd: fixture });

await expectSuccess(['--version'], output => output.includes(CRG_VERSION), 'exact version');
await expectSuccess(['build', '--repo', fixture], null, 'fixture build');
writeFileSync(join(fixture, 'src', 'math.py'), 'def add(left, right):\n    """Add two values."""\n    return left + right\n');
await expectSuccess(['update', '--repo', fixture, '--skip-flows'], null, 'incremental update');

const invocation = crgInvocation(['serve', '--repo', fixture], root);
const client = new Client({ name: 'ctxroute-crg-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: invocation.executable,
  args: invocation.args,
  cwd: root,
  stderr: 'pipe',
  env: { ...process.env, UV_PROJECT_ENVIRONMENT: resolve(root, 'packages/code-review-graph/.venv') },
});
let stderr = '';
transport.stderr?.on('data', chunk => { stderr += chunk; });
try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  if (names.length !== CRG_MCP_TOOLS.length || names.some(name => !CRG_MCP_TOOLS.includes(name))) throw new Error(`unexpected CRG tool allowlist: ${names.join(', ')}`);
  if (!names.includes('list_graph_stats_tool')) throw new Error('official read tool list_graph_stats_tool is missing');
  const response = await client.callTool({ name: 'list_graph_stats_tool', arguments: { repo_root: fixture } });
  if (response.isError) throw new Error(`read tool failed: ${JSON.stringify(response.content)}`);
  console.log(JSON.stringify({ ok: true, version: CRG_VERSION, tools: names.length, readTool: 'list_graph_stats_tool' }));
} catch (error) {
  throw new Error(`${error.message}${stderr ? `\nMCP stderr:\n${stderr.slice(0, 2000)}` : ''}`);
} finally {
  await client.close();
}

async function expectSuccess(args, predicate, label) {
  const result = await runCrgCommand({ root, args, timeoutMs: 30_000 });
  if (result.code !== 0 || result.timedOut || (predicate && !predicate(result.stdout + result.stderr))) {
    throw new Error(`${label} failed: ${result.stderr || result.stdout || `exit ${result.code}`}`);
  }
}
