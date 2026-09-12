import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyGameThemeAuthoringRun } from '../scripts/verify-game-theme-authoring-run.mjs';
import { verifyWallpaperConcept } from '../scripts/verify-wallpaper-concept.mjs';

async function fixture() {
  return JSON.parse(await readFile('docs/templates/wallpaper-concept.example.json', 'utf8'));
}

async function authoringFixture() {
  const root = await mkdtemp(join(tmpdir(), 'orbite-theme-authoring-'));
  const [concept, run] = await Promise.all([
    readFile('docs/templates/wallpaper-concept.example.json', 'utf8'),
    readFile('docs/templates/game-theme-authoring-run.example.json', 'utf8')
  ]);
  const evidence = await readFile('docs/templates/game-theme-authoring-evidence.example.json', 'utf8');
  await Promise.all([
    writeFile(join(root, 'wallpaper-concept.example.json'), concept),
    writeFile(join(root, 'game-theme-authoring-evidence.example.json'), evidence),
    writeFile(join(root, 'run.json'), run)
  ]);
  return { root, path: join(root, 'run.json'), document: JSON.parse(run) };
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

test('authoring run qualifies a candidate without touching the active installation', async () => {
  const schema = JSON.parse(await readFile('docs/templates/game-theme-authoring-run.schema.json', 'utf8'));
  const { path, document } = await authoringFixture();
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  assert.deepEqual(await verifyGameThemeAuthoringRun(path), {
    ok: true,
    id: 'fixture-island-first-pass',
    status: 'qualified',
    passed_gates: 16,
    generation_allowed: true,
    activation_allowed: true,
    activation_attempted: false
  });
});

test('authoring run rejects premature activation and a fake witness scene', async () => {
  const first = await authoringFixture();
  const { path, sha256 } = first.document.gates[0].evidence;
  first.document.activation = { attempted: true, active_receipt: { path, sha256 } };
  first.document.gates[13] = { id: 'visual_matrix', status: 'pending', evidence: null };
  await writeFile(first.path, JSON.stringify(first.document));
  await assert.rejects(verifyGameThemeAuthoringRun(first.path), /before candidate qualification/);

  const second = await authoringFixture();
  second.document.scenes.witness = second.document.scenes.primary;
  await writeFile(second.path, JSON.stringify(second.document));
  await assert.rejects(verifyGameThemeAuthoringRun(second.path), /witness scene must differ/);
});

test('authoring run rejects incomplete dependencies, gate disorder and missing relation families', async () => {
  const closure = await authoringFixture();
  closure.document.engine_profile.dependency_closure.unresolved = 1;
  await writeFile(closure.path, JSON.stringify(closure.document));
  await assert.rejects(verifyGameThemeAuthoringRun(closure.path), /dependency closure/);

  const gates = await authoringFixture();
  [gates.document.gates[0], gates.document.gates[1]] = [gates.document.gates[1], gates.document.gates[0]];
  await writeFile(gates.path, JSON.stringify(gates.document));
  await assert.rejects(verifyGameThemeAuthoringRun(gates.path), /complete and ordered/);

  const relations = await authoringFixture();
  relations.document.relations.find(item => item.id === 'effect_origin').id = 'audio_spatialization';
  await writeFile(relations.path, JSON.stringify(relations.document));
  await assert.rejects(verifyGameThemeAuthoringRun(relations.path), /missing relation families/);
});

test('authoring run rejects forged gate evidence and unknown research evidence', async () => {
  const forged = await authoringFixture();
  await writeFile(join(forged.root, 'game-theme-authoring-evidence.example.json'), '{}');
  await assert.rejects(verifyGameThemeAuthoringRun(forged.path), /evidence sha256 mismatch/);

  const unknown = await authoringFixture();
  unknown.document.engine_profile.evidence_ids = ['not-in-concept'];
  await writeFile(unknown.path, JSON.stringify(unknown.document));
  await assert.rejects(verifyGameThemeAuthoringRun(unknown.path), /unknown evidence/);
});

test('authoring gates require the matching typed record and gate-specific checks', async () => {
  const mismatched = await authoringFixture();
  mismatched.document.gates[0].evidence.record_id = 'research';
  await writeFile(mismatched.path, JSON.stringify(mismatched.document));
  await assert.rejects(verifyGameThemeAuthoringRun(mismatched.path), /evidence record mismatch/);

  const incomplete = await authoringFixture();
  const evidencePath = join(incomplete.root, 'game-theme-authoring-evidence.example.json');
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  evidence.records.find(record => record.id === 'animation').checks = [
    { id: 'timing', status: 'pass', detail: 'Timing seul, volontairement incomplet.' }
  ];
  const bytes = Buffer.from(JSON.stringify(evidence));
  await writeFile(evidencePath, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  for (const gate of incomplete.document.gates) {
    if (gate.evidence?.path === 'game-theme-authoring-evidence.example.json') {
      gate.evidence.sha256 = sha256;
    }
  }
  await writeFile(incomplete.path, JSON.stringify(incomplete.document));
  await assert.rejects(verifyGameThemeAuthoringRun(incomplete.path), /missing required checks: endpoint, root_motion/);
});

test('the same authoring pipeline qualifies an unrelated engine and object vocabulary', async () => {
  const second = await authoringFixture();
  const conceptPath = join(second.root, 'wallpaper-concept.example.json');
  const concept = JSON.parse(await readFile(conceptPath, 'utf8'));
  concept.id = 'second-engine-concept';
  concept.research.engine_summary = 'A second fixture engine stores rooms, avatars and mounts in typed resource bundles.';
  concept.inventory[0].id = 'object.mount';
  concept.inventory[0].label = 'Orbiting mount';
  concept.inventory[1].id = 'object.avatar';
  concept.inventory[1].label = 'Session avatar';
  concept.proposals[0].id = 'proposal.room-orbit';
  concept.decision.proposal_id = 'proposal.room-orbit';
  concept.proposals[0].interactive_object_ids = ['object.mount', 'object.avatar'];
  concept.proposals[0].session_bindings[0].object_id = 'object.mount';
  concept.proposals[0].session_bindings[1].object_id = 'object.avatar';
  concept.proposals[0].pinning.candidate_ids = ['object.mount'];
  const conceptBytes = Buffer.from(JSON.stringify(concept));
  await writeFile(conceptPath, conceptBytes);
  second.document.id = 'second-engine-first-pass';
  second.document.concept.sha256 = crypto.createHash('sha256').update(conceptBytes).digest('hex');
  second.document.engine_profile.engine_id = 'second.engine';
  second.document.engine_profile.revision = 'second-reader@2.0.0';
  second.document.relations.find(item => item.id === 'attachment').axes = ['avatar', 'mount'];
  second.document.scenes = {
    primary: 'scene.room-orbit', witness: 'scene.gallery',
    same_adapter: true, runtime_changes_for_witness: false
  };
  await writeFile(second.path, JSON.stringify(second.document));

  const result = await verifyGameThemeAuthoringRun(second.path);
  assert.equal(result.activation_allowed, true);
  assert.equal(result.id, 'second-engine-first-pass');
});
