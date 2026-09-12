#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOOP_MODES = new Set(['loop', 'ping_pong_loop']);
const LOOP_PHASES = ['start', 'repeat_start', 'pre_end', 'post_wrap'];

function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function knownEvidence(ids, allowed, label) {
  if (!allowed) return;
  for (const id of ids) if (!allowed.has(id)) throw new Error(`${label} references unknown evidence ${id}`);
}

async function boundedText(path, maximum = 8_388_608) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
    throw new Error(`bounded regular animation manifest required: ${path}`);
  }
  return readFile(path, 'utf8');
}

export async function verifyAnimationSemantics(path, allowedEvidenceIds = null) {
  const [documentText, schemaText] = await Promise.all([
    boundedText(resolve(path)),
    boundedText(resolve(repositoryRoot, 'docs/templates/animation-semantics.schema.json'))
  ]);
  let document;
  try { document = JSON.parse(documentText); }
  catch { throw new Error(`invalid animation semantics JSON: ${path}`); }
  const schema = JSON.parse(schemaText);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(document)) {
    throw new Error(`animation semantics schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const evidence = allowedEvidenceIds ? new Set(allowedEvidenceIds) : null;
  knownEvidence(document.source_revision.evidence_ids, evidence, 'animation source revision');
  unique(document.clips.map(clip => clip.id), 'animation clip ids');
  const clips = new Map(document.clips.map(clip => [clip.id, clip]));

  for (const clip of document.clips) {
    knownEvidence(clip.evidence_ids, evidence, clip.id);
    const { start_tick: start, end_tick: end } = clip.timing;
    if (end <= start) throw new Error(`${clip.id} end_tick must be greater than start_tick`);
    const looping = LOOP_MODES.has(clip.playback.mode);
    const repeat = clip.playback.repeat_start_tick;
    if (looping && (repeat === null || repeat < start || repeat >= end)) {
      throw new Error(`${clip.id} loop requires repeat_start_tick inside its sample domain`);
    }
    if (!looping && repeat !== null) throw new Error(`${clip.id} non-loop must not declare repeat_start_tick`);
    if (looping && clip.playback.completion !== 'not_applicable') {
      throw new Error(`${clip.id} loop completion must be not_applicable`);
    }
    if (!looping && clip.playback.completion === 'not_applicable') {
      throw new Error(`${clip.id} non-loop requires an explicit completion policy`);
    }
    if (clip.playback.mode === 'once_reset' && clip.playback.completion !== 'reset') {
      throw new Error(`${clip.id} once_reset playback requires reset completion`);
    }

    const root = clip.root_motion;
    if (root.owner === 'none' && (root.applied_by !== null || root.channels.length !== 0)) {
      throw new Error(`${clip.id} root motion none must have no applier or channels`);
    }
    if (root.owner !== 'none' && (root.applied_by === null || root.channels.length === 0)) {
      throw new Error(`${clip.id} root motion requires exactly one named applier and explicit channels`);
    }

    unique(clip.events.map(event => event.id), `${clip.id} event ids`);
    for (const event of clip.events) {
      if (event.tick < start || event.tick > end ||
          (clip.timing.endpoint_policy === 'exclusive' && event.tick === end)) {
        throw new Error(`${clip.id}/${event.id} lies outside the source sample domain`);
      }
      knownEvidence(event.evidence_ids, evidence, `${clip.id}/${event.id}`);
    }
    unique(clip.probes.map(probe => probe.phase), `${clip.id} probe phases`);
    const phases = new Set(clip.probes.map(probe => probe.phase));
    if (!phases.has('start')) throw new Error(`${clip.id} requires a start probe`);
    for (const probe of clip.probes) {
      if (probe.tick < start || probe.tick > end ||
          (clip.timing.endpoint_policy === 'exclusive' && probe.tick === end)) {
        throw new Error(`${clip.id}/${probe.phase} probe lies outside the source sample domain`);
      }
    }
    if (looping) {
      const missing = LOOP_PHASES.filter(phase => !phases.has(phase));
      if (missing.length) throw new Error(`${clip.id} loop misses seam probes: ${missing.join(', ')}`);
      if (clip.seam.status !== 'pass' || !clip.seam.maximum || !clip.seam.measured) {
        throw new Error(`${clip.id} loop requires measured passing seam limits`);
      }
      for (const key of Object.keys(clip.seam.maximum)) {
        if (clip.seam.measured[key] > clip.seam.maximum[key]) {
          throw new Error(`${clip.id} seam ${key} exceeds its declared limit`);
        }
      }
    } else {
      if (!phases.has('endpoint')) throw new Error(`${clip.id} non-loop requires an endpoint probe`);
      if (clip.seam.status !== 'not_applicable' || clip.seam.maximum !== null || clip.seam.measured !== null) {
        throw new Error(`${clip.id} non-loop must mark seam not_applicable`);
      }
    }
  }

  unique(document.transitions.map(transition => transition.id), 'animation transition ids');
  for (const transition of document.transitions) {
    const from = clips.get(transition.from_clip_id);
    if (!from || !clips.has(transition.to_clip_id)) throw new Error(`${transition.id} references an unknown clip`);
    knownEvidence(transition.evidence_ids, evidence, transition.id);
    if (transition.trigger === 'event') {
      if (transition.event_id === null || !from.events.some(event => event.id === transition.event_id)) {
        throw new Error(`${transition.id} references an unknown source event`);
      }
    } else if (transition.event_id !== null) {
      throw new Error(`${transition.id} declares an event for a non-event trigger`);
    }
  }
  for (const clip of document.clips) {
    if (clip.playback.completion === 'transition' &&
        !document.transitions.some(transition => transition.from_clip_id === clip.id && transition.trigger === 'clip_end')) {
      throw new Error(`${clip.id} transition completion has no clip_end transition`);
    }
  }

  const unresolved = document.clips.filter(clip => clip.status !== 'qualified').map(clip => clip.id);
  const qualified = unresolved.length === 0;
  if ((document.status === 'qualified') !== qualified) {
    throw new Error('animation manifest status does not match clip qualification');
  }
  return { ok: true, status: document.status, clips: document.clips.length, transitions: document.transitions.length, unresolved, qualified };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: verify-animation-semantics ANIMATIONS.json');
  process.stdout.write(`${JSON.stringify(await verifyAnimationSemantics(process.argv[2]), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
