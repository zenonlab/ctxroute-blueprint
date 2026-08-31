import { extractPathEntries } from './path-extraction.mjs';
import { analyzePaths, SENSOR_ADAPTERS } from '../../.githooks/sensor-engine.mjs';
import process from 'node:process';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const input = await parseInput();
if (input) {
  const sourceLike = new Set(SENSOR_ADAPTERS.flatMap(adapter => adapter.extensions));
  const deletion = /\b(?:delete|remove|unlink)\b/iu.test(String(input.tool_name ?? ''));
  const entries = extractPathEntries(input.tool_input ?? input);
  const supported = entries
    .filter(({ path, key }) => sourceLike.has(extname(path).toLowerCase()) && key !== 'old_path')
    .filter(({ path }) => path !== '.project/sensor-rules.json')
    .filter(({ path }) => !deletion || existsSync(resolve(process.cwd(), path)))
    .map(({ path }) => path);
  if (supported.length) {
    const result = analyzePaths(supported);
    const serialized = JSON.stringify(result);
    const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `PostToolUse Sensor diagnostics:\n${serialized}` } };
    if (result.verdict === 'UNSAFE' || result.verdict === 'ERROR') { output.decision = 'block'; output.reason = `PostToolUse Sensor ${result.verdict}: ${result.diagnostics.map(item => `${item.path}:${item.line} ${item.rule}`).join(', ')}`; }
    process.stdout.write(JSON.stringify(output));
  }
}

async function parseInput() {
  const raw = await stdin();
  try { return JSON.parse(raw); }
  catch (error) { process.stdout.write(JSON.stringify({ systemMessage: `PostToolUse Sensor failed open: invalid JSON input (${error.message})` })); return null; }
}

function stdin() { return new Promise(resolve => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; }); process.stdin.on('end', () => resolve(value || '{}')); }); }
