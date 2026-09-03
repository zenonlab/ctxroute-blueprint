import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rename, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { addProgressStep, approvePlan, deleteProgressStep, progressRevision, readProgress, reorderProgressSteps, setProgressMode, updateProgressGoal, updateProgressStep, validatePlan } from './progress-core.mjs';
import { DASHBOARD_CSS, DASHBOARD_HTML, DASHBOARD_JS } from './progress-dashboard-app.mjs';

export const DASHBOARD_BODY_LIMIT = 32 * 1024;
export const DEFAULT_IDLE_MS = null;
const SECURITY_HEADERS = { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };

export async function startProgressDashboard({ root = process.cwd(), token = randomBytes(32).toString('base64url'), instanceId = randomUUID(), idleMs = DEFAULT_IDLE_MS, statePath, onIdle } = {}) {
  let port = 0; let timer;
  const touch = () => {
    clearTimeout(timer);
    if (!Number.isFinite(idleMs) || idleMs <= 0) return;
    timer = setTimeout(() => onIdle ? onIdle(server) : server.close(), idleMs);
    timer.unref?.();
  };
  const server = createServer(async (request, response) => {
    touch();
    try {
      if (!validHost(request.headers.host, port)) return sendJson(response, 403, { error: 'Hôte local requis' });
      const url = new URL(request.url, `http://localhost:${port}`);
      if (request.method === 'GET' && url.pathname === '/') return send(response, 200, DASHBOARD_HTML, 'text/html; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/app.js') return send(response, 200, DASHBOARD_JS, 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/styles.css') return send(response, 200, DASHBOARD_CSS, 'text/css; charset=utf-8');
      if (request.method === 'GET' && url.pathname === '/health') return sendJson(response, 200, { ok: true, instanceId });
      if (!url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Introuvable' });
      if (request.headers['x-progress-token'] !== token) return sendJson(response, 401, { error: 'Jeton requis' });
      if (!validOrigin(request, port)) return sendJson(response, 403, { error: 'Origine locale requise' });
      if (request.method === 'GET' && url.pathname === '/api/progress') return sendProgress(response, await readProgress(root));
      const body = await readJson(request);
      if (request.method === 'POST' && url.pathname === '/api/plans/validate') {
        const current = await readProgress(root);
        if (body.revision !== progressRevision(current)) return sendJson(response, 409, { error: 'Révision périmée' });
        return sendJson(response, 200, { validation: validatePlan(body.plan, current), revision: progressRevision(current) });
      }
      if (request.method === 'POST' && url.pathname === '/api/plans/approve') return sendProgress(response, await approvePlan(body.plan, root, { expectedRevision: body.revision }));
      const goal = url.pathname.match(/^\/api\/goals\/([a-z][a-z0-9-]{0,63})$/u);
      if (request.method === 'PATCH' && goal) return sendProgress(response, await updateProgressGoal(goal[1], { title: body.title }, root, { expectedRevision: body.revision }));
      const order = url.pathname.match(/^\/api\/goals\/([a-z][a-z0-9-]{0,63})\/steps\/order$/u);
      if (request.method === 'PUT' && order) return sendProgress(response, await reorderProgressSteps(order[1], body.stepIds, root, { expectedRevision: body.revision }));
      const steps = url.pathname.match(/^\/api\/goals\/([a-z][a-z0-9-]{0,63})\/steps$/u);
      if (request.method === 'POST' && steps) return sendProgress(response, await addProgressStep(steps[1], body.step, root, { expectedRevision: body.revision }));
      const step = url.pathname.match(/^\/api\/goals\/([a-z][a-z0-9-]{0,63})\/steps\/([a-z][a-z0-9-]{0,63})$/u);
      if (request.method === 'PATCH' && step) return sendProgress(response, await updateProgressStep({ goalId: step[1], stepId: step[2], status: body.status, title: body.title, acceptance: body.acceptance, files: body.files, commands: body.commands, evidence: body.evidence }, root, { expectedRevision: body.revision }));
      if (request.method === 'DELETE' && step) return sendProgress(response, await deleteProgressStep(step[1], step[2], root, { expectedRevision: body.revision }));
      const mode = url.pathname.match(/^\/api\/goals\/([a-z][a-z0-9-]{0,63})\/mode$/u);
      if (request.method === 'PATCH' && mode) return sendProgress(response, await setProgressMode(mode[1], body.mode, body.userConfirmed, root, { expectedRevision: body.revision }));
      return sendJson(response, 404, { error: 'Introuvable' });
    } catch (error) {
      if (error.code === 'PROGRESS_REVISION_CONFLICT') return sendJson(response, 409, { error: error.message });
      if (error.code === 'BODY_TOO_LARGE') return sendJson(response, 413, { error: error.message });
      if (error instanceof SyntaxError) return sendJson(response, 400, { error: 'Corps JSON invalide' });
      return sendJson(response, 400, { error: String(error.message).slice(0, 500) });
    }
  });
  server.on('close', () => clearTimeout(timer));
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, 'localhost', accept); });
  port = server.address().port;
  touch();
  const url = `http://localhost:${port}/#${encodeURIComponent(token)}`;
  if (statePath) await atomicState(statePath, { schemaVersion: 1, pid: process.pid, url, token, instanceId, root: resolve(root), startedAt: new Date().toISOString() });
  return { server, url, token, instanceId, port };
}

function validHost(host, port) { return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]).has(String(host).toLowerCase()); }
function validOrigin(request, port) {
  const origin = request.headers.origin;
  if (!origin) return request.headers['sec-fetch-site'] === 'same-origin';
  try { const value = new URL(origin); return value.protocol === 'http:' && validHost(value.host, port); } catch { return false; }
}
async function readJson(request) {
  if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new SyntaxError('JSON requis');
  let total = 0; const chunks = [];
  for await (const chunk of request) { total += chunk.length; if (total > DASHBOARD_BODY_LIMIT) { const error = new Error('Corps JSON trop volumineux'); error.code = 'BODY_TOO_LARGE'; throw error; } chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function sendProgress(response, progress) { return sendJson(response, 200, { progress, revision: progressRevision(progress) }); }
function sendJson(response, status, value) { return send(response, status, `${JSON.stringify(value)}\n`, 'application/json; charset=utf-8'); }
function send(response, status, body, type) { response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type }); response.end(body); }
async function atomicState(path, value) { await mkdir(dirname(path), { recursive: true }); const temporary = `${path}.${process.pid}.tmp`; const handle = await open(temporary, 'w', 0o600); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await handle.close(); } await rename(temporary, path); }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const configuredIdleMs = process.env.PROGRESS_DASHBOARD_IDLE_MS;
  await startProgressDashboard({ root, token: process.env.PROGRESS_DASHBOARD_TOKEN, instanceId: process.env.PROGRESS_DASHBOARD_INSTANCE_ID, idleMs: configuredIdleMs === undefined ? DEFAULT_IDLE_MS : Number(configuredIdleMs), statePath: process.env.PROGRESS_DASHBOARD_STATE_PATH });
}
