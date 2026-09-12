#!/usr/bin/env node
import crypto from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { verifyAnimationSemantics } from './verify-animation-semantics.mjs';
import { verifyWallpaperConcept } from './verify-wallpaper-concept.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_GATES = Object.freeze([
  'input_integrity', 'engine_research', 'inventory_closure', 'coordinate_probe',
  'dependency_closure', 'source_relations', 'conversion_determinism', 'witness_scene',
  'animation_semantics', 'effect_semantics', 'ui_generation', 'session_identity',
  'isolated_runtime', 'visual_matrix', 'interaction_matrix', 'pause_occlusion',
  'native_activation'
]);
const REQUIRED_RELATIONS = Object.freeze([
  'placement', 'attachment', 'effect_origin', 'interactive_hit_region'
]);
const REQUIRED_CHECKS = Object.freeze({
  input_integrity: ['source_hash'],
  engine_research: ['primary_source'],
  inventory_closure: ['inventory_complete'],
  coordinate_probe: ['asymmetric_transform'],
  dependency_closure: ['closure_complete'],
  source_relations: ['matrix_complete'],
  conversion_determinism: ['canonical_hash_match'],
  witness_scene: ['distinct_scene', 'runtime_hash_match'],
  animation_semantics: ['clip_manifest', 'timing', 'playback', 'endpoint', 'seam', 'root_motion', 'events', 'transitions'],
  effect_semantics: ['cardinality', 'sockets', 'timing'],
  ui_generation: ['catalog_projection', 'unresolved_choices'],
  session_identity: ['stable_identity', 'typed_intents'],
  isolated_runtime: ['active_untouched', 'candidate_isolated'],
  visual_matrix: ['matrix_complete'],
  interaction_matrix: ['matrix_complete'],
  pause_occlusion: ['zero_submissions'],
  native_activation: ['active_receipt']
});

async function regularFile(path, maximum = 4_194_304) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
    throw new Error(`bounded regular file required: ${path}`);
  }
  return readFile(path);
}

async function regularJSON(path, maximum = 4_194_304) {
  const bytes = await regularFile(path, maximum);
  try { return { document: JSON.parse(bytes.toString('utf8')), bytes }; }
  catch { throw new Error(`invalid JSON: ${path}`); }
}

async function linked(root, path) {
  const output = resolve(root, path);
  const distance = relative(root, output);
  if (distance.startsWith('..') || resolve(output) === resolve(root)) {
    throw new Error('linked evidence escapes authoring run directory');
  }
  const [realRoot, realOutput] = await Promise.all([realpath(root), realpath(output)]);
  const realDistance = relative(realRoot, realOutput);
  if (realDistance.startsWith('..') || realOutput === realRoot) {
    throw new Error('linked evidence escapes authoring run directory');
  }
  return realOutput;
}

