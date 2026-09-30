import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { failureTracePointerQuery, retrieveFailureTrace } from './discovery-failure-trace.mjs';

const traceId = '00000000-0000-4000-8000-000000000001';
const scope = { schemaVersion: 1, entries: [{ sourceCount: 1, key: {
  fingerprint: 'a'.repeat(64), mediaKind: 'MANGA', parserVersion: '5', siteRulesVersion: '3',
} }] };
const diagnostic = { schemaVersion: 1, attempt: 1, observedAt: '2026-09-30T12:00:00.000Z', traceId,
  cause: { code: 'http', httpStatus: 503, provider: 'mangaupdates', stage: 'search' }, decision: 'retry-requested' };
const trace = { schemaVersion: 1, traceId, correlationId: '00000000-0000-4000-8000-000000000002',
  observedAt: diagnostic.observedAt, key: scope.entries[0].key,
  query: { discoveryTitles: ['Private source title'], mediaKind: 'MANGA', sourceTitles: ['Original title alias'] },
  requestDigest: 'b'.repeat(64), attempt: 1,
  exchanges: [{ method: 'GET', target: 'https://api.mangadex.org/manga?title=private', responseStatus: 503,
    responseBody: 'provider unavailable', truncated: false }] };

test('trace pointer query pins complete identity, event id, and UUID', () => {
  const query = failureTracePointerQuery(scope, 1, 9, traceId);
  assert.match(query, /INDEXED BY public_discovery_failure_events_key/u);
  assert.match(query, /event_id = 9/u);
  assert.match(query, /json_extract\(diagnostic_json, '\$\.traceId'\) = '00000000-0000-4000-8000-000000000001'/u);
  assert.throws(() => failureTracePointerQuery(scope, 1, 9, 'not-a-uuid'));
});

test('trace reader checks D1 pointer and complete R2 scope before private export', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'discovery-trace-test-'));
  try {
    let objectKey;
    const result = await retrieveFailureTrace(scope, 1, 9, traceId, {
      directory,
      readPointer: async query => {
        assert.match(query, /fingerprint = '[a-f0-9]{64}'/u);
        return { rows: [{ eventId: 9, requestDigest: trace.requestDigest, diagnostic: JSON.stringify(diagnostic) }],
          meta: { rows_read: 1, rows_written: 0, changes: 0, changed_db: false } };
      },
      fetchObject: async key => { objectKey = key; return Buffer.from(JSON.stringify(trace)); },
    });
    assert.equal(objectKey, `tobirink-discovery-audit/provider-audit/v1/${traceId}.json`);
    assert.deepEqual(JSON.parse(await readFile(result.file, 'utf8')), trace);
    assert.equal((await stat(result.file)).mode & 0o777, 0o600);
    const wrongScope = { ...scope, entries: [{ ...scope.entries[0], key: { ...scope.entries[0].key, fingerprint: 'c'.repeat(64) } }] };
    await assert.rejects(() => retrieveFailureTrace(wrongScope, 1, 9, traceId, {
      directory,
      readPointer: async () => ({ rows: [{ eventId: 9, requestDigest: trace.requestDigest, diagnostic: JSON.stringify(diagnostic) }],
        meta: { rows_read: 1, rows_written: 0, changes: 0 } }),
      fetchObject: async () => Buffer.from(JSON.stringify(trace)),
    }), /scope-mismatch/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
