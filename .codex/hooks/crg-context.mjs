import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCrgCommand, runCrgUpdate } from '../../scripts/crg-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const result = existsSync(resolve(root, '.code-review-graph/graph.db'))
  ? await runCrgCommand({ root, args: ['status', '--repo', root] }).catch(error => ({ code: 1, stderr: error.message }))
  : await runCrgUpdate({ root }).catch(error => ({ code: 1, stderr: error.message }));

const healthy = result.code === 0 && !result.timedOut;
const output = healthy
  ? { continue: true }
  : { systemMessage: `CRG SessionStart failed open: ${diagnostic(result).slice(0, 400)}` };
process.stdout.write(JSON.stringify(output));

function diagnostic(value) {
  return String(value.stderr || value.stdout || `exit ${value.code}`).trim().slice(0, 500);
}
