import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adminScopedQuery, adminViews, collectAdminSnapshot, executeAdminQuery, parseAdminArguments, readAdminJson, runAdmin, saveAdminSnapshot, validateAdminScope } from './discovery-admin.mjs';

const now = '2026-09-30T16:00:00.000Z';
const key = index => ({ fingerprint: index.toString(16).padStart(64, '0'), mediaKind: 'MANGA', parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' });
const scope = (count = 1) => ({ schemaVersion: 1, entries: Array.from({ length: count }, (_, index) => ({ key: key(index + 1), sourceCount: index === 0 ? 3 : 1 })) });
const diagnostic = { schemaVersion: 1, attempt: 8, observedAt: now, decision: 'attempt-failed',
  correlationId: '00000000-0000-4000-8000-000000000001', workerVersion: '00000000-0000-4000-8000-000000000002',
  cause: { code: 'http', httpStatus: 403, provider: 'anilist', stage: 'search' },
  providerFailures: [{ code: 'http', httpStatus: 403, provider: 'anilist', stage: 'search' }] };

function fixture(column = true) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE public_discovery_requests_v3 (
    fingerprint TEXT, media_kind TEXT, parser_version TEXT, rules_version TEXT,
    state TEXT NOT NULL DEFAULT 'FAILED', attempt_count INTEGER NOT NULL DEFAULT 8,
    refresh_attempt_count INTEGER NOT NULL DEFAULT 0, refresh_state TEXT NOT NULL DEFAULT 'IDLE',
    failure_reason TEXT DEFAULT 'ATTEMPT_LIMIT', queue_signal_state TEXT NOT NULL DEFAULT 'SENT',
    updated_at TEXT, failed_at TEXT, retry_at TEXT, lease_until TEXT, result_expires_at TEXT,
    search_progress_json TEXT, PRIMARY KEY(fingerprint, media_kind, parser_version, rules_version))`);
  if (column) database.exec('ALTER TABLE public_discovery_requests_v3 ADD COLUMN failure_diagnostics_json TEXT');
  const calls = [];
  return { database, calls,
    insert(index) {
      const value = key(index);
      database.prepare(`INSERT INTO public_discovery_requests_v3 (fingerprint, media_kind, parser_version, rules_version, updated_at, failed_at, retry_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(value.fingerprint, value.mediaKind, value.parserVersion, value.siteRulesVersion, now, now, now);
    },
    query(sql) {
      calls.push(sql);
      const rows = database.prepare(sql).all();
      return { rows, meta: { rows_read: rows.length, rows_written: 0, changes: 0, changed_db: false } };
    },
  };
}

test('admin validates complete unique identities, source multiplicity and injection boundaries', () => {
  assert.equal(validateAdminScope(scope()).entries[0].sourceCount, 3);
  const repeated = scope(); repeated.entries.push(repeated.entries[0]);
  assert.throws(() => validateAdminScope(repeated));
  for (const field of ['fingerprint', 'mediaKind', 'parserVersion', 'siteRulesVersion']) {
    const malicious = scope(); malicious.entries[0].key[field] = "x'); DROP TABLE public_discovery_requests_v3;--";
    assert.throws(() => adminScopedQuery(malicious, 0, true));
  }
  assert.throws(() => validateAdminScope(scope(2001)));
  assert.throws(() => validateAdminScope({ ...scope(), title: 'private' }));
  assert.throws(() => adminScopedQuery(scope(), 1, true));
  assert.throws(() => adminScopedQuery(scope(), 0, 'true'));
});

test('admin reads indexed full keys in bounded batches including a partial final batch and missing rows', async () => {
  const local = fixture();
  try {
    for (let index = 1; index <= 52; index += 1) local.insert(index);
    const report = await collectAdminSnapshot(scope(53), { query: local.query, now });
    assert.equal(report.queries, 3);
    assert.equal(report.entries.length, 53);
    assert.equal(report.entries[52].state, 'MISSING');
    assert.equal(adminViews(report).summary.sources, 55);
    assert.equal(adminViews(report).summary.failedSources, 54);
    const plan = local.database.prepare(`EXPLAIN QUERY PLAN SELECT state FROM public_discovery_requests_v3 AS request
      WHERE fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ? LIMIT 1`)
      .all(key(1).fingerprint, 'MANGA', 'parser-v1', 'rules-v1');
    assert.ok(plan.some(row => /SEARCH request USING INDEX sqlite_autoindex_public_discovery_requests_v3_1.*fingerprint=.*media_kind=.*parser_version=.*rules_version=/u.test(row.detail)));
    assert.ok(local.calls.every(sql => !/\b(?:UPDATE|DELETE|INSERT|request_json|result_json)\b/u.test(sql)));
    assert.ok(local.calls.slice(1).every(sql => sql.endsWith('LIMIT 40')));
    const wrongLane = scope(); wrongLane.entries[0].key.mediaKind = 'ANIME';
    assert.equal((await collectAdminSnapshot(wrongLane, { query: local.query, now })).entries[0].state, 'MISSING');
  } finally { local.database.close(); }
});

