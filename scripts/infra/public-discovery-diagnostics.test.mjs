import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { collectDiscoveryDiagnostics, discoveryDiagnosticQueries, executeDiagnosticQuery } from './public-discovery-diagnostics.mjs';

const now = '2026-09-23T12:00:00.000Z';
const environment = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-test-token' };

test('diagnostics distinguish actual age from retry deadline and group media', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE public_discovery_requests_v3 (
      media_kind TEXT, state TEXT, failure_reason TEXT, queue_signal_state TEXT,
      created_at TEXT, retry_at TEXT)`);
    const insert = db.prepare('INSERT INTO public_discovery_requests_v3 VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('ANIME', 'PENDING', null, 'SENT', '2026-09-23T09:00:00.000Z', '2026-09-23T11:59:59.000Z');
    insert.run('MANGA', 'PENDING', null, 'UNSENT', '2026-09-23T11:50:00.000Z', '2026-09-23T12:30:00.000Z');
    insert.run('MANGA', 'PENDING', null, 'SENT', '2026-09-23T11:40:00.000Z', now);
    insert.run('ANIME', 'FAILED', 'ATTEMPT_LIMIT', 'SENT', now, now);
    const report = collectDiscoveryDiagnostics({ now, query: sql => ({ rows: db.prepare(sql).all(), meta: { rows_read: 4, rows_written: 0 } }) });
    assert.equal(report.ok, true);
    const rows = name => JSON.parse(JSON.stringify(report.d1[name].rows));
    assert.deepEqual(rows('pendingAges'), [
      { media: 'ANIME', age: '>60m', requests: 1 },
      { media: 'MANGA', age: '0-15m', requests: 1 },
      { media: 'MANGA', age: '15-60m', requests: 1 },
    ]);
    assert.deepEqual(rows('pendingDeadlines'), [
      { media: 'ANIME', deadline: 'due', requests: 1 },
      { media: 'MANGA', deadline: '15-60m', requests: 1 },
      { media: 'MANGA', deadline: 'due', requests: 1 },
    ]);
    assert.ok(rows('reasons').some(row => row.media === 'ANIME' && row.reason === 'ATTEMPT_LIMIT' && row.requests === 1));
    assert.equal(report.d1.reasons.rowsRead, 4);
    assert.equal(report.d1.reasons.rowsWritten, 0);
    assert.equal(report.queryCostScope, 'these-diagnostic-queries-only');
  } finally { db.close(); }
});

test('missing D1 diagnostics fail closed without exposing errors or private rows', () => {
  const report = collectDiscoveryDiagnostics({ now, query: sql => {
    if (sql.includes('failure_reason')) throw new Error('secret-from-provider');
    if (sql.includes('queue_signal_state')) return { rows: [{ title: 'private-title', url: 'https://private.invalid' }] };
    return { rows: [], meta: null };
  } });
  assert.equal(report.ok, false);
  assert.equal(report.d1.reasons, undefined);
  assert.equal(report.d1.signals, undefined);
  assert.ok(report.unavailable.includes('d1-reasons'));
  assert.ok(report.unavailable.includes('d1-signals'));
  assert.doesNotMatch(JSON.stringify(report), /secret-from-provider|private-title|private\.invalid/u);
  assert.throws(() => discoveryDiagnosticQueries("2026-09-23'; DROP TABLE x; --"));
});

test('diagnostic subprocess is pinned, read-only, bounded and does not persist raw logs', () => {
  const command = discoveryDiagnosticQueries(now).reasons;
  let calls = 0;
  const result = executeDiagnosticQuery(command, { environment: { ...environment, WRANGLER_OUTPUT_FILE_PATH: 'private-path', WRANGLER_OUTPUT_FILE_DIRECTORY: 'private-directory' }, run: (executable, args, options) => {
    calls += 1;
    assert.equal(executable, process.execPath);
    assert.match(args[1], /wrangler[/\\]wrangler-dist[/\\]cli\.js$/u);
    assert.deepEqual(args.slice(2), ['d1', 'execute', 'tobirink-public', '--remote', '--config', 'apps/worker/wrangler.jsonc', '--json', '--command', command]);
    assert.equal(options.timeout, 15_000);
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.maxBuffer, 1024 * 1024);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    assert.equal(options.env.CLOUDFLARE_ACCOUNT_ID, environment.CLOUDFLARE_ACCOUNT_ID);
    assert.equal(options.env.CLOUDFLARE_API_TOKEN, environment.CLOUDFLARE_API_TOKEN);
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    assert.equal(options.env.WRANGLER_LOG_SANITIZE, 'true');
    assert.equal(options.env.WRANGLER_SEND_ERROR_REPORTS, 'false');
    assert.equal(options.env.WRANGLER_OUTPUT_FILE_PATH, undefined);
    assert.equal(options.env.WRANGLER_OUTPUT_FILE_DIRECTORY, undefined);
    return { status: 0, stdout: JSON.stringify([{ success: true, results: [], meta: { rows_read: 1, rows_written: 0 } }]) };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { rows: [], meta: { rows_read: 1, rows_written: 0 } });
});

test('diagnostics refuse absent or invalid accounts before invoking Wrangler', () => {
  for (const [account, expected] of [[undefined, 'account-missing'], ['', 'account-missing'], ['private-invalid-account', 'account-invalid']]) {
    let calls = 0;
    const report = collectDiscoveryDiagnostics({ now, query: command => executeDiagnosticQuery(command, {
      environment: { CLOUDFLARE_ACCOUNT_ID: account }, run: () => { calls += 1; },
    }) });
    assert.equal(calls, 0);
    assert.equal(report.ok, false);
    assert.deepEqual(report.failures.map(failure => failure.code), Array(4).fill(expected));
    assert.doesNotMatch(JSON.stringify(report), /private-invalid-account/u);
  }
});

test('diagnostics classify command failures without exposing stdout, stderr or secrets', () => {
  const cases = [
    [{ status: 1, stderr: 'private-secret GET /accounts failed [code: 9109]' }, 'access-denied'],
    [{ status: 1, stderr: 'private-secret Authentication error [code: 10000]' }, 'authentication-failed'],
    [{ status: null, error: { code: 'ETIMEDOUT', message: 'private-secret' } }, 'timeout'],
    [{ status: null, error: { code: 'ENOBUFS', message: 'private-secret' } }, 'output-limit'],
    [{ status: null, error: { code: 'ENOENT', message: 'private-secret' } }, 'command-unavailable'],
    [{ status: 1, stderr: 'private-secret fetch failed ECONNRESET' }, 'transport-failed'],
    [{ status: 1, stderr: 'private-secret unknown error', stdout: 'private-query' }, 'query-failed'],
    [{ status: 0, stdout: 'private-invalid-json' }, 'response-invalid'],
    [{ status: 0, stdout: JSON.stringify([{ success: false, results: [] }]) }, 'response-invalid'],
    [{ status: 0, stdout: JSON.stringify({ success: true, results: 'private-result' }) }, 'response-invalid'],
  ];
  for (const [result, expected] of cases) {
    const report = collectDiscoveryDiagnostics({ now, query: command => executeDiagnosticQuery(command, { environment, run: () => result }) });
    assert.equal(report.ok, false);
    assert.equal(report.failures.length, 4);
    assert.deepEqual(report.failures.map(failure => failure.code), Array(4).fill(expected));
    assert.deepEqual(report.failures.map(failure => failure.query), Object.keys(discoveryDiagnosticQueries(now)));
    assert.doesNotMatch(JSON.stringify(report), /private-|stderr|stdout|\/accounts/u);
  }
});

test('unexpected failures cannot masquerade as diagnostic codes or leak private text', () => {
  for (const message of ['private-secret', 'timeout private-secret', 'access-denied: private-secret']) {
    const report = collectDiscoveryDiagnostics({ now, query: () => { throw new Error(message); } });
    assert.deepEqual(report.failures.map(failure => failure.code), Array(4).fill('query-failed'));
    assert.doesNotMatch(JSON.stringify(report), /private-secret/u);
  }
  assert.throws(() => executeDiagnosticQuery('SELECT 1', { environment, run: () => { throw new Error('private-spawn-error'); } }), /^Error: query-failed$/u);
});
