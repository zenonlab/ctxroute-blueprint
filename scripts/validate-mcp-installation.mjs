import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROGRESS_TOOL_NAMES } from './progress-mcp.mjs';

export function validateMcpInstallation(root = process.cwd()) {
  const errors = [];
  const expected = {
    'ctxroute-progress': 'progress:mcp',
    'code-review-graph': 'crg:mcp',
  };
  let claude = {};
  let codex = '';
  try { claude = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8')).mcpServers ?? {}; }
  catch (error) { errors.push(`Claude MCP manifest is invalid: ${error.message}`); }
  try { codex = readFileSync(resolve(root, '.codex/config.toml'), 'utf8'); }
  catch (error) { errors.push(`Codex MCP manifest is invalid: ${error.message}`); }

  const firstCodexSection = codex.search(/^\[/mu);
  const codexRoot = firstCodexSection < 0 ? codex : codex.slice(0, firstCodexSection);
  if (!/^mcp_optional_startup_grace_ms\s*=\s*1000\s*$/mu.test(codexRoot)) {
    errors.push('Codex must use the 1000 ms optional MCP startup grace when building the initial tool catalog.');
  }

  for (const legacy of ['ctxroute-context-ast']) {
    if (claude[legacy] || codex.includes(`mcp_servers.${legacy}`)) errors.push(`Legacy MCP server ${legacy} must be removed.`);
  }
  if (Object.keys(claude).sort().join(',') !== Object.keys(expected).sort().join(',')) errors.push('Claude must declare exactly ctxroute-progress and code-review-graph.');
  const codexServers = [];
  for (const serverSection of codex.matchAll(/^\[mcp_servers\.([^\]]+)\]$/gmu)) codexServers.push(serverSection[1]);
  codexServers.sort();
  if (codexServers.join(',') !== Object.keys(expected).sort().join(',')) errors.push('Codex must declare exactly ctxroute-progress and code-review-graph.');

  for (const [name, script] of Object.entries(expected)) {
    const item = claude[name];
    if (!item) errors.push(`Claude MCP manifest is missing ${name}.`);
    else {
      if (item.type !== 'stdio' || item.command !== 'npm') errors.push(`Claude ${name} must be an npm stdio server.`);
      if (item.args?.at(-1) !== script || !item.args?.includes('run')) errors.push(`Claude ${name} must run npm run ${script}.`);
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const section = codex.match(new RegExp(`\\[mcp_servers\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'u'))?.[1] ?? '';
    if (!section) errors.push(`Codex MCP manifest is missing ${name}.`);
    else if (!/command\s*=\s*"npm"/u.test(section) || !new RegExp(`args\\s*=\\s*\\["run",\\s*"${script}"\\]`, 'u').test(section)) errors.push(`Codex ${name} must run npm run ${script}.`);
    else if (!/^cwd\s*=\s*"\."\s*$/mu.test(section)) errors.push(`Codex ${name} must run from the repository root with cwd = ".".`);
  }
  if (!PROGRESS_TOOL_NAMES.every(name => name.startsWith('progress_'))) errors.push('Progress MCP responsibilities are mixed.');
  return { ok: errors.length === 0, servers: Object.keys(expected), progressTools: [...PROGRESS_TOOL_NAMES].sort(), contextProvider: 'code-review-graph@2.3.8', errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateMcpInstallation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
