import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyWallpaperConcept } from '../scripts/verify-wallpaper-concept.mjs';

async function fixture() {
  return JSON.parse(await readFile('docs/templates/wallpaper-concept.example.json', 'utf8'));
}

test('wallpaper concept example satisfies its schema and opens generation gate', async () => {
  const schema = JSON.parse(await readFile('docs/templates/wallpaper-concept.schema.json', 'utf8'));
  const document = await fixture();
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  const root = await mkdtemp(join(tmpdir(), 'orbite-wallpaper-concept-'));
  const path = join(root, 'concept.json');
  await writeFile(path, JSON.stringify(document));
  assert.equal((await verifyWallpaperConcept(path)).generation_allowed, true);
});

test('theme interface declares the complete source-neutral pin editor', async () => {
  const schema = JSON.parse(await readFile('docs/templates/theme-interface-v5.schema.json', 'utf8'));
  const document = JSON.parse(await readFile('docs/templates/theme-interface-v5.example.json', 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  document.pinning.controls.pop();
  assert.equal(validate(document), false);
});

test('generation stays closed before explicit user acceptance', async () => {
  const document = await fixture();
  document.status = 'proposed';
  document.decision = { status: 'pending', proposal_id: null, decided_by: 'pending', rationale: '' };
  const root = await mkdtemp(join(tmpdir(), 'orbite-wallpaper-concept-'));
  const path = join(root, 'concept.json');
  await writeFile(path, JSON.stringify(document));
  assert.equal((await verifyWallpaperConcept(path)).generation_allowed, false);
});

test('generation stays closed when engine research has an unresolved subsystem', async () => {
  const document = await fixture();
  document.research.subsystems.find(item => item.id === 'effects').status = 'unsupported';
  const root = await mkdtemp(join(tmpdir(), 'orbite-wallpaper-concept-'));
  const path = join(root, 'concept.json');
  await writeFile(path, JSON.stringify(document));
  const result = await verifyWallpaperConcept(path);
  assert.equal(result.generation_allowed, false);
  assert.deepEqual(result.unresolved_subsystems, ['effects']);
});

test('every interactive and pinned object must preserve a session binding', async () => {
  const document = await fixture();
  document.proposals[0].session_bindings.pop();
  const root = await mkdtemp(join(tmpdir(), 'orbite-wallpaper-concept-'));
  const path = join(root, 'concept.json');
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(verifyWallpaperConcept(path), /has no session binding/);
});

test('engine research cannot be certified from hypotheses alone', async () => {
  const document = await fixture();
  document.research.sources[0].classification = 'hypothesis';
  document.research.sources[1].classification = 'hypothesis';
  const root = await mkdtemp(join(tmpdir(), 'orbite-wallpaper-concept-'));
  const path = join(root, 'concept.json');
  await writeFile(path, JSON.stringify(document));
  await assert.rejects(verifyWallpaperConcept(path), /primary documentation or implementation evidence/);
});
