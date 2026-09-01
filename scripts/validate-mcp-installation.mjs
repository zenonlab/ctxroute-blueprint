import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTEXT_TOOL_NAMES } from './context-mcp.mjs';
import { PROGRESS_TOOL_NAMES } from './progress-mcp.mjs';

export function validateMcpInstallation(root = process.cwd()) {
  const errors = [];
  const expected = {
    'ctxroute-progress': 'progress:mcp',
    'ctxroute-context-ast': 'context:mcp',
  };
  let claude = {};
  let codex = '';
  try { claude = JSON.parse(readFileSync(resolve(root, '.mcp.json'), 'utf8')).mcpServers ?? {}; }
  catch (error) { errors.push(`Claude MCP manifest is invalid: ${error.message}`); }
  try { codex = readFileSync(resolve(root, '.codex/config.toml'), 'utf8'); }
  catch (error) { errors.push(`Codex MCP manifest is invalid: ${error.message}`); }
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
  }
  const overlap = CONTEXT_TOOL_NAMES.filter(name => PROGRESS_TOOL_NAMES.includes(name));
  if (overlap.length) errors.push(`Progress and Context MCP tools overlap: ${overlap.join(', ')}.`);
  if (CONTEXT_TOOL_NAMES.some(name => name.startsWith('progress_')) || PROGRESS_TOOL_NAMES.some(name => !name.startsWith('progress_'))) errors.push('MCP tool responsibilities are mixed.');
  return { ok: errors.length === 0, servers: Object.keys(expected), progressTools: [...PROGRESS_TOOL_NAMES].sort(), contextTools: [...CONTEXT_TOOL_NAMES].sort(), errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateMcpInstallation();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
