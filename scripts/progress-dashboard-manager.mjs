import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, mkdir, open, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestLocal = globalThis.fetch;
const AbortSignal = globalThis.AbortSignal;
export const DASHBOARD_STATE_PATH = '.ctxroute/state/progress-dashboard.json';

export async function openProgressDashboard(root = process.cwd(), options = {}) {
  const statePath = resolve(root, options.statePath ?? DASHBOARD_STATE_PATH);
  const existing = await readState(statePath);
  if (existing && existing.root === resolve(root) && await isLive(existing)) return publicResult(existing, true);
  const token = randomBytes(32).toString('base64url');
  const instanceId = randomUUID();
  const environment = { ...process.env, PROGRESS_DASHBOARD_TOKEN: token, PROGRESS_DASHBOARD_INSTANCE_ID: instanceId, PROGRESS_DASHBOARD_STATE_PATH: statePath };
  if (options.idleMs) environment.PROGRESS_DASHBOARD_IDLE_MS = String(options.idleMs);
  const child = spawn(process.execPath, [join(moduleRoot, 'scripts', 'progress-dashboard.mjs'), resolve(root)], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: environment,
  });
  child.unref();
  const deadline = Date.now() + (options.startupTimeoutMs ?? 3_000);
  while (Date.now() < deadline) {
    const state = await readState(statePath);
    if (state?.instanceId === instanceId && await isLive(state)) return publicResult(state, false);
    await delay(25);
  }
  throw new Error('Progress dashboard did not become ready');
}

export async function dashboardSessionNotice(sessionId, root = process.cwd(), options = {}) {
  if (!sessionId || sessionId !== String(sessionId)) return null;
  const dashboard = await openProgressDashboard(root, options);
  const digest = createHash('sha256').update(sessionId).digest('hex');
  const markerPath = resolve(root, '.ctxroute', 'state', `progress-dashboard-session-${digest}.json`);
  const marker = await readState(markerPath);
  if (marker?.instanceId === dashboard.instanceId) return null;
  await atomicJson(markerPath, { schemaVersion: 1, instanceId: dashboard.instanceId, presentedAt: new Date().toISOString() });
  return dashboard;
}

async function isLive(state) {
  if (!Number.isSafeInteger(state.pid) || state.pid <= 0 || !state.url || !state.instanceId) return false;
  try { process.kill(state.pid, 0); } catch { return false; }
  try {
    const stored = new URL(state.url);
    const port = Number(stored.port);
    if (stored.protocol !== 'http:' || stored.hostname !== 'localhost' || !Number.isInteger(port) || port < 1 || port > 65_535) return false;
    const response = await requestLocal(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(400) });
    const value = await response.json();
    return response.ok && value.instanceId === state.instanceId;
  } catch { return false; }
}
async function readState(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
async function atomicJson(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.${Date.now()}.tmp`; const handle = await open(temporary, 'wx', 0o600); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await handle.close(); } await rename(temporary, path); }
function publicResult(state, reused) { return { url: state.url, reused, instanceId: state.instanceId }; }
function delay(ms) { return new Promise(resolveDelay => { setTimeout(resolveDelay, ms); }); }