test('migration absence is an explicit evidence gap, not a failed remote command or success', async () => {
  const local = fixture(false);
  try {
    local.insert(1);
    const report = await collectAdminSnapshot(scope(), { query: local.query, now });
    assert.equal(report.diagnosticColumn, false);
    assert.equal(report.entries[0].evidence, 'migration-missing');
    assert.equal(adminViews(report).summary.failedWithoutRetainedDiagnostics, 1);
    assert.equal(adminViews(report).causes[0].code, 'unknown');
    assert.ok(!local.calls[1].includes('request.failure_diagnostics_json'));
  } finally { local.database.close(); }
});

test('admin preserves valid retained timeline and groups roots separately from fallback evidence', async () => {
  const local = fixture();
  try {
    local.insert(1); local.insert(2);
    const cursor = { ...diagnostic, cause: { code: 'search-cursor', stage: 'resolve' }, providerFailures: undefined };
    local.database.prepare('UPDATE public_discovery_requests_v3 SET failure_diagnostics_json = ? WHERE fingerprint = ?').run(JSON.stringify([diagnostic, cursor]), key(1).fingerprint);
    const report = await collectAdminSnapshot(scope(2), { query: local.query, now });
    const views = adminViews(report);
    assert.equal(views.summary.failedSources, 4);
    assert.equal(views.summary.failedWithRetainedDiagnostics, 1);
    assert.equal(views.summary.failedWithoutRetainedDiagnostics, 1);
    assert.equal(views.causes[0].category, 'recherche-pagination-budget');
    assert.equal(views.causes[0].provider, 'unknown');
    assert.equal(views.providers[0].retainedEvents, 1);
    assert.equal(views.requests[0].diagnostics.length, 2);
    assert.equal(views.versions[0].workerVersion, diagnostic.workerVersion);
    assert.equal(views.limits.completeHistory, false);
    assert.equal(views.limits.atomicityCertified, false);
    assert.equal(views.summary.failedWithoutProviderAttribution, 2);
    assert.equal(views.summary.journalsAtCapacity, 0);
    assert.ok(!JSON.stringify(views).includes(key(1).fingerprint));
  } finally { local.database.close(); }
});

test('malformed and private diagnostics are discarded without silently becoming absent', async () => {
  const local = fixture();
  try {
    local.insert(1);
    for (const raw of ['{bad', JSON.stringify([{ ...diagnostic, privateTitle: 'private-title' }]), JSON.stringify(Array(9).fill(diagnostic)), 'x'.repeat(16_385)]) {
      local.database.prepare('UPDATE public_discovery_requests_v3 SET failure_diagnostics_json = ? WHERE fingerprint = ?').run(raw, key(1).fingerprint);
      const report = await collectAdminSnapshot(scope(), { query: local.query, now });
      assert.equal(report.entries[0].evidence, 'invalid');
      assert.deepEqual(report.entries[0].diagnostics, []);
      assert.ok(!JSON.stringify(report).includes('private-title'));
    }
  } finally { local.database.close(); }
});

test('expired negatives and overdue leases stay distinct from FAILED causes', async () => {
  const local = fixture();
  try {
    local.insert(1); local.insert(2);
    local.database.prepare("UPDATE public_discovery_requests_v3 SET state = 'NOT_FOUND', result_expires_at = ? WHERE fingerprint = ?").run(now, key(1).fingerprint);
    local.database.prepare("UPDATE public_discovery_requests_v3 SET state = 'PROCESSING', lease_until = ? WHERE fingerprint = ?").run('2026-09-30T16:00:00Z', key(2).fingerprint);
    const views = adminViews(await collectAdminSnapshot(scope(2), { query: local.query, now }));
    assert.equal(views.summary.failedIdentities, 0);
    assert.equal(views.causes.length, 0);
    assert.equal(views.states[0].expiredResult, true);
    assert.equal(views.states[1].overdue, true);
  } finally { local.database.close(); }
});

