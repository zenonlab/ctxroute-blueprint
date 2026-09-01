import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { applicableAdrs, decisionDiagnostics, matchScope, parseAdr, syncAdrRules } from '../.codex/hooks/decision-memory.mjs';

test('matches exact paths and single or recursive globs', () => {
  assert.equal(matchScope('package.json', ['package.json']), true);
  assert.equal(matchScope('packages/ctxroute/src/index.js', ['packages/ctxroute/**']), true);
  assert.equal(matchScope('packages/ctxroute/src/index.js', ['packages/*/package.json']), false);
  assert.equal(matchScope('scripts/crg-runner.mjs', ['scripts/*']), true);
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

test('reports explicit ADR conflicts for the PreToolUse boundary', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-memory-conflict-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  writeFileSync(join(root, 'docs/decisions/ADR-0001-one.md'), '---\nscope:\n  - src/**\nreview: on-change\nrevised: true\nconflicts-with:\n  - ADR-0002-two.md\n---\none\n');
  writeFileSync(join(root, 'docs/decisions/ADR-0002-two.md'), '---\nscope:\n  - src/**\nreview: on-change\nrevised: true\n---\ntwo\n');
  const result = decisionDiagnostics(['src/main.js'], root);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts, ['docs/decisions/ADR-0001-one.md conflicts-with ADR-0002-two.md']);
});

test('materializes ADR metadata for CTXRoute and injects it only in scope', () => {
  const root = mkdtempSync(join(tmpdir(), 'decision-memory-ctxroute-'));
  mkdirSync(join(root, 'docs/decisions'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'lib'), { recursive: true });
  writeFileSync(join(root, 'docs/decisions/ADR-0001-rule.md'), '---\nscope:\n  - src/**\nreview: on-change\n---\n# Scoped decision\n\nUse the approved adapter.\n');
  writeFileSync(join(root, 'src/main.js'), 'export default 1;\n');
  writeFileSync(join(root, 'src/other.js'), 'export default 2;\n');
  writeFileSync(join(root, 'lib/other.js'), 'export default 3;\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  syncAdrRules(root);
  const generated = readFileSync(join(root, '.claude/hooks/docs/adr-memory/adr-ADR-0001-rule.md'), 'utf8');
  assert.match(generated, /tool: "\*"/u);
  assert.match(generated, /mode: once/u);
  assert.doesNotMatch(generated, /problem-memory|events:|tools:/u);

  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const hook = join(projectRoot, 'node_modules/ctxroute/src/hooks/codex-doc-inject.js');
  const env = { ...process.env, CTXROUTE_CONFIG_PATH: join(projectRoot, 'ctxroute-config.json'), CTXROUTE_FILEDOCS_DIR: join(root, '.claude/hooks/docs'), CTXROUTE_STATE_DIR: join(root, '.ctxroute/state') };
  const run = (filePath, sessionId = `adr-${filePath}`) => spawnSync(process.execPath, [hook, '--budget', '0'], { cwd: root, env, input: JSON.stringify({ session_id: sessionId, cwd: root, tool_name: 'Edit', tool_input: { file_path: filePath } }), encoding: 'utf8' });
  assert.match(run('src/main.js', 'same-context').stdout, /Use the approved adapter/u);
  assert.doesNotMatch(run('src/main.js', 'same-context').stdout, /Use the approved adapter/u);
  assert.doesNotMatch(run('lib/other.js').stdout, /Use the approved adapter/u);
});
