import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { approvePlan } from '../scripts/progress-core.mjs';
import { DASHBOARD_BODY_LIMIT, startProgressDashboard } from '../scripts/progress-dashboard.mjs';
import { dashboardSessionNotice, openProgressDashboard } from '../scripts/progress-dashboard-manager.mjs';
import { request } from '../scripts/progress-dashboard-client.js';

const requestLocal = globalThis.fetch;
const makePlan = (goalId = 'goal-one') => ({ goalId, title: 'Ship safely', validationEvidence: ['npm test'], steps: [{ id: 'step-one', title: 'Verify', acceptance: ['Tests pass'], files: ['tests/progress-dashboard.test.mjs'], commands: ['npm test'] }] });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'progress-dashboard-'));
  await approvePlan({ ...makePlan(), approved: true }, root);
  const dashboard = await startProgressDashboard({ root, idleMs: 60_000 });
  const base = new URL(dashboard.url); base.hash = '';
  const headers = { 'X-Progress-Token': dashboard.token, Origin: base.origin, 'Content-Type': 'application/json' };
  return { ...dashboard, root, base: base.href.replace(/\/$/u, ''), headers };
}

test('client request injects authentication and returns decoded JSON', async () => {
  const originalFetch = globalThis.fetch;
  let received;
  globalThis.fetch = async (path, options) => {
    received = { path, options };
    return { ok: true, status: 200, json: async () => ({ progress: { goals: [] }, revision: 'r1' }) };
  };
  try {
    assert.equal((await request('/api/progress')).revision, 'r1');
    assert.equal(received.path, '/api/progress');
    assert.equal(received.options.headers['Content-Type'], 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('dashboard serves only local static resources with restrictive headers', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  assert.ok(['::1', '127.0.0.1'].includes(app.server.address().address));
  const page = await requestLocal(`${app.base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/u);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /goals terminés/u);
  assert.match(html, /aria-live="polite"/u);
  assert.match(html, /aria-labelledby="plan-title"/u);
  assert.doesNotMatch(html, new RegExp(app.token, 'u'));
  const javascript = await (await requestLocal(`${app.base}/app.js`)).text();
  assert.match(javascript, /setTimeout\(\(\) => saveCard\(card\), 500\)/u);
  assert.match(javascript, /retainView\(await request/u);
  assert.match(javascript, /setSaveState\(card, 'Enregistré'\)/u);
  assert.match(javascript, /reloadPreservingDrafts/u);
  assert.match(javascript, /dataTransfer\.effectAllowed/u);
  assert.match(javascript, /target\.after\(dragged\)/u);
  assert.match(javascript, /Tous les goals sont terminés/u);
  assert.match(javascript, /setGoalOpen/u);
  assert.match(javascript, /data-show-completed/u);
  assert.doesNotMatch(javascript, /\b(?:prompt|confirm)\(/u);
  assert.match(html, /id="confirm-dialog"/u);
  assert.match(html, /class="switch"/u);
  assert.doesNotMatch(html, /<style|<script(?:\s|>)(?![^>]*src=)/u);
  const css = await (await requestLocal(`${app.base}/styles.css`)).text();
  assert.match(css, /resize:none/u);
  assert.match(css, /\.toast\[hidden\]\{display:none\}/u);
  assert.match(css, /border-right:2px solid currentColor/u);
  assert.match(html, /Afficher les goals terminés/u);
  assert.match(html, />Restaurer<\/button>/u);
  assert.equal((await requestLocal(`${app.base}/remote.js`)).status, 404);
});

test('API requires its token, local origin, and valid Host', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: { Origin: new URL(app.base).origin } })).status, 401);
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: { ...app.headers, Origin: 'https://example.test' } })).status, 403);
  const target = new URL(app.base);
  const invalidHostStatus = await new Promise((resolveStatus, reject) => {
    const outgoing = httpRequest({ hostname: target.hostname, port: target.port, path: '/api/progress', headers: { ...app.headers, Host: 'example.test' } }, response => { response.resume(); response.on('end', () => resolveStatus(response.statusCode)); });
    outgoing.on('error', reject); outgoing.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).status, 200);
});

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

test('API updates editable goal and step fields and rejects stale revisions', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  const first = await (await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).json();
  const goal = await requestLocal(`${app.base}/api/goals/goal-one`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, title: 'Ship clearly' }) });
  assert.equal(goal.status, 200);
  const renamed = await goal.json();
  const step = await requestLocal(`${app.base}/api/goals/goal-one/steps/step-one`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: renamed.revision, title: 'Verify all', acceptance: ['Tests and lint pass'], files: ['tests/progress-dashboard.test.mjs'], commands: ['node --test tests/progress-dashboard.test.mjs'], status: 'DONE', evidence: ['node --test tests/progress-dashboard.test.mjs'] }) });
  assert.equal(step.status, 200);
  const changed = await step.json();
  assert.equal(changed.progress.goals[0].title, 'Ship clearly');
  assert.equal(changed.progress.goals[0].steps[0].title, 'Verify all');
  assert.deepEqual(changed.progress.goals[0].steps[0].acceptance, ['Tests and lint pass']);
  const stale = await requestLocal(`${app.base}/api/goals/goal-one/mode`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, mode: 'autonomous', userConfirmed: true }) });
  assert.equal(stale.status, 409);
  const mode = await requestLocal(`${app.base}/api/goals/goal-one/mode`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: changed.revision, mode: 'autonomous', userConfirmed: true }) });
  assert.equal(mode.status, 200);
  assert.equal((await mode.json()).progress.goals[0].executionMode, 'autonomous');
});

test('API adds, exactly reorders, deletes, and protects the last step', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  const first = await (await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).json();
  const addition = await requestLocal(`${app.base}/api/goals/goal-one/steps`, { method: 'POST', headers: app.headers, body: JSON.stringify({ revision: first.revision, step: { id: 'step-two', title: 'Document', acceptance: ['Docs align'], files: ['docs/progress.md'], commands: ['npm run validate'] } }) });
  assert.equal(addition.status, 200);
  const added = await addition.json();
  const order = await requestLocal(`${app.base}/api/goals/goal-one/steps/order`, { method: 'PUT', headers: app.headers, body: JSON.stringify({ revision: added.revision, stepIds: ['step-two', 'step-one'] }) });
  assert.equal(order.status, 200);
  const ordered = await order.json();
  assert.deepEqual(ordered.progress.goals[0].steps.map(step => step.id), ['step-two', 'step-one']);
  const deletion = await requestLocal(`${app.base}/api/goals/goal-one/steps/step-one`, { method: 'DELETE', headers: app.headers, body: JSON.stringify({ revision: ordered.revision }) });
  assert.equal(deletion.status, 200);
  const deleted = await deletion.json();
  const last = await requestLocal(`${app.base}/api/goals/goal-one/steps/step-two`, { method: 'DELETE', headers: app.headers, body: JSON.stringify({ revision: deleted.revision }) });
  assert.equal(last.status, 400);
  assert.match((await last.json()).error, /last step/u);
});

test('new mutation routes retain token, origin, body, and revision protections', async t => {
  const app = await fixture(); t.after(() => app.server.close());
  const first = await (await requestLocal(`${app.base}/api/progress`, { headers: app.headers })).json();
  const withoutToken = await requestLocal(`${app.base}/api/goals/goal-one`, { method: 'PATCH', headers: { Origin: new URL(app.base).origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: first.revision, title: 'No' }) });
  assert.equal(withoutToken.status, 401);
  const foreign = await requestLocal(`${app.base}/api/goals/goal-one`, { method: 'PATCH', headers: { ...app.headers, Origin: 'https://example.test' }, body: JSON.stringify({ revision: first.revision, title: 'No' }) });
  assert.equal(foreign.status, 403);
  const oversized = await requestLocal(`${app.base}/api/goals/goal-one`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, title: 'x'.repeat(DASHBOARD_BODY_LIMIT) }) });
  assert.equal(oversized.status, 413);
  const changed = await requestLocal(`${app.base}/api/goals/goal-one`, { method: 'PATCH', headers: app.headers, body: JSON.stringify({ revision: first.revision, title: 'Changed' }) });
  assert.equal(changed.status, 200);
  const stale = await requestLocal(`${app.base}/api/goals/goal-one/steps`, { method: 'POST', headers: app.headers, body: JSON.stringify({ revision: first.revision, step: { id: 'stale', title: 'Stale', acceptance: ['ok'], files: [], commands: [] } }) });
  assert.equal(stale.status, 409);
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

test('detached dashboard instances are reused and replaced after death', async () => {
  const root = mkdtempSync(join(tmpdir(), 'progress-dashboard-manager-'));
  const first = await openProgressDashboard(root, { idleMs: 5_000 });
  let pid = JSON.parse(readFileSync(join(root, '.ctxroute/state/progress-dashboard.json'), 'utf8')).pid;
  try {
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
  } finally {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
});