test('read budgets, row correlation and metadata are mandatory and stop collection', async () => {
  for (const meta of [{}, { rows_read: 1000, rows_written: 0, changes: 0 }, { rows_read: 0, rows_written: 1, changes: 1 },
    { rows_read: 0, rows_written: 0, changes: 0, changed_db: true }]) {
    let calls = 0;
    await assert.rejects(collectAdminSnapshot(scope(), { query: () => { calls += 1; return { rows: [], meta }; }, now }), /admin-read-/u);
    assert.equal(calls, 1);
  }
  const local = fixture();
  try {
    await assert.rejects(collectAdminSnapshot(scope(), { now, query: sql => {
      const result = local.query(sql);
      if (sql.startsWith('WITH')) result.rows[0].ordinal = 7;
      return result;
    } }), /row-order/u);
  } finally { local.database.close(); }
});

test('Wrangler adapter uses sanitized existing invocation and never exposes stderr', () => {
  assert.throws(() => executeAdminQuery('SELECT 1', { run: () => ({ status: 1, stderr: 'private-token' }) }), /^Error: admin-d1-read-failed$/u);
  assert.throws(() => executeAdminQuery('SELECT 1', { run: () => ({ status: 0, stdout: 'private-token' }) }), /^Error: admin-d1-response-invalid$/u);
  const result = executeAdminQuery('SELECT 1', { localOAuth: true, run: (command, args, options) => {
    assert.equal(command, process.execPath);
    assert.ok(args.includes('--remote'));
    assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
    assert.equal(options.timeout, 45_000);
    return { status: 0, stdout: JSON.stringify([{ success: true, results: [], meta: { rows_read: 0, rows_written: 0, changes: 0 } }]) };
  } });
  assert.deepEqual(result.rows, []);
});

test('snapshots are exclusive private files; reports and menu are offline and reject injected fields', async () => {
  const local = fixture();
  const directory = await mkdtemp(join(tmpdir(), 'tobirink-admin-test-'));
  try {
    local.insert(1);
    const report = await collectAdminSnapshot(scope(), { query: local.query, now });
    const first = await saveAdminSnapshot(report, directory);
    const second = await saveAdminSnapshot(report, directory);
    assert.notEqual(first, second);
    if (process.platform !== 'win32') {
      assert.equal((await stat(first)).mode & 0o777, 0o600);
      assert.equal((await stat(join(first, '..'))).mode & 0o777, 0o700);
    }
    assert.deepEqual(await readAdminJson(first), report);
    const outputs = [];
    const query = () => { throw new Error('unexpected-network'); };
    await runAdmin(['report', '--report', first, '--view', 'causes'], { output: text => outputs.push(text), query });
    const answers = ['1', '2', '3', '4', '5', '6', '1', '7', '0'];
    await runAdmin(['menu', '--report', first], { output: text => outputs.push(text), query, ask: async () => answers.shift() });
    assert.ok(outputs.some(text => text.includes('cause-inconnue')));
    assert.ok(outputs.some(text => text.includes('atomicityCertified')));
    assert.equal(answers.length, 0);
    const invalid = join(directory, 'invalid.json');
    await writeFile(invalid, JSON.stringify({ ...report, privateTitle: 'private' }));
    await assert.rejects(runAdmin(['report', '--report', invalid], { output: text => outputs.push(text) }));
    assert.ok(!outputs.some(text => text.includes('privateTitle')));
  } finally { local.database.close(); }
});

test('admin has no mutation command, SQL flag, duplicate option or implicit network default', async () => {
  for (const args of [['rearm'], ['snapshot'], ['menu'], ['help', '--scope', 'x'], ['snapshot', '--scope', 'x', '--scope', 'y'],
    ['snapshot', '--scope', 'x', '--sql', 'DELETE'], ['snapshot', '--scope', 'x', '--local-oauth', 'maybe']]) {
    assert.throws(() => parseAdminArguments(args));
  }
  const outputs = [];
  await runAdmin([], { output: text => outputs.push(text), query: () => { throw new Error('unexpected-network'); } });
  assert.ok(outputs[0].includes('lecture seule'));
});
