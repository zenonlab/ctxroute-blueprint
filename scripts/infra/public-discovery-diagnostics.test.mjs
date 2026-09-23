import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { collectDiscoveryDiagnostics, discoveryDiagnosticQueries } from './public-discovery-diagnostics.mjs';

const now = '2026-09-23T12:00:00.000Z';

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
