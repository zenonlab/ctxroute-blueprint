import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Script } from 'node:vm';
import { approvePlan } from '../scripts/progress-core.mjs';
import { DASHBOARD_BODY_LIMIT, startProgressDashboard } from '../scripts/progress-dashboard.mjs';
import { dashboardSessionNotice, openProgressDashboard } from '../scripts/progress-dashboard-manager.mjs';
import { DASHBOARD_JS } from '../scripts/progress-dashboard-app.mjs';

const requestLocal = globalThis.fetch;
new Script(DASHBOARD_JS);
const makePlan = (goalId = 'goal-one') => ({ goalId, title: 'Ship safely', validationEvidence: ['npm test'], steps: [{ id: 'step-one', title: 'Verify', acceptance: ['Tests pass'], files: ['tests/progress-dashboard.test.mjs'], commands: ['npm test'] }] });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'progress-dashboard-'));
  await approvePlan({ ...makePlan(), approved: true }, root);
  const dashboard = await startProgressDashboard({ root, idleMs: 60_000 });
  const base = new URL(dashboard.url); base.hash = '';
  const headers = { 'X-Progress-Token': dashboard.token, Origin: base.origin, 'Content-Type': 'application/json' };
  return { ...dashboard, root, base: base.href.replace(/\/$/u, ''), headers };
}

test('dashboard serves only local static resources with restrictive headers', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  assert.ok(['::1', '127.0.0.1'].includes(app.server.address().address));
  const page = await requestLocal(`${app.base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/u);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /Afficher les objectifs terminés/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-labelledby="plan-title"/u);
  assert.doesNotMatch(html, new RegExp(app.token, 'u'));
  assert.match(await (await requestLocal(`${app.base}/app.js`)).text(), /confirm\(/u);
  assert.equal((await requestLocal(`${app.base}/remote.js`)).status, 404);
});

test('API requires its token, local origin, and valid Host', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: { Origin: new URL(app.base).origin } })).status, 401);
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: { ...app.headers, Origin: 'https://example.test' } })).status, 403);
  assert.equal(await requestStatus(app.base, { ...app.headers, Host: 'example.test' }), 403);
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).status, 200);
});

function requestStatus(base, headers) {
  const target = new URL(base);
  return new Promise((resolveStatus, reject) => {
    const outgoing = request({ hostname: target.hostname, port: target.port, path: '/api/progress', headers }, response => { response.resume(); response.on('end', () => resolveStatus(response.statusCode)); });
    outgoing.on('error', reject); outgoing.end();
  });
}

test('API validates and approves plans through progress-core', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  const first = await (await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).json();
  const plan = makePlan('goal-two');
  const validation = await requestLocal(`${app.base}/api/plans/validate`, { method: 'POST', headers: app.headers, body: JSON.stringify({ revision: first.revision, plan }) });
  assert.equal(validation.status, 200);
  assert.equal((await validation.json()).validation.ok, true);
  const approval = await requestLocal(`${app.base}/api/plans/approve`, { method: 'POST', headers: app.headers, body: JSON.stringify({ revision: first.revision, plan: { ...plan, approved: true } }) });
  assert.equal(approval.status, 200);
  const value = await approval.json();
  assert.deepEqual(value.progress.goals.map(goal => goal.id), ['goal-one', 'goal-two']);
  assert.equal(value.progress.goals[0].steps[0].title, 'Verify');
});

test('API updates only mutable step and mode fields and rejects stale revisions', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  const first = await (await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).json();
  const step = await requestLocal(`${app.base}/api/goals/goal-one/steps/step-one`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, status: 'DONE', evidence: ['node --test tests/progress-dashboard.test.mjs'] }) });
  assert.equal(step.status, 200);
  const changed = await step.json();
  assert.equal(changed.progress.goals[0].steps[0].title, 'Verify');
  assert.deepEqual(changed.progress.goals[0].steps[0].acceptance, ['Tests pass']);
  const stale = await requestLocal(`${app.base}/api/goals/goal-one/mode`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, mode: 'autonomous', userConfirmed: true }) });
  assert.equal(stale.status, 409);
  const mode = await requestLocal(`${app.base}/api/goals/goal-one/mode`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: changed.revision, mode: 'autonomous', userConfirmed: true }) });
  assert.equal(mode.status, 200);
  assert.equal((await mode.json()).progress.goals[0].executionMode, 'autonomous');
});

test('API bounds JSON bodies and idle expiry closes the local server', async () => {
  const app = await fixture();
  const oversized = await requestLocal(`${app.base}/api/plans/validate`, { method: 'POST', headers: app.headers, body: JSON.stringify({ value: 'x'.repeat(DASHBOARD_BODY_LIMIT) }) });
  assert.equal(oversized.status, 413);
  app.server.close();
  const root = mkdtempSync(join(tmpdir(), 'progress-dashboard-idle-'));
  let resolveIdle;
  const closed = new Promise(resolve => { resolveIdle = resolve; });
  await startProgressDashboard({ root, idleMs: 20, onIdle: server => server.close(resolveIdle) });
  await closed;
});

test('detached dashboard instances are reused and replaced after death', async t => {
  const root = mkdtempSync(join(tmpdir(), 'progress-dashboard-manager-'));
  const first = await openProgressDashboard(root, { idleMs: 5_000 });
  let pid = JSON.parse(readFileSync(join(root, '.ctxroute/state/progress-dashboard.json'), 'utf8')).pid;
  t.after(() => { try { process.kill(pid, 'SIGTERM'); } catch {} });
  assert.equal(first.reused, false);
  const second = await openProgressDashboard(root, { idleMs: 5_000 });
  assert.equal(second.reused, true);
  assert.equal(second.instanceId, first.instanceId);
  assert.ok(await dashboardSessionNotice('session-one', root, { idleMs: 5_000 }));
  assert.equal(await dashboardSessionNotice('session-one', root, { idleMs: 5_000 }), null);
  assert.ok(await dashboardSessionNotice('session-two', root, { idleMs: 5_000 }));
  process.kill(pid, 'SIGTERM');
  await new Promise(resolve => { setTimeout(resolve, 80); });
  const third = await openProgressDashboard(root, { idleMs: 5_000 });
  pid = JSON.parse(readFileSync(join(root, '.ctxroute/state/progress-dashboard.json'), 'utf8')).pid;
  assert.equal(third.reused, false);
  assert.notEqual(third.instanceId, first.instanceId);
  assert.equal((await dashboardSessionNotice('session-one', root, { idleMs: 5_000 })).instanceId, third.instanceId);
});
