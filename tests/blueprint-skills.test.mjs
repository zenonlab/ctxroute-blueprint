import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBlueprintSkills } from '../scripts/validate-blueprint-skills.mjs';
import { verifyBlueprintSkills } from '../scripts/verify-blueprint-skills.mjs';
import { REQUIRED_SKILL_RUNTIME, validateRuntimeAllowlist } from '../scripts/blueprint-review.mjs';
import { trackedControlFiles } from '../scripts/blueprint-sync.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));

test('blueprint skill companions are strict, structured, and non-recursive', () => {
  assert.deepEqual(validateBlueprintSkills(repository), []);
  for (const name of ['blueprint-audit', 'session-auditor', 'skill-creator']) {
    const companion = JSON.parse(readFileSync(join(repository, '.agents', 'skills', name, 'blueprint.json'), 'utf8'));
    assert.equal(companion.schemaVersion, 2);
    assert.ok(companion.validations.every(validation => validation.executable && Array.isArray(validation.args)));
    assert.doesNotMatch(JSON.stringify(companion.validations), /npm run (?:verify|validate|blueprint:review|skills:verify)/u);
  }
});

test('blueprint audit proves the skill runtime allowlist is transitively closed', () => {
  const selected = trackedControlFiles(repository);
  assert.ok(REQUIRED_SKILL_RUNTIME.every(path => selected.includes(path)));
  assert.deepEqual(validateRuntimeAllowlist(repository), []);
});

test('blueprint skill validation rejects unknown fields, invalid labels, and recursive scripts', () => {
  const root = fixture();
  const path = join(root, '.agents', 'skills', 'skill-creator', 'blueprint.json');
  const companion = JSON.parse(readFileSync(path, 'utf8'));
  companion.unexpected = true;
  companion.researchLabels = ['unlabelled-source'];
  companion.validations = [{ id: 'recursive', executable: 'npm', args: ['run', 'verify', 'token=must-not-live-here'], cwd: '.', timeout_ms: 30_000 }];
  writeFileSync(path, `${JSON.stringify(companion, null, 2)}\n`);
  const errors = validateBlueprintSkills(root).join('\n');
  assert.match(errors, /unknown companion fields unexpected/u);
  assert.match(errors, /invalid researchLabels/u);
  assert.match(errors, /recursively invokes verify/u);
  assert.match(errors, /invalid args/u);
});

test('skills verifier runs exact structured commands and redacts bounded failures', async () => {
  const calls = [];
  const success = await verifyBlueprintSkills({ root: repository, execute: async validation => { calls.push(structuredClone(validation)); return { exit_code: 0 }; } });
  assert.equal(success.ok, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => Object.keys(call).sort().join(',') === 'args,cwd,executable,id,timeout_ms'));
  const failure = await verifyBlueprintSkills({ root: repository, execute: async () => { throw new Error(`token=must-not-leak ${'x'.repeat(2000)}`); } });
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure), /must-not-leak/u);
  assert.ok(failure.results.every(result => Buffer.byteLength(result.diagnostic) <= 1024));
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-skills-'));
  for (const name of ['blueprint-audit', 'session-auditor', 'skill-creator']) {
    const target = join(root, '.agents', 'skills', name);
    cpSync(join(repository, '.agents', 'skills', name), target, { recursive: true });
    assert.equal(dirname(target).endsWith(join('.agents', 'skills')), true);
  }
  return root;
}
