import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { submitWorkerReport } from '../../scripts/orchestrator-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function restituteWorker(reportPath = process.env.CTXROUTE_WORKER_REPORT, projectRoot = root) {
  if (!reportPath) return null;
  const absolute = resolve(projectRoot, reportPath);
  const local = relative(projectRoot, absolute).replaceAll('\\', '/');
  if (isAbsolute(local) || local.startsWith('../') || !local.startsWith('.ctxroute/reports/')) throw new Error('worker report path must be under .ctxroute/reports/');
  const transaction = JSON.parse(await readFile(absolute, 'utf8'));
  const result = await submitWorkerReport(transaction, projectRoot);
  return { systemMessage: `Worker report recorded at orchestrator revision ${result.state.revision}.` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  restituteWorker().then(output => { if (output) process.stdout.write(JSON.stringify(output)); }).catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Worker restitution failed open: ${error.message}` })));
}
