import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectFailureAudit, failureAuditQuery, runFailureAudit } from './discovery-failure-audit.mjs';

const scope = { schemaVersion: 1, entries: [{ sourceCount: 3, key: {
  fingerprint: 'a'.repeat(64), mediaKind: 'MANGA', parserVersion: '5', siteRulesVersion: '3',
} }] };
const diagnostic = { schemaVersion: 1, attempt: 1, observedAt: '2026-09-30T12:00:00.000Z',
  cause: { code: 'http', httpStatus: 503, provider: 'mangaupdates', stage: 'search' }, decision: 'retry-requested' };

async function fixture() {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE public_discovery_requests_v3 (
    fingerprint TEXT, media_kind TEXT, parser_version TEXT, rules_version TEXT,
    request_digest TEXT, failure_diagnostics_json TEXT)`);
  const repository = fileURLToPath(new URL('../../', import.meta.url));
  database.exec(await readFile(resolve(repository, 'apps/worker/migrations/0031_public_discovery_failure_events.sql'), 'utf8'));
  database.prepare('INSERT INTO public_discovery_requests_v3 VALUES (?, ?, ?, ?, ?, NULL)')
    .run('a'.repeat(64), 'MANGA', '5', '3', 'b'.repeat(64));
  const append = value => database.prepare(`UPDATE public_discovery_requests_v3 SET failure_diagnostics_json =
    json_insert(CASE WHEN json_array_length(COALESCE(failure_diagnostics_json, '[]')) >= 8
      THEN json_remove(failure_diagnostics_json, '$[0]') ELSE COALESCE(failure_diagnostics_json, '[]') END, '$[#]', json(?))`).run(JSON.stringify(value));
  const readPage = async (input, ordinal, after) => {
    const key = input.entries[ordinal - 1].key;
    const rows = database.prepare(`SELECT event_id AS eventId, request_digest AS requestDigest, diagnostic_json AS diagnostic
      FROM public_discovery_failure_events INDEXED BY public_discovery_failure_events_key
      WHERE fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
        AND event_id > ? ORDER BY event_id LIMIT 101`).all(key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion, after);
    return { rows, meta: { rows_read: rows.length * 2, rows_written: 0, changes: 0, changed_db: false } };
  };
  return { database, append, readPage };
}

test('backend archive survives journal rotation and request deletion with bounded cursor reads', async () => {
  const { database, append, readPage } = await fixture();
  try {
    for (let index = 0; index < 105; index += 1) append({ ...diagnostic, observedAt: new Date(Date.parse(diagnostic.observedAt) + index * 1000).toISOString() });
    assert.equal(database.prepare('SELECT json_array_length(failure_diagnostics_json) AS count FROM public_discovery_requests_v3').get().count, 8);
    database.exec('DELETE FROM public_discovery_requests_v3');
    const first = await collectFailureAudit(scope, 1, { readPage });
    assert.equal(first.events.length, 100);
    assert.equal(first.nextCursor, 100);
    assert.deepEqual(first.events[0].diagnostic, diagnostic);
    const last = await collectFailureAudit(scope, 1, { readPage, after: first.nextCursor });
    assert.equal(last.events.length, 5);
    assert.equal(last.nextCursor, null);
    assert.equal(last.events[0].eventId, 101);
    assert.equal((await collectFailureAudit(scope, 1, { readPage, after: 105 })).events.length, 0);
    assert.match(failureAuditQuery(scope, 1), /INDEXED BY public_discovery_failure_events_key/u);
  } finally { database.close(); }
});

test('archive failure rolls back the recent diagnostic atomically', async () => {
  const { database, append } = await fixture();
  try {
    database.exec(`CREATE TRIGGER reject_test_event BEFORE INSERT ON public_discovery_failure_events
      BEGIN SELECT RAISE(ABORT, 'test-archive-unavailable'); END`);
    assert.throws(() => append(diagnostic), /test-archive-unavailable/u);
    assert.equal(database.prepare('SELECT failure_diagnostics_json AS value FROM public_discovery_requests_v3').get().value, null);
    assert.equal(database.prepare('SELECT count(*) AS count FROM public_discovery_failure_events').get().count, 0);
  } finally { database.close(); }
});

test('repeated identical observations are retained after the recent journal is full', async () => {
  const { database, append, readPage } = await fixture();
  try {
    for (let index = 0; index < 10; index += 1) append(diagnostic);
    const page = await collectFailureAudit(scope, 1, { readPage });
    assert.equal(page.events.length, 10);
    assert.ok(page.events.every(event => event.diagnostic.observedAt === diagnostic.observedAt));
  } finally { database.close(); }
});

test('audit rejects injection, invalid cursors, writes, unordered or private diagnostics', async () => {
  const badScope = structuredClone(scope);
  badScope.entries[0].key.parserVersion = "x'; DELETE FROM anything;--";
  assert.throws(() => failureAuditQuery(badScope, 1));
  for (const after of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '0 OR 1=1']) assert.throws(() => failureAuditQuery(scope, 1, after));
  assert.throws(() => failureAuditQuery(scope, 2));
  const row = { eventId: 1, requestDigest: 'b'.repeat(64), diagnostic: JSON.stringify(diagnostic) };
  const meta = { rows_read: 1, rows_written: 0, changes: 0 };
  for (const result of [
    { rows: [row], meta: { ...meta, rows_written: 1 } },
    { rows: [], meta: { ...meta, rows_read: 405 } },
    { rows: [row, row], meta },
    { rows: [{ ...row, diagnostic: JSON.stringify({ ...diagnostic, privateTitle: 'secret' }) }], meta },
  ]) await assert.rejects(collectFailureAudit(scope, 1, { readPage: async () => result }));
});

test('headless audit writes a private page and emits aggregates only', async () => {
  const { database, append, readPage } = await fixture();
  const directory = await mkdtemp(join(tmpdir(), 'failure-audit-test-'));
  try {
    append(diagnostic);
    const path = join(directory, 'scope.json');
    await writeFile(path, JSON.stringify(scope), { mode: 0o600 });
    const output = [];
    await runFailureAudit(['--scope', path, '--request', '1'], { directory, readPage, output: value => output.push(value) });
    const receipt = JSON.parse(output[0]);
    assert.equal(receipt.events, 1);
    assert.equal((await stat(receipt.file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(receipt.file, '..'))).mode & 0o777, 0o700);
    assert.equal(output[0].includes('mangaupdates'), false);
    assert.deepEqual(JSON.parse(await readFile(receipt.file, 'utf8')).events[0], {
      eventId: 1, requestDigest: 'b'.repeat(64), diagnostic,
    });
    await assert.rejects(runFailureAudit(['--menu', 'true']));
    await assert.rejects(runFailureAudit(['--scope', path, '--request', '1', '--request', '2']));
  } finally { database.close(); }
});
