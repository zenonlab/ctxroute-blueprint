import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCrgUpdate } from '../../scripts/crg-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function shouldUpdate(input) {
  return successful(input) && isWrite(input);
}

export async function isLatestMaintenanceRequest({ root: projectRoot = root, stateDirectory = process.env.CTXROUTE_STATE_DIR || join(projectRoot, '.ctxroute', 'state'), quietMs = 600, token = randomUUID() } = {}) {
  const marker = join(stateDirectory, 'crg-maintenance-request');
  const temporary = `${marker}.${createHash('sha256').update(token).digest('hex')}.tmp`;
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(temporary, token, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, marker);
  await new Promise(resolveWait => { setTimeout(resolveWait, quietMs); });
  return await readFile(marker, 'utf8').catch(() => '') === token;
}

function successful(value) {
  const response = value.tool_response ?? value.tool_result ?? {};
  return value.is_error !== true && response.isError !== true && response.is_error !== true && !response.error;
}

function isWrite(value) {
  const name = String(value.tool_name ?? '');
  return /^(?:apply_patch|Edit|Write)$/iu.test(name);
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
    if (!await isLatestMaintenanceRequest({ root })) {
      process.stdout.write(JSON.stringify({ maintenanceSuperseded: true }));
      process.exit(0);
    }
    const result = await runCrgUpdate({ root }).catch(error => ({ code: 1, stderr: error.message }));
    if (result.code !== 0 || result.timedOut) {
      const detail = String(result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500);
      process.stdout.write(JSON.stringify({ systemMessage: `CRG PostToolUse failed open: ${detail}` }));
    }
  }
}
