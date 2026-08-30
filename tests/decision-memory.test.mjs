import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applicableAdrs, decisionDiagnostics, matchScope, parseAdr } from '../.codex/hooks/decision-memory.mjs';

test('matches exact paths and single or recursive globs', () => {
  assert.equal(matchScope('package.json', ['package.json']), true);
  assert.equal(matchScope('packages/ctxroute/src/index.js', ['packages/ctxroute/**']), true);
  assert.equal(matchScope('packages/ctxroute/src/index.js', ['packages/*/package.json']), false);
  assert.equal(matchScope('scripts/watch-crg.mjs', ['scripts/*']), true);
});

test('selects several applicable ADRs in numeric order and skips superseded decisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-memory-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  const frontMatter = (scope, extra = '') => `---\nscope:\n  - ${scope}\nreview: on-change\n${extra}---\n`;
  writeFileSync(join(root, 'docs/decisions/ADR-0002-two.md'), `${frontMatter('packages/**')}two`);
  writeFileSync(join(root, 'docs/decisions/ADR-0001-one.md'), `${frontMatter('packages/ctxroute/**')}one`);
  writeFileSync(join(root, 'docs/decisions/ADR-0003-old.md'), `${frontMatter('packages/**', 'superseded-by: ADR-0001-one.md\n')}old`);
  assert.deepEqual(applicableAdrs(['packages/ctxroute/index.js'], root).map(adr => adr.file), ['docs/decisions/ADR-0001-one.md', 'docs/decisions/ADR-0002-two.md']);
});

test('rejects ADRs without valid metadata', () => {
  const adr = parseAdr('# ADR\n', 'docs/decisions/ADR-0009-bad.md');
  assert.match(adr.errors.join('\n'), /front matter/u);
  assert.equal(parseAdr('---\nscope:\n  - scripts/**\nreview: on-change\n---\nbody', 'x').errors.length, 0);
});

test('diagnoses invalid and replaced ADRs as non-usable decisions', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-memory-diagnostics-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  writeFileSync(join(root, 'docs/decisions/ADR-0001-invalid.md'), '# missing metadata\n');
  writeFileSync(join(root, 'docs/decisions/ADR-0002-replaced.md'), '---\nscope:\n  - src/**\nreview: on-change\nsuperseded-by: ADR-0003-current.md\n---\nold\n');
  const result = decisionDiagnostics(['src/main.js'], root);
  assert.deepEqual(result.applicable, []);
  assert.deepEqual(result.invalid, ['docs/decisions/ADR-0001-invalid.md']);
  assert.deepEqual(result.superseded, ['docs/decisions/ADR-0002-replaced.md -> ADR-0003-current.md']);
});

test('reports overlapping ADRs as partial without pretending to resolve semantics', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-memory-partial-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  const frontMatter = scope => `---\nscope:\n  - ${scope}\nreview: on-change\nrevised: true\n---\n`;
  writeFileSync(join(root, 'docs/decisions/ADR-0001-one.md'), `${frontMatter('src/**')}one`);
  writeFileSync(join(root, 'docs/decisions/ADR-0002-two.md'), `${frontMatter('src/main.js')}two`);
  const result = decisionDiagnostics(['src/main.js'], root);
  assert.equal(result.status, 'partial');
  assert.match(result.message, /semantic contradiction is outside scope/u);
});
