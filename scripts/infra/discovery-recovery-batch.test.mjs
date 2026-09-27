import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertMangaProvidersRegistered, safeFailureCode, selectRemainingCandidates, validateBatch, validateCandidateRow } from './discovery-recovery-batch.mjs';

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
    mediaKind: candidate.mediaKind })), schemaVersion: 2 };
  assert.deepEqual(selectRemainingCandidates(rows.slice(4), journal).map(candidate => candidate.identitySeal), candidates.slice(4).map(candidate => candidate.identitySeal));
  journal.attempts[3] = { index: 4, media: candidates[3].mediaKind, state: 'POST_STARTED' };
  assert.throws(() => selectRemainingCandidates(rows.slice(4), journal), /receipt-incomplete/u);
});

test('prepared receipt rejects a changed candidate identity', () => {
  const rows = Array.from({ length: 10 }, (_value, index) => row(index));
  const candidates = rows.map(validateCandidateRow);
  const journal = { attempts: [], batchId: 'recovery-test-02', batchSeal: digest(candidates.map(candidate => candidate.identitySeal).join('\n')),
    candidates: candidates.map(candidate => ({ fingerprint: candidate.fingerprint, identitySeal: candidate.identitySeal,
      mediaKind: candidate.mediaKind })), schemaVersion: 2 };
  const changed = [...rows];
  changed[0] = { ...changed[0], requestDigest: digest('changed') };
  assert.throws(() => selectRemainingCandidates(changed, journal), /identity-mismatch/u);
});
