import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateCrgDisposition } from '../scripts/crg-disposition.mjs';

const sha = 'a'.repeat(40);
const submitted = '2026-09-06T12:00:00.000Z';

test('CRG disposition passes below high without a waiver', async () => {
  const artifactDirectory = artifact('0.42', 'MEDIUM');
  const result = await evaluateCrgDisposition({ artifactDirectory, context: context() });
  assert.equal(result.conclusion, 'success');
  assert.equal(result.attestation, null);
});

test('high CRG risk requires a distinct exact-SHA administrator acceptance bound to the report', async () => {
  const artifactDirectory = artifact('0.72', 'HIGH');
  const digest = reportDigest('0.72', 'HIGH');
  const body = `Justification: Accept bounded CRG risk for this exact analyzed report.\nTracking: #123\nCRG-report-sha256:${digest}`;
  const valid = await evaluateCrgDisposition({ artifactDirectory, context: context({ reviews: [review({ body })], permissions: { admin: 'admin' } }) });
  assert.equal(valid.conclusion, 'success');
  assert.equal(valid.attestation.sha, sha);
  assert.equal(valid.attestation.report_digest, digest);
  assert.equal(valid.attestation.tracking_issue, '#123');

  for (const invalidContext of [
    context({ reviews: [review({ body, user: { login: 'author' } })], permissions: { author: 'admin' } }),
    context({ reviews: [review({ body, commit_id: 'b'.repeat(40) })], permissions: { admin: 'admin' } }),
    context({ reviews: [review({ body })], permissions: { admin: 'write' } }),
    context({ reviews: [review({ body: body.replace(digest, 'c'.repeat(64)) })], permissions: { admin: 'admin' } }),
    context({ reviews: [review({ body: `Justification: Too short\nTracking: #123\nCRG-report-sha256:${digest}` })], permissions: { admin: 'admin' } }),
  ]) assert.equal((await evaluateCrgDisposition({ artifactDirectory, context: invalidContext })).conclusion, 'failure');
});

test('CRG artifact rejects forged PR, stale SHA, and changed report content', async () => {
  await assert.rejects(() => evaluateCrgDisposition({ artifactDirectory: artifact('0.72', 'HIGH', { pr: 99 }), context: context() }), /PR mismatch/u);
  await assert.rejects(() => evaluateCrgDisposition({ artifactDirectory: artifact('0.72', 'HIGH', { sha: 'b'.repeat(40) }), context: context() }), /SHA mismatch/u);
  const artifactDirectory = artifact('0.72', 'HIGH');
  const digest = reportDigest('0.72', 'HIGH');
  const body = `Justification: Accept bounded CRG risk for this exact analyzed report.\nTracking: #123\nCRG-report-sha256:${digest}`;
  writeFileSync(join(artifactDirectory, 'crg-comment.md'), report('0.85', 'CRITICAL'));
  assert.equal((await evaluateCrgDisposition({ artifactDirectory, context: context({ reviews: [review({ body })], permissions: { admin: 'admin' } }) })).conclusion, 'failure');
});

function context(overrides = {}) { return { pr: 52, sha, author: 'author', reviews: [], permissions: {}, ...overrides }; }
function review(overrides = {}) { return { id: 1, state: 'APPROVED', commit_id: sha, submitted_at: submitted, body: '', user: { login: 'admin' }, ...overrides }; }
function report(score, risk) { return `<!-- code-review-graph-report -->\n\n## code-review-graph review\n\n**Overall risk: ${score} (${risk})** — bounded result\n\n*Powered by [code-review-graph](https://github.com/tirth8205/code-review-graph)*\n`; }
function reportDigest(score, risk) { return createHash('sha256').update(report(score, risk)).digest('hex'); }
function artifact(score, risk, overrides = {}) { const root = mkdtempSync(join(tmpdir(), 'crg-disposition-')); mkdirSync(root, { recursive: true }); writeFileSync(join(root, 'crg-comment.md'), report(score, risk)); writeFileSync(join(root, 'pr-number.txt'), `${overrides.pr ?? 52}\n`); writeFileSync(join(root, 'head-sha.txt'), `${overrides.sha ?? sha}\n`); return root; }
