#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function boundedJSON(path, maximum = 8_388_608) {
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

function combinations(axes, index = 0, current = {}, output = []) {
  if (output.length > 2048) throw new Error('relation matrix exceeds 2048 combinations');
  if (index === axes.length) {
    output.push({ ...current });
    return output;
  }
  const axis = axes[index];
  for (const value of axis.values) {
    current[axis.id] = value;
    combinations(axes, index + 1, current, output);
  }
  delete current[axis.id];
  return output;
}

function coordinatesKey(coordinates, axisIds, relationKind) {
  return `${axisIds.map(id => `${id}=${coordinates[id]}`).join('|')}|relation=${relationKind}`;
}

export async function verifySourceRelations(path) {
  const [document, schema] = await Promise.all([
    boundedJSON(resolve(path)),
    boundedJSON(resolve(repositoryRoot, 'docs/templates/source-relations.schema.json'))
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(document)) {
    throw new Error(`source relations schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const axisIds = document.axes.map(axis => axis.id);
  const relationIds = document.relation_kinds.map(relation => relation.id);
  unique(axisIds, 'axis ids');
  unique(relationIds, 'relation kind ids');
  unique(document.entries.map(entry => entry.id), 'entry ids');
  unique(document.sources.map(source => source.id), 'source ids');
  const sources = new Map(document.sources.map(source => [source.id, source]));
  const sourceHashes = new Set(document.sources.map(source => source.sha256));
  if (![...sources.values()].some(source => source.classification === 'input' &&
      source.sha256 === document.artifact.source_sha256)) {
    throw new Error('artifact source is absent from the source inventory');
  }
  for (const source of sources.values()) {
    if (source.parent_sha256 && !sourceHashes.has(source.parent_sha256)) {
      throw new Error(`${source.id} references an unknown parent source`);
    }
    if (document.status === 'qualified' && source.classification !== 'input' && !source.parent_sha256) {
      throw new Error(`${source.id} qualified derivative is missing its parent source`);
    }
  }
  for (const relation of document.relation_kinds) {
    if (relation.minimum > relation.maximum) throw new Error(`invalid cardinality for ${relation.id}`);
  }

  const axes = new Map(document.axes.map(axis => [axis.id, new Set(axis.values)]));
  const relations = new Map(document.relation_kinds.map(relation => [relation.id, relation]));
  const entries = new Map();
  for (const entry of document.entries) {
    const coordinateIds = Object.keys(entry.coordinates).sort();
    if (coordinateIds.join('\0') !== [...axisIds].sort().join('\0')) {
      throw new Error(`${entry.id} coordinates must cover every declared axis exactly once`);
    }
    for (const [axis, value] of Object.entries(entry.coordinates)) {
      if (!axes.get(axis)?.has(value)) throw new Error(`${entry.id} uses undeclared coordinate ${axis}=${value}`);
    }
    const relation = relations.get(entry.relation_kind);
    if (!relation) throw new Error(`${entry.id} uses undeclared relation kind`);
    const source = sources.get(entry.derivation.source_id);
    if (!source || source.sha256 !== entry.derivation.source_sha256 ||
        source.reference !== entry.derivation.reference) {
      throw new Error(`${entry.id} derivation does not match its inventoried source`);
    }
    const expectedClassification = {
      source_table: 'table', source_code: 'code', source_metadata: 'metadata',
      geometry: 'geometry', observation: 'observation'
    }[entry.derivation.kind];
    if (source.classification !== expectedClassification) {
      throw new Error(`${entry.id} derivation classification does not match its source`);
    }
    if (entry.status === 'resolved') {
      if (entry.placements.length < relation.minimum || entry.placements.length > relation.maximum) {
        throw new Error(`${entry.id} violates ${entry.relation_kind} cardinality`);
      }
      unique(entry.placements.map(placement => placement.id), `${entry.id} placement ids`);
      if (entry.placements.some(placement => placement.scale.some(value => value <= 0))) {
        throw new Error(`${entry.id} contains a non-positive scale`);
      }
    } else if (entry.placements.length !== 0) {
      throw new Error(`${entry.id} unresolved relation must not contain placements`);
    }
    if (document.status === 'qualified' &&
        (!['resolved', 'not_applicable'].includes(entry.status) ||
         ['geometry', 'observation'].includes(entry.derivation.kind))) {
      throw new Error(`${entry.id} is not source-qualified`);
    }
    const key = coordinatesKey(entry.coordinates, axisIds, entry.relation_kind);
    if (entries.has(key)) throw new Error(`duplicate relation matrix cell ${key}`);
    entries.set(key, entry);
  }

  const expected = combinations(document.axes).flatMap(coordinates =>
    relationIds.map(relation => coordinatesKey(coordinates, axisIds, relation)));
  const missing = expected.filter(key => !entries.has(key));
  if (missing.length > 0) throw new Error(`relation matrix is incomplete: ${missing.slice(0, 3).join(', ')}`);
  if (entries.size !== expected.length) throw new Error('relation matrix contains unexpected cells');

  return {
    ok: true,
    id: document.id,
    status: document.status,
    axes: document.axes.length,
    relation_kinds: document.relation_kinds.length,
    cells: entries.size
  };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: verify-source-relations RELATIONS.json');
  process.stdout.write(`${JSON.stringify(await verifySourceRelations(process.argv[2]), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
