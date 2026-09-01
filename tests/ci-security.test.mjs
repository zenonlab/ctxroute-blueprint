import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

test('validation matrix pins Python and uv and captures Archify visual evidence', () => {
  const workflow = read('.github/workflows/validate.yml');
  assert.match(workflow, /actions\/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97/u);
  assert.match(workflow, /astral-sh\/setup-uv@37802adc94f370d6bfd71619e3f0bf239e1f3b78/u);
  assert.match(workflow, /uv sync --project packages\/code-review-graph --frozen --python 3\.12/u);
  assert.match(workflow, /npm run archify:visual-check/u);
  assert.match(workflow, /crg-smoke\.json/u);
});

test('untrusted CRG review is read-only, pinned, constrained, and keeps the high gate', () => {
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
