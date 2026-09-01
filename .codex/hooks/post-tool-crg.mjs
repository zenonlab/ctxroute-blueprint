import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCrgUpdate } from '../../scripts/crg-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function shouldUpdate(input) {
  return successful(input) && isWrite(input);
}

function successful(value) {
  const response = value.tool_response ?? value.tool_result ?? {};
  return value.is_error !== true && response.isError !== true && response.is_error !== true && !response.error;
}

function isWrite(value) {
  const name = String(value.tool_name ?? '');
  const command = typeof value.tool_input?.cmd === 'string' ? value.tool_input.cmd : typeof value.tool_input?.command === 'string' ? value.tool_input.command : '';
  if (/\bnpm\s+run\s+crg:(?:build|update|status|review|mcp|smoke)\b/u.test(command)) return false;
  return /^(?:apply_patch|Edit|Write|exec_command|Bash|Shell)$/iu.test(name);
}

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input;
  try { input = JSON.parse(await stdin()); }
  catch { process.stdout.write(JSON.stringify({ systemMessage: 'CRG PostToolUse failed open: invalid hook input.' })); process.exit(0); }
  if (shouldUpdate(input)) {
    const result = await runCrgUpdate({ root }).catch(error => ({ code: 1, stderr: error.message }));
    if (result.code !== 0 || result.timedOut) {
      const detail = String(result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500);
      process.stdout.write(JSON.stringify({ systemMessage: `CRG PostToolUse failed open: ${detail}` }));
    }
  }
}
