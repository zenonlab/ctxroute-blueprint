import { extractPathEntries } from './path-extraction.mjs';
import { analyzePaths, isSupportedSourcePath } from '../../.githooks/sensor-engine.mjs';
import process from 'node:process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const input = await parseInput();
if (input) {
  const deletion = /\b(?:delete|remove|unlink)\b/iu.test(String(input.tool_name ?? ''));
  const entries = extractPathEntries(input.tool_input ?? input);
  const supported = entries
    .filter(({ path, key }) => isSupportedSourcePath(path) && key !== 'old_path')
    .filter(({ path }) => path !== '.project/sensor-rules.json')
    .filter(({ path }) => !deletion || existsSync(resolve(process.cwd(), path)))
    .map(({ path }) => path);
  if (supported.length) {
    const result = analyzePaths(supported);
    if (result.verdict !== 'SAFE') {
      const details = result.diagnostics.slice(0, 5).map(item => `${item.path}:${item.line} ${item.rule}`).join(', ');
      const summary = JSON.stringify({ verdict: result.verdict, coverage: result.coverage, diagnostics: result.diagnostics.slice(0, 5) });
      const repair = result.verdict === 'UNSAFE' || result.verdict === 'ERROR' ? ' The change already exists: inspect and repair the current file; do not replay the patch.' : '';
      const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `Sensor ${result.verdict}: ${result.diagnostics.length} diagnostic(s)${details ? ` — ${details}` : ''}.${repair}\n${summary.slice(0, 3500)}` } };
      process.stdout.write(JSON.stringify(output));
    }
  }
}

async function parseInput() {
  const raw = await stdin();
  try { return JSON.parse(raw); }
  catch (error) { process.stdout.write(JSON.stringify({ systemMessage: `PostToolUse Sensor failed open: invalid JSON input (${error.message})` })); return null; }
}

function stdin() { return new Promise(resolve => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; }); process.stdin.on('end', () => resolve(value || '{}')); }); }
