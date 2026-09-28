import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertMangaProvidersRegistered, assertRecoveryProvidersRegistered, awaitObserverReady, awaitRecoveryCompletion, buildScopedQuery, parseRecoveryArguments, reserveRecoveryPost,
  safeFailureCode, selectRemainingCandidates, validateBatch, validateCandidateRow, validateScopedBatch, validateSourceScope } from './discovery-recovery-batch.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

function row(index, mediaKind = index % 2 === 0 ? 'MANGA' : 'MANHWA') {
  const submission = {
    key: { fingerprint: digest(`fingerprint:${index}`), mediaKind, parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
    query: { discoveryTitles: [`Work ${index}`], mediaKind, sourceTitles: [`Source ${index}`] },
    schemaVersion: 3,
  };
  const requestDigest = digest(JSON.stringify(submission));
  return { attemptCount: 8, failedAt: `2026-09-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
    failureReason: 'ATTEMPT_LIMIT', fingerprint: submission.key.fingerprint, mediaKind,
    parserVersion: submission.key.parserVersion, queueSignalState: 'SENT', requestDigest,
    requestJson: JSON.stringify({ ...submission, requestDigest }), siteRulesVersion: submission.key.siteRulesVersion, state: 'FAILED' };
}

function completionHarness({ terminalAt = 120_000, costAt = terminalAt, startAt = 0, abortAt = Infinity,
  failureAt = Infinity, failureCode = 'queue-failure', closeFailure, admissionState = 'PENDING' } = {}) {
  let elapsed = startAt;
  const controller = new AbortController();
  const reads = { state: 0, cost: 0, close: 0 };
  const cost = { providerRequests: 1, acceptedResults: 1, d1RowsRead: 100 };
  const observer = {
    check() { if (elapsed >= failureAt) throw new Error(`discovery-canary-observer-${failureCode}`); },
    read() { reads.cost += 1; return elapsed >= costAt ? cost : undefined; },
    async close() { reads.close += 1; if (closeFailure) throw new Error(`discovery-canary-observer-${closeFailure}`); },
  };
  const options = {
    observer, key: validateCandidateRow(row(0)).submission.key,
    admission: { payload: { state: admissionState }, requestId: '00000000-0000-4000-8000-000000000001' },
    signal: controller.signal,
    wait: async milliseconds => {
      elapsed += milliseconds;
      if (elapsed >= abortAt) controller.abort(new Error('discovery-recovery-budget'));
    },
    readState: async () => {
      reads.state += 1;
      return { state: { state: elapsed >= terminalAt ? 'VERIFIED' : 'PENDING' } };
    },
  };
  return { options, reads, elapsed: () => elapsed, cost };
}

test('waits for the terminal before its correlated cost window at 120 and 600 seconds', async () => {
  for (const terminalAt of [120_000, 600_000]) {
    const context = completionHarness({ terminalAt });
    const result = await awaitRecoveryCompletion(context.options);
    assert.deepEqual(result, { terminal: { observation: terminalAt / 15_000, state: 'VERIFIED' }, cost: context.cost });
    assert.equal(context.elapsed(), terminalAt);
    assert.deepEqual(context.reads, { state: terminalAt / 15_000, cost: 2, close: 1 });
  }
});

test('waits through delayed tail startup before permitting a recovery admission', async () => {
  let probes = 0;
  const tracked = [];
  const observer = {
    check() {},
    track(requestId) { tracked.push(requestId); },
    read() { return probes >= 13 ? { task: 'discovery-lookup' } : undefined; },
  };
  await awaitObserverReady(observer, undefined, {
    readState: async () => {
      probes += 1;
      return { requestId: `00000000-0000-4000-8000-${String(probes).padStart(12, '0')}`,
        state: { state: 'MISS' } };
    },
    wait: async () => undefined,
  });
  assert.equal(probes, 13);
  assert.equal(tracked.length, 13);
  probes = 0;
  observer.read = () => undefined;
  await assert.rejects(awaitObserverReady(observer, undefined, {
    readState: async () => {
      probes += 1;
      return { requestId: `00000000-0000-4000-8000-${String(probes).padStart(12, '0')}`,
        state: { state: 'MISS' } };
    },
    wait: async () => undefined,
  }), /discovery-recovery-observer-not-ready/u);
  assert.equal(probes, 24);
});

test('reads a correlated cost delivered exactly at the final sixty-second boundary', async () => {
  const context = completionHarness({ costAt: 180_000 });
  const result = await awaitRecoveryCompletion(context.options);
  assert.equal(result.cost, context.cost);
  assert.equal(context.elapsed(), 180_000);
  assert.deepEqual(context.reads, { state: 8, cost: 14, close: 1 });
});

test('never certifies VERIFIED without its cost or a cost without a terminal', async () => {
  const missingCost = completionHarness({ costAt: Infinity });
  await assert.rejects(awaitRecoveryCompletion(missingCost.options), /discovery-recovery-cost-missing/u);
  assert.equal(missingCost.elapsed(), 180_000);
  assert.deepEqual(missingCost.reads, { state: 8, cost: 13, close: 0 });
  const missingTerminal = completionHarness({ terminalAt: Infinity, costAt: 0 });
  await assert.rejects(awaitRecoveryCompletion(missingTerminal.options), /discovery-recovery-terminal-timeout/u);
  assert.equal(missingTerminal.elapsed(), 600_000);
  assert.deepEqual(missingTerminal.reads, { state: 40, cost: 0, close: 0 });
});

test('stops on Queue or 429 errors during either observation phase', async () => {
  for (const failureCode of ['queue-failure', 'provider-429']) {
    for (const failureAt of [30_000, 125_000]) {
      const context = completionHarness({ failureAt, failureCode, costAt: 180_000 });
      await assert.rejects(awaitRecoveryCompletion(context.options), { message: `discovery-canary-observer-${failureCode}` });
      assert.equal(context.elapsed(), failureAt);
      assert.equal(context.reads.close, 0);
      assert.equal(context.reads.state, failureAt === 30_000 ? 1 : 8);
    }
  }
});

test('retains the shared twelve-minute deadline across terminal and cost waits', async () => {
  const context = completionHarness({ startAt: 100_000, terminalAt: 700_000, costAt: Infinity, abortAt: 720_000 });
  await assert.rejects(awaitRecoveryCompletion(context.options), /discovery-recovery-budget/u);
  assert.equal(context.elapsed(), 720_000);
  assert.equal(context.reads.state, 40);
  assert.equal(context.reads.close, 0);
});

test('closes and checks the observer before allowing terminal persistence', async () => {
  const failedClose = completionHarness({ closeFailure: 'truncated' });
  await assert.rejects(awaitRecoveryCompletion(failedClose.options), /discovery-canary-observer-truncated/u);
  assert.equal(failedClose.reads.close, 1);
  const lateFailure = completionHarness();
  lateFailure.options.observer.close = async () => {
    lateFailure.options.observer.check = () => { throw new Error('discovery-canary-observer-provider-429'); };
  };
  await assert.rejects(awaitRecoveryCompletion(lateFailure.options), /discovery-canary-observer-provider-429/u);
  const finalCost = completionHarness({ admissionState: 'VERIFIED', costAt: 0 });
  finalCost.options.observer.close = async () => {
    finalCost.options.observer.read = () => ({ ...finalCost.cost, d1RowsRead: 125 });
  };
  assert.equal((await awaitRecoveryCompletion(finalCost.options)).cost.d1RowsRead, 125);
  assert.equal(finalCost.reads.state, 0);
  const lostCost = completionHarness();
  lostCost.options.observer.close = async () => { lostCost.options.observer.read = () => undefined; };
  await assert.rejects(awaitRecoveryCompletion(lostCost.options), /discovery-recovery-cost-missing/u);
});

test('validates a failed known-media request without returning stored JSON', () => {
  const candidate = validateCandidateRow(row(1));
  assert.equal(candidate.mediaKind, 'MANHWA');
  assert.equal(candidate.submission.query.sourceTitles[0], 'Source 1');
  assert.equal('requestJson' in candidate, false);
  assert.match(candidate.identitySeal, /^[a-f0-9]{64}$/u);
});

test('seals exactly ten distinct known-media candidates', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const candidates = rows.map(validateCandidateRow);
  const seal = digest(candidates.map(candidate => candidate.identitySeal).join('\n'));
  const batch = validateBatch(rows, seal);
  assert.equal(batch.candidates.length, 10);
  assert.equal(batch.batchSeal, seal);
});

test('rejects unknown media, digest drift, duplicate keys and changed seals', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  assert.throws(() => validateCandidateRow({ ...row(1), mediaKind: 'UNKNOWN' }), /candidate-invalid/u);
  assert.throws(() => validateCandidateRow({ ...row(1), requestDigest: digest('drift') }), /identity-mismatch/u);
  const duplicates = [...rows];
  duplicates[9] = rows[0];
  const duplicateSeal = digest(duplicates.map(validateCandidateRow).map(candidate => candidate.identitySeal).join('\n'));
  assert.throws(() => validateBatch(duplicates, duplicateSeal), /duplicate-key/u);
  assert.throws(() => validateBatch(rows, digest('changed')), /batch-seal/u);
});

test('redacts unexpected failures', () => {
  assert.equal(safeFailureCode(new Error('secret title and URL')), 'discovery-recovery-failed');
  assert.equal(safeFailureCode(new Error('discovery-recovery-http-429')), 'discovery-recovery-http-429');
});

test('requires every manga provider runtime but lets the Worker serialize an active cadence', () => {
  const ready = [
    { availability: 'READY', provider: 'kitsu-manga' },
    { availability: 'READY', provider: 'mangadex' },
    { availability: 'READY', provider: 'mangaupdates' },
  ];
  assert.deepEqual(assertMangaProvidersRegistered(ready), ready);
  assert.deepEqual(assertMangaProvidersRegistered([...ready.slice(0, 2), { availability: 'DEFERRED', provider: 'mangaupdates' }]),
    [...ready.slice(0, 2), { availability: 'DEFERRED', provider: 'mangaupdates' }]);
  assert.throws(() => assertMangaProvidersRegistered(ready.slice(0, 2)), /provider-readiness-invalid/u);
});

test('resume selects only sealed unattempted rows and refuses an unfinished POST', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const candidates = rows.map(validateCandidateRow);
  const journal = { attempts: candidates.slice(0, 4).map((candidate, index) => ({ index: index + 1,
    media: candidates[index].mediaKind, state: 'TERMINAL', terminal: 'VERIFIED' })),
  batchId: 'recovery-test-01', batchSeal: digest(candidates.map(candidate => candidate.identitySeal).join('\n')),
  candidates: candidates.map(candidate => ({ fingerprint: candidate.fingerprint, identitySeal: candidate.identitySeal,
    mediaKind: candidate.mediaKind })), schemaVersion: 3, scopeSeal: validateSourceScope(scopeFor(rows)).scopeSeal };
  assert.deepEqual(selectRemainingCandidates(rows.slice(4), journal, scopeFor(rows)).map(candidate => candidate.identitySeal), candidates.slice(4).map(candidate => candidate.identitySeal));
  journal.attempts[3] = { index: 4, media: candidates[3].mediaKind, state: 'POST_STARTED' };
  assert.throws(() => selectRemainingCandidates(rows.slice(4), journal, scopeFor(rows)), /receipt-incomplete/u);
});

test('prepared receipt rejects a changed candidate identity', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const candidates = rows.map(validateCandidateRow);
  const journal = { attempts: [], batchId: 'recovery-test-02', batchSeal: digest(candidates.map(candidate => candidate.identitySeal).join('\n')),
    candidates: candidates.map(candidate => ({ fingerprint: candidate.fingerprint, identitySeal: candidate.identitySeal,
      mediaKind: candidate.mediaKind })), schemaVersion: 3, scopeSeal: validateSourceScope(scopeFor(rows)).scopeSeal };
  const changed = [...rows];
  changed[0] = { ...changed[0], requestDigest: digest('changed') };
  assert.throws(() => selectRemainingCandidates(changed, journal, scopeFor(rows)), /identity-mismatch/u);
});

function scopeFor(rows) {
  return { corpusDigest: digest('private-corpus'), entries: rows.map(candidate => ({
    key: JSON.parse(candidate.requestJson).key, requestDigest: candidate.requestDigest,
  })), schemaVersion: 1, sourceCount: 1522 };
}

test('every recovery mode requires an explicit private source scope before network access', () => {
  for (const mode of ['--preflight', '--prepare', '--execute']) {
    const args = mode === '--preflight' ? [mode] : [mode, 'recovery-test'];
    assert.throws(() => parseRecoveryArguments(args), /invalid-arguments/u);
    for (const path of ['', '--scope', undefined]) {
      assert.throws(() => parseRecoveryArguments([...args, '--scope', path]), /invalid-arguments/u);
    }
    assert.deepEqual(parseRecoveryArguments([...args, '--scope', '/private/source.json']), {
      batchId: mode === '--preflight' ? undefined : 'recovery-test', mode, scopePath: '/private/source.json',
    });
    assert.throws(() => parseRecoveryArguments([...args, '--scope', '/private/source.json', 'extra']), /invalid-arguments/u);
  }
});

test('scope validates one to ten unique known-media keys and sealed request digests', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const scope = scopeFor(rows);
  assert.equal(validateSourceScope(scope).scope.entries.length, 10);
  assert.throws(() => validateSourceScope(undefined), /scope-invalid/u);
  assert.equal(validateSourceScope({ ...scope, entries: scope.entries.slice(1) }).scope.entries.length, 9);
  assert.throws(() => validateSourceScope({ ...scope, entries: [] }), /scope-invalid/u);
  assert.throws(() => validateSourceScope({ ...scope, entries: [...scope.entries, scope.entries[0]] }), /scope-invalid/u);
  assert.throws(() => validateSourceScope({ ...scope, title: 'private' }), /scope-invalid/u);
  const duplicate = structuredClone(scope);
  duplicate.entries[9] = duplicate.entries[0];
  assert.throws(() => validateSourceScope(duplicate), /scope-duplicate/u);
  for (const key of [{ mediaKind: 'UNKNOWN' }, { parserVersion: "bad' OR 1=1" }, { siteRulesVersion: ' ' }]) {
    const invalid = structuredClone(scope);
    Object.assign(invalid.entries[0].key, key);
    assert.throws(() => buildScopedQuery(invalid), /scope-invalid/u);
  }
});

test('partial final batches preserve media, offset, sealing and completed journal semantics', () => {
  for (const count of [1, 3, 9, 10]) {
    const rows = Array.from({ length: count }, (_value, index) => row(index, ['ANIME', 'MANHUA', 'MANGA', 'MANHWA'][index % 4]));
    const scope = scopeFor(rows);
    const batch = validateScopedBatch(rows, scope);
    const query = buildScopedQuery(scope, count - 1);
    assert.equal(query.parameters.length, count * 5 + 1);
    assert.throws(() => buildScopedQuery(scope, count), /scope-offset/u);
    const journal = { attempts: [], batchId: 'recovery-partial', batchSeal: batch.batchSeal,
      candidates: batch.candidates.map(({ fingerprint, identitySeal, mediaKind }) => ({ fingerprint, identitySeal, mediaKind })),
      schemaVersion: 3, scopeSeal: batch.scopeSeal };
    assert.equal(selectRemainingCandidates(rows, journal, scope).length, count);
    journal.attempts = batch.candidates.map((candidate, index) => ({ index: index + 1, media: candidate.mediaKind, state: 'TERMINAL', terminal: 'VERIFIED' }));
    assert.deepEqual(selectRemainingCandidates([], journal, scope), []);
    assert.throws(() => selectRemainingCandidates([], { ...journal, candidates: [] }, scope), /journal-invalid/u);
  }
  const anime = ['anilist', 'kitsu-anime'].map(provider => ({ availability: 'DEFERRED', provider }));
  assert.deepEqual(assertRecoveryProvidersRegistered(anime, ['ANIME']), anime);
  assert.throws(() => assertRecoveryProvidersRegistered(anime, ['MANGA']), /provider-readiness-invalid/u);
});

test('scoped selection requires the complete source key and digest, not global oldest failures', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const scope = scopeFor(rows);
  assert.deepEqual(validateScopedBatch([...rows].reverse(), scope).candidates.map(candidate => candidate.fingerprint), rows.map(candidate => candidate.fingerprint));
  for (const change of [entry => { entry.key.parserVersion = 'other'; }, entry => { entry.key.siteRulesVersion = 'other'; },
    entry => { entry.key.mediaKind = 'MANHWA'; }, entry => { entry.requestDigest = digest('different-payload'); },
    entry => { entry.key.fingerprint = digest('unrelated-key'); }]) {
    const unrelated = structuredClone(scope);
    change(unrelated.entries[0]);
    assert.throws(() => validateScopedBatch(rows, unrelated), /scope-mismatch/u);
  }
});

test('receipts bind corpus, ordering and source payloads and refuse all legacy receipts', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const scope = scopeFor(rows);
  const batch = validateScopedBatch(rows, scope);
  const journal = { attempts: [], batchId: 'recovery-scoped', batchSeal: batch.batchSeal,
    candidates: batch.candidates.map(({ fingerprint, identitySeal, mediaKind }) => ({ fingerprint, identitySeal, mediaKind })),
    schemaVersion: 3, scopeSeal: batch.scopeSeal };
  assert.equal(selectRemainingCandidates(rows, journal, scope).length, 10);
  assert.throws(() => selectRemainingCandidates(rows, { ...journal, schemaVersion: 2 }, scope), /journal-invalid/u);
  for (const change of [input => { input.corpusDigest = digest('other-corpus'); }, input => { input.sourceCount -= 1; },
    input => { input.entries.reverse(); }, input => { input.entries[0].requestDigest = digest('drift'); }]) {
    const changed = structuredClone(scope);
    change(changed);
    assert.throws(() => selectRemainingCandidates(rows, journal, changed), /scope-mismatch/u);
  }
  assert.throws(() => selectRemainingCandidates(rows, { ...journal, batchSeal: digest('wrong') }, scope), /scope-mismatch/u);
  const incomplete = { ...journal, attempts: [{ index: 1, media: rows[0].mediaKind, state: 'TERMINAL' }] };
  assert.throws(() => selectRemainingCandidates(rows.slice(1), incomplete, scope), /receipt-incomplete/u);
  const complete = { ...journal, attempts: rows.map((candidate, index) => ({ index: index + 1, media: candidate.mediaKind, state: 'TERMINAL', terminal: 'VERIFIED' })) };
  assert.deepEqual(selectRemainingCandidates([], complete, scope), []);
});

test('scoped SQL executes primary-key probes only and excludes unrelated or changed requests', () => {
  const database = new DatabaseSync(':memory:');
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const scope = scopeFor(rows);
  try {
    database.exec(`CREATE TABLE public_discovery_requests_v3 (
      fingerprint TEXT, media_kind TEXT, parser_version TEXT, rules_version TEXT, request_digest TEXT,
      request_json TEXT, state TEXT, failure_reason TEXT, failed_at TEXT, attempt_count INTEGER, queue_signal_state TEXT,
      PRIMARY KEY (fingerprint, media_kind, parser_version, rules_version))`);
    const insert = database.prepare('INSERT INTO public_discovery_requests_v3 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const candidate of [...rows, { ...row(11), failedAt: '2020-01-01T00:00:00.000Z' }]) {
      insert.run(candidate.fingerprint, candidate.mediaKind, candidate.parserVersion, candidate.siteRulesVersion,
        candidate.requestDigest, candidate.requestJson, candidate.state, candidate.failureReason, candidate.failedAt,
        candidate.attemptCount, candidate.queueSignalState);
    }
    const query = buildScopedQuery(scope);
    const plan = database.prepare(query.plan).all(...query.parameters).map(step => step.detail).join('\n');
    assert.match(plan, /SEARCH request USING INDEX sqlite_autoindex_public_discovery_requests_v3_1/u);
    assert.doesNotMatch(plan, /SCAN request(?:\s|$)/u);
    assert.doesNotMatch(plan, /USE TEMP B-TREE/u);
    const results = database.prepare(query.sql).all(...query.parameters);
    assert.equal(validateScopedBatch(results, scope).candidates.length, 10);
    const remaining = buildScopedQuery(scope, 4);
    assert.equal(database.prepare(remaining.sql).all(...remaining.parameters).length, 6);
    assert.equal(database.prepare(remaining.sql).all(...remaining.parameters.map(String)).length, 6);
    assert.throws(() => buildScopedQuery(scope, 10), /scope-offset/u);
    database.prepare('UPDATE public_discovery_requests_v3 SET request_digest = ? WHERE fingerprint = ?').run(digest('changed'), rows[0].fingerprint);
    assert.equal(database.prepare(query.sql).all(...query.parameters).length, 9);
    assert.throws(() => validateScopedBatch(database.prepare(query.sql).all(...query.parameters), scope), /scope-mismatch/u);
  } finally { database.close(); }
});

test('per-key durable POST reservation rejects concurrent processes and later batches', async () => {
  const directory = pathToFileURL(`${await mkdtemp(join(tmpdir(), 'tobirink-recovery-reservation-'))}/`);
  const entry = scopeFor(Array.from({ length: 10 }, (_value, index) => row(index))).entries[0];
  const results = await Promise.allSettled([reserveRecoveryPost(entry, directory), reserveRecoveryPost(entry, directory)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /post-reservation-failed/u);
  await assert.rejects(reserveRecoveryPost(structuredClone(entry), directory), /post-reservation-failed/u);
  await assert.rejects(reserveRecoveryPost({ ...entry, requestDigest: digest('changed') }, directory), /post-reservation-failed/u);
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  if (process.platform !== 'win32') assert.equal((await stat(new URL(files[0], directory))).mode & 0o777, 0o600);
});

test('CLI rejects unsafe scope files with closed errors and no private output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tobirink-recovery-cli-'));
  const malformed = join(directory, 'PRIVATE_MALFORMED.json');
  const oversized = join(directory, 'PRIVATE_OVERSIZED.json');
  await writeFile(malformed, '{"PRIVATE_TITLE":', { mode: 0o600 });
  await writeFile(oversized, JSON.stringify({ PRIVATE_TITLE: 'private'.repeat(3000) }), { mode: 0o600 });
  const cases = [
    { args: ['--preflight'], code: 'invalid-arguments' },
    { args: ['--preflight', '--scope', join(directory, 'PRIVATE_MISSING.json')], code: 'scope-missing' },
    { args: ['--preflight', '--scope', malformed], code: 'scope-invalid' },
    { args: ['--preflight', '--scope', oversized], code: 'scope-invalid' },
  ];
  if (process.platform !== 'win32') {
    const publicScope = join(directory, 'PRIVATE_PERMISSIONS.json');
    await writeFile(publicScope, JSON.stringify(scopeFor(Array.from({ length: 10 }, (_value, index) => row(index)))), { mode: 0o600 });
    await chmod(publicScope, 0o644);
    cases.push({ args: ['--preflight', '--scope', publicScope], code: 'scope-invalid' });
  }
  for (const scenario of cases) {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./discovery-recovery-batch.mjs', import.meta.url)), ...scenario.args], {
      cwd: directory, encoding: 'utf8', env: { PATH: directory }, timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `discovery-recovery-${scenario.code}\n`);
    assert.doesNotMatch(result.stderr, /PRIVATE|private|fingerprint|corpusDigest|requestDigest/u);
  }
});
