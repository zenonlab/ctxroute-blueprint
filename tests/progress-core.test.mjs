import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyProgress, readProgress, validatePlan, approvePlan, progressStatus } from '../scripts/progress-core.mjs';

const plan = (overrides = {}) => ({ goalId: 'goal-9', title: 'Checklist', validationEvidence: ['tests/progress-core.test.mjs'], steps: [{ id: 'step-1', title: 'Define contract', acceptance: ['Schema validated'], files: ['.project/progress.json'], commands: ['npm test'], evidence: [] }], ...overrides });
const root = () => mkdtempSync(join(tmpdir(), 'progress-'));

test('empty checklist is read-only and has stable shape', async () => { const directory = root(); assert.deepEqual(await readProgress(directory), emptyProgress()); assert.equal(existsSync(join(directory, '.project/progress.json')), false); });
test('validate-plan is read-only and rejects missing acceptance, files, commands, evidence', async () => { const directory = root(); const result = validatePlan({ goalId: 'goal-9', title: 'Bad', steps: [{ id: 'step-1', title: 'Bad' }] }, await readProgress(directory)); assert.equal(result.ok, false); assert.equal(existsSync(join(directory, '.project/progress.json')), false); assert.ok(result.errors.length >= 4); });
test('approval writes JSON and generated Markdown atomically and is idempotent', async () => { const directory = root(); const first = await approvePlan({ ...plan(), approved: true }, directory); const json = readFileSync(join(directory, '.project/progress.json'), 'utf8'); const markdown = readFileSync(join(directory, 'docs/progress.md'), 'utf8'); assert.deepEqual(JSON.parse(json), first); assert.match(markdown, /Checklist — ACTIVE/u); const second = await approvePlan({ ...plan(), approved: true }, directory); assert.deepEqual(second, first); });
test('multiple goals preserve insertion order and status is compact', async () => { const directory = root(); await approvePlan({ ...plan(), approved: true }, directory); await approvePlan({ ...plan({ goalId: 'goal-10', title: 'Second' }), approved: true }, directory); assert.deepEqual(progressStatus(await readProgress(directory)).map(item => item.id), ['goal-9', 'goal-10']); });
test('approval is explicit and rejects paths, secrets, duplicate steps, and limits', async () => { const directory = root(); await assert.rejects(() => approvePlan(plan(), directory), /approved must be true/u); assert.equal(validatePlan({ ...plan(), steps: [{ ...plan().steps[0], files: ['../secret'] }], validationEvidence: ['ok'] }).ok, false); assert.equal(validatePlan({ ...plan(), steps: [{ ...plan().steps[0], id: 'step-1' }, { ...plan().steps[0], id: 'step-1' }] }).ok, false); assert.equal(validatePlan({ ...plan(), validationEvidence: ['apiKey: hidden'] }).ok, false); });
test('invalid stored JSON is rejected', async () => { const directory = root(); const path = join(directory, '.project/progress.json'); mkdirSync(join(directory, '.project')); writeFileSync(path, '{invalid'); await assert.rejects(() => readProgress(directory), /Cannot read progress checklist/u); });
