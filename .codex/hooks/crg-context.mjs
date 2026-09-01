import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCrgCommand, runCrgUpdate } from '../../scripts/crg-runner.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = existsSync(resolve(root, '.code-review-graph/graph.db'))
    ? await runCrgCommand({ root, args: ['status', '--repo', root] }).catch(error => ({ code: 1, stderr: error.message }))
    : await runCrgUpdate({ root }).catch(error => ({ code: 1, stderr: error.message }));
  process.stdout.write(JSON.stringify(sessionStartOutput(result)));
}

export function sessionStartOutput(value) {
  return value.code === 0 && !value.timedOut
    ? { continue: true }
    : { systemMessage: `CRG SessionStart failed open: ${diagnostic(value).slice(0, 400)}` };
}

function diagnostic(value) {
  return String(value.stderr || value.stdout || `exit ${value.code}`).trim().slice(0, 500);
}
