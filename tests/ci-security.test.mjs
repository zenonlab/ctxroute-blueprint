import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

test('validation matrix pins Python and uv and captures Archify visual evidence', () => {
  const workflow = read('.github/workflows/validate.yml');
  assert.match(workflow, /name: Node 24 \/ \$\{\{ matrix\.os \}\}/u);
  assert.match(workflow, /name: Node 22\.18 compatibility/u);
  assert.match(workflow, /node-version: 22\.18\.0/u);
  assert.match(workflow, /Verify declared Node\.js floor[\s\S]*?npm run lint:anti-slop[\s\S]*?npm test/u);
  const floorJob = workflow.match(/  node-floor:[\s\S]*?(?=\n  dependency-audit:)/u)?.[0] ?? '';
  assert.match(floorJob, /actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97/u);
  assert.match(floorJob, /astral-sh\/setup-uv@bec219d24cd3e171d82865faccec33120bb574f4/u);
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/u);
  assert.match(workflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/u);
  assert.match(workflow, /actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97/u);
  assert.match(workflow, /astral-sh\/setup-uv@bec219d24cd3e171d82865faccec33120bb574f4/u);
  assert.match(workflow, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/u);
  assert.match(workflow, /uv sync --project packages\/code-review-graph --frozen --python 3\.12/u);
  assert.match(workflow, /npm run archify:visual-check/u);
  assert.match(workflow, /crg-smoke\.json/u);
  const auditJob = workflow.match(/  dependency-audit:[\s\S]*?(?=\n  smoke-install:)/u)?.[0] ?? '';
  assert.doesNotMatch(auditJob, /npm ci/u);
});

test('untrusted CRG review is read-only, pinned, constrained, and blocks high risk', () => {
  const workflow = read('.github/workflows/code-review-graph.yml');
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /tirth8205\/code-review-graph@2c6dae32643572ee528eb9b77dbcc17f58f3a8c9/u);
  assert.match(workflow, /PIP_CONSTRAINT:/u);
  assert.match(workflow, /fail-on-risk: high/u);
  assert.match(workflow, /if: always\(\).*comment-file/u);
  assert.doesNotMatch(workflow, /pull-requests: write/u);
  assert.equal(read('.github/code-review-graph-constraints.txt').trim().endsWith('code-review-graph==2.3.8'), true);
});

test('trusted commenter never checks out code and validates the complete artifact boundary', () => {
  const workflow = read('.github/workflows/code-review-graph-comment.yml');
  assert.match(workflow, /actions: read\n  pull-requests: write/u);
  assert.doesNotMatch(workflow, /actions\/checkout/u);
  for (const proof of ['MAX_ARCHIVE_BYTES', 'MAX_REPORT_BYTES', 'pr-number.txt', 'head-sha.txt', 'decode("utf-8")', 'EXPECTED_SHA', "replace('@', '&#64;')"]) {
    assert.ok(workflow.includes(proof), proof);
  }
});

test('privileged CRG disposition is exact-SHA, report-bound, admin-only, and never checks out PR code', () => {
  const workflow = read('.github/workflows/code-review-graph-disposition.yml');
  assert.match(workflow, /name: CRG disposition/u);
  assert.match(workflow, /checks: write/u);
  assert.match(workflow, /pull_request_review:/u);
  assert.match(workflow, /name: 'CRG disposition'/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/u);
  assert.doesNotMatch(workflow, /ref:.*head\.sha/u);
  for (const proof of ['report sha256:', 'getCollaboratorPermissionLevel', 'persist-credentials: false', 'MAX_ARCHIVE_BYTES']) assert.ok(workflow.includes(proof), proof);
  const policy = read('scripts/crg-disposition.mjs');
  for (const proof of ["!== 'admin'", 'CRG-report-sha256:', 'review.commit_id !== context.sha', 'login === context.author']) assert.ok(policy.includes(proof), proof);
});
