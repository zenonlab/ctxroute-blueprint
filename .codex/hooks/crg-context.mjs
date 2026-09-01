import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCrgCommand, runCrgUpdate } from '../../scripts/crg-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = existsSync(resolve(root, '.code-review-graph/graph.db'))
  ? await runCrgCommand({ root, args: ['status', '--repo', root] }).catch(error => ({ code: 1, stderr: error.message }))
  : await runCrgUpdate({ root }).catch(error => ({ code: 1, stderr: error.message }));

const healthy = result.code === 0 && !result.timedOut;
const context = healthy
  ? 'Use code-review-graph MCP for structural code context and impact analysis. Keep Tree-sitter Sensor checks for security validation.'
  : 'code-review-graph is unavailable; continue fail-open and report this diagnostic if graph context is needed.';
const output = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
if (!healthy) output.systemMessage = `CRG SessionStart failed open: ${diagnostic(result)}`;
process.stdout.write(JSON.stringify(output));

function diagnostic(value) {
  return String(value.stderr || value.stdout || `exit ${value.code}`).trim().slice(0, 500);
}
