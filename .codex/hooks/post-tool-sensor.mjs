import { extractPaths } from './path-extraction.mjs';
import { analyzePaths } from '../../.githooks/sensor-engine.mjs';
import process from 'node:process';

const input = JSON.parse(await stdin());
const paths = extractPaths(input.tool_input ?? input);
const sourceLike = /\.(?:c|cc|cpp|cs|css|go|html?|java|js|jsx|mjs|php|py|rb|rs|sass|scss|sql|swift|ts|tsx|vue)$/iu;
const supported = paths.filter(path => sourceLike.test(path));
if (supported.length) {
  const result = analyzePaths(supported);
  const serialized = JSON.stringify(result);
  const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `PostToolUse Sensor diagnostics:\n${serialized}` } };
  if (result.verdict === 'UNSAFE' || result.verdict === 'ERROR') { output.decision = 'block'; output.reason = `PostToolUse Sensor ${result.verdict}: ${result.diagnostics.map(item => `${item.path}:${item.line} ${item.rule}`).join(', ')}`; }
  process.stdout.write(JSON.stringify(output));
}

function stdin() { return new Promise(resolve => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; }); process.stdin.on('end', () => resolve(value || '{}')); }); }
