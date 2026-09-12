#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requiredSubsystems = Object.freeze([
  'engine_core', 'archives', 'scene_graph', 'geometry', 'materials', 'textures',
  'animation', 'collision', 'placement', 'effects', 'audio', 'ui', 'behavior'
]);

async function boundedJSON(path, maximum = 4_194_304) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
    throw new Error(`bounded regular JSON required: ${path}`);
  }
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new Error(`invalid JSON: ${path}`); }
}

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

export async function verifyWallpaperConcept(path) {
  const [document, schema] = await Promise.all([
    boundedJSON(resolve(path)),
    boundedJSON(resolve(repositoryRoot, 'docs/templates/wallpaper-concept.schema.json'))
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(document)) {
    throw new Error(`wallpaper concept schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const sources = new Map(document.research.sources.map(source => [source.id, source]));
  unique([...sources.keys()], 'research source ids');
  if (![...sources.values()].some(source => ['official_documentation', 'public_implementation'].includes(source.classification))) {
    throw new Error('engine research requires primary documentation or implementation evidence');
  }
  if (![...sources.values()].some(source => source.classification === 'local_observation')) {
    throw new Error('engine research requires a local corpus observation');
  }
  const subsystemIds = document.research.subsystems.map(subsystem => subsystem.id);
  unique(subsystemIds, 'research subsystem ids');
  const missingSubsystems = requiredSubsystems.filter(id => !subsystemIds.includes(id));
  if (missingSubsystems.length) throw new Error(`engine research misses required subsystems: ${missingSubsystems.join(', ')}`);
  for (const subsystem of document.research.subsystems) {
    for (const evidenceId of subsystem.evidence_ids) {
      if (!sources.has(evidenceId)) throw new Error(`${subsystem.id} references unknown evidence ${evidenceId}`);
    }
    if (subsystem.status === 'studied' && subsystem.evidence_ids.every(id => sources.get(id).classification === 'hypothesis')) {
      throw new Error(`${subsystem.id} cannot be studied from hypotheses alone`);
    }
    if (subsystem.fidelity_target === 'not_applicable' && subsystem.status !== 'not_applicable') {
      throw new Error(`${subsystem.id} fidelity/status mismatch`);
    }
    if (subsystem.status === 'not_applicable' && subsystem.fidelity_target !== 'not_applicable') {
      throw new Error(`${subsystem.id} not_applicable requires a matching fidelity target`);
    }
  }

  const inventory = new Map(document.inventory.map(item => [item.id, item]));
  unique([...inventory.keys()], 'inventory ids');
  for (const item of inventory.values()) {
    for (const evidenceId of item.evidence_ids) {
      if (!sources.has(evidenceId)) throw new Error(`${item.id} references unknown evidence ${evidenceId}`);
    }
  }

  unique(document.proposals.map(proposal => proposal.id), 'proposal ids');
  for (const proposal of document.proposals) {
    const bindings = new Map();
    for (const binding of proposal.session_bindings) {
      if (bindings.has(binding.object_id)) throw new Error(`${proposal.id} duplicates session binding for ${binding.object_id}`);
      const item = inventory.get(binding.object_id);
      if (!item) throw new Error(`${proposal.id} binds unknown object ${binding.object_id}`);
      if (!item.supports_session) throw new Error(`${proposal.id} binds session-ineligible object ${binding.object_id}`);
      bindings.set(binding.object_id, binding);
    }
    for (const objectId of proposal.interactive_object_ids) {
      if (!inventory.has(objectId)) throw new Error(`${proposal.id} uses unknown interactive object ${objectId}`);
      if (!bindings.has(objectId)) throw new Error(`${proposal.id} interactive object ${objectId} has no session binding`);
    }
    for (const objectId of proposal.pinning.candidate_ids) {
      const item = inventory.get(objectId);
      if (!item) throw new Error(`${proposal.id} pins unknown object ${objectId}`);
      if (!item.supports_pin) throw new Error(`${proposal.id} pins ineligible object ${objectId}`);
      if (!bindings.has(objectId)) throw new Error(`${proposal.id} pinned object ${objectId} has no session binding`);
    }
  }

  const proposalIds = new Set(document.proposals.map(proposal => proposal.id));
  const accepted = document.status === 'accepted' && document.decision.status === 'accepted';
  if (accepted && (document.decision.decided_by !== 'user' || !proposalIds.has(document.decision.proposal_id))) {
    throw new Error('accepted concept requires a user-selected proposal');
  }
  if ((document.status === 'accepted') !== (document.decision.status === 'accepted')) {
    throw new Error('concept and decision acceptance states disagree');
  }
  if ((document.status === 'rejected') !== (document.decision.status === 'rejected')) {
    throw new Error('concept and decision rejection states disagree');
  }
  const unresolved = document.research.subsystems
    .filter(subsystem => ['missing', 'unsupported'].includes(subsystem.status))
    .map(subsystem => subsystem.id);
  const generationAllowed = accepted && unresolved.length === 0;

  return {
    ok: true,
    id: document.id,
    status: document.status,
    selected_proposal: accepted ? document.decision.proposal_id : null,
    researched_subsystems: subsystemIds.length,
    inventory_items: inventory.size,
    unresolved_subsystems: unresolved,
    generation_allowed: generationAllowed
  };
}

async function main() {
  if (process.argv.length > 3) throw new Error('usage: verify-wallpaper-concept [CONCEPT.json]');
  const conceptPath = process.argv[2]
    ?? resolve(repositoryRoot, 'docs/templates/wallpaper-concept.example.json');
  process.stdout.write(`${JSON.stringify(await verifyWallpaperConcept(conceptPath), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
