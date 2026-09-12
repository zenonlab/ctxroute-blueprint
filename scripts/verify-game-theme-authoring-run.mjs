#!/usr/bin/env node
import crypto from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
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

async function regularJSON(path, maximum = 4_194_304) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
    throw new Error(`bounded regular JSON required: ${path}`);
  }
  const bytes = await readFile(path);
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
  const [{ document }, { document: schema }] = await Promise.all([
    regularJSON(absolute),
    regularJSON(resolve(repositoryRoot, 'docs/templates/game-theme-authoring-run.schema.json'))
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(document)) {
    throw new Error(`authoring run schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const conceptPath = await linked(root, document.concept.path);
  const { document: conceptDocument, bytes: conceptBytes } = await regularJSON(conceptPath);
  const conceptHash = crypto.createHash('sha256').update(conceptBytes).digest('hex');
  if (conceptHash !== document.concept.sha256) throw new Error('concept sha256 mismatch');
  const concept = await verifyWallpaperConcept(conceptPath);

  const gateIds = document.gates.map(gate => gate.id);
  if (JSON.stringify(gateIds) !== JSON.stringify(REQUIRED_GATES)) {
    throw new Error('authoring gates must be complete and ordered');
  }
  for (const gate of document.gates) {
    if ((gate.status !== 'pending') !== Boolean(gate.evidence)) {
      throw new Error(`${gate.id} status/evidence mismatch`);
    }
    if (gate.evidence) {
      const evidencePath = await linked(root, gate.evidence.path);
      const { bytes } = await regularJSON(evidencePath);
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== gate.evidence.sha256) {
        throw new Error(`${gate.id} evidence sha256 mismatch`);
      }
    }
  }
  const sourceIds = new Set(conceptDocument.research.sources.map(source => source.id));
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
    preActivation.every(gate => gate.status === 'pass');
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