export async function verifyGameThemeAuthoringRun(path) {
  const absolute = resolve(path);
  const root = dirname(absolute);
  const [{ document }, { document: schema }, { document: evidenceSchema }] = await Promise.all([
    regularJSON(absolute),
    regularJSON(resolve(repositoryRoot, 'docs/templates/game-theme-authoring-run.schema.json')),
    regularJSON(resolve(repositoryRoot, 'docs/templates/game-theme-authoring-evidence.schema.json'))
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);
  const validateEvidence = ajv.compile(evidenceSchema);
  if (!validate(document)) {
    throw new Error(`authoring run schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const conceptPath = await linked(root, document.concept.path);
  const { document: conceptDocument, bytes: conceptBytes } = await regularJSON(conceptPath);
  const conceptHash = crypto.createHash('sha256').update(conceptBytes).digest('hex');
  if (conceptHash !== document.concept.sha256) throw new Error('concept sha256 mismatch');
  const concept = await verifyWallpaperConcept(conceptPath);
  const sourceIds = new Set(conceptDocument.research.sources.map(source => source.id));

  const animationPath = await linked(root, document.animation_manifest.path);
  const { bytes: animationBytes } = await regularJSON(animationPath);
  if (crypto.createHash('sha256').update(animationBytes).digest('hex') !== document.animation_manifest.sha256) {
    throw new Error('animation manifest sha256 mismatch');
  }
  const animation = await verifyAnimationSemantics(animationPath, sourceIds);

  const gateIds = document.gates.map(gate => gate.id);
  if (JSON.stringify(gateIds) !== JSON.stringify(REQUIRED_GATES)) {
    throw new Error('authoring gates must be complete and ordered');
  }
  const evidenceCache = new Map();
  for (const gate of document.gates) {
    if ((gate.status !== 'pending') !== Boolean(gate.evidence)) {
      throw new Error(`${gate.id} status/evidence mismatch`);
    }
    if (gate.evidence) {
      const evidencePath = await linked(root, gate.evidence.path);
      const { document: evidenceDocument, bytes } = await regularJSON(evidencePath);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== gate.evidence.sha256) {
        throw new Error(`${gate.id} evidence sha256 mismatch`);
      }
      let records = evidenceCache.get(evidencePath);
      if (!records) {
        if (!validateEvidence(evidenceDocument)) {
          throw new Error(`${gate.id} typed evidence: ${validateEvidence.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
        }
        records = new Map();
        for (const record of evidenceDocument.records) {
          if (records.has(record.id)) throw new Error(`duplicate evidence record ${record.id}`);
          records.set(record.id, record);
        }
        evidenceCache.set(evidencePath, records);
      }
      const record = records.get(gate.evidence.record_id);
      if (!record || record.gate !== gate.id) throw new Error(`${gate.id} evidence record mismatch`);
      if (record.verdict !== gate.status) throw new Error(`${gate.id} evidence verdict mismatch`);
      const checkIds = new Set(record.checks.map(check => check.id));
      if (checkIds.size !== record.checks.length) throw new Error(`${gate.id} evidence checks must be unique`);
      const missingChecks = REQUIRED_CHECKS[gate.id].filter(id => !checkIds.has(id));
      if (missingChecks.length) throw new Error(`${gate.id} missing required checks: ${missingChecks.join(', ')}`);
      if (gate.status === 'pass' && record.checks.some(check => check.status !== 'pass')) {
        throw new Error(`${gate.id} pass contains a failed check`);
      }
      if (gate.status === 'fail' && record.checks.every(check => check.status === 'pass')) {
        throw new Error(`${gate.id} fail contains no failed check`);
      }
      const artifactIds = new Set();
      for (const artifact of record.artifacts) {
        if (artifactIds.has(artifact.id)) throw new Error(`${gate.id} artifact ids must be unique`);
        artifactIds.add(artifact.id);
        const artifactPath = await linked(root, artifact.path);
        const artifactBytes = await regularFile(artifactPath);
        if (crypto.createHash('sha256').update(artifactBytes).digest('hex') !== artifact.sha256) {
          throw new Error(`${gate.id} artifact sha256 mismatch`);
        }
      }
    }
  }
  for (const evidenceId of document.engine_profile.evidence_ids) {
    if (!sourceIds.has(evidenceId)) throw new Error(`engine profile references unknown evidence ${evidenceId}`);
  }
  const relationIds = new Set(document.relations.map(item => item.id));
  if (relationIds.size !== document.relations.length) throw new Error('relation family ids must be unique');
  for (const relation of document.relations) {
    for (const evidenceId of relation.evidence_ids) {
      if (!sourceIds.has(evidenceId)) throw new Error(`${relation.id} references unknown evidence ${evidenceId}`);
    }
    if ((relation.status === 'not_applicable') !== (relation.source_kind === 'not_applicable')) {
      throw new Error(`${relation.id} status/source mismatch`);
    }
  }
  const missingRelations = REQUIRED_RELATIONS.filter(id => !relationIds.has(id));
  if (missingRelations.length) throw new Error(`missing relation families: ${missingRelations.join(', ')}`);
  if (document.relations.some(item => ['missing', 'unsupported'].includes(item.status))) {
    throw new Error('unresolved relation family closes qualification');
  }
  if (document.engine_profile.coordinates.up_axis.replace('-', '') ===
      document.engine_profile.coordinates.forward_axis.replace('-', '')) {
    throw new Error('up and forward axes must be distinct');
  }
  const closure = document.engine_profile.dependency_closure;
  if (closure.status === 'complete' && (closure.unresolved !== 0 || closure.resolved !== closure.discovered)) {
    throw new Error('complete dependency closure has unresolved resources');
  }
  if (document.scenes.primary === document.scenes.witness) {
    throw new Error('witness scene must differ from primary scene');
  }

  const preActivation = document.gates.slice(0, -1);
  const relationsComplete = document.relations.every(item => ['qualified', 'not_applicable'].includes(item.status));
  const qualified = concept.generation_allowed && closure.status === 'complete' && relationsComplete &&
    animation.qualified && preActivation.every(gate => gate.status === 'pass');
  const animationGate = document.gates.find(gate => gate.id === 'animation_semantics');
  if (animationGate.status === 'pass' && !animation.qualified) {
    throw new Error('animation semantics gate passed with unresolved clips');
  }
  const activationGate = document.gates.at(-1);
  if (document.activation.attempted && !qualified) {
    throw new Error('native activation attempted before candidate qualification');
  }
  if (document.activation.attempted !== Boolean(document.activation.active_receipt) ||
      (activationGate.status === 'pass') !== document.activation.attempted) {
    throw new Error('native activation receipt/state mismatch');
  }
  if (document.activation.active_receipt) {
    const receiptPath = await linked(root, document.activation.active_receipt.path);
    const { bytes } = await regularJSON(receiptPath);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== document.activation.active_receipt.sha256) {
      throw new Error('native activation receipt sha256 mismatch');
    }
  }
  if (document.status === 'qualified' && !qualified) throw new Error('qualified status without passed pre-activation gates');
  if (document.activation.attempted && document.status !== 'activated') {
    throw new Error('native activation requires activated run status');
  }
  if (document.status === 'activated' && !(qualified && activationGate.status === 'pass')) {
    throw new Error('activated status without complete qualification');
  }

  return {
    ok: true,
    id: document.id,
    status: document.status,
    passed_gates: document.gates.filter(gate => gate.status === 'pass').length,
    generation_allowed: concept.generation_allowed,
    activation_allowed: qualified,
    activation_attempted: document.activation.attempted
  };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: verify-game-theme-authoring-run RUN.json');
  process.stdout.write(`${JSON.stringify(await verifyGameThemeAuthoringRun(process.argv[2]), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
