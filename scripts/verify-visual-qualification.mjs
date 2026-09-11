#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function boundedJSON(path, maximum = 1_048_576) {
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
  if (output.length > 64) throw new Error('visual matrix exceeds 64 cells');
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

function cellKey(coordinates, axisIds) {
  return axisIds.map(id => `${id}=${coordinates[id]}`).join('|');
}

export async function verifyVisualQualification(path) {
  const [document, schema] = await Promise.all([
    boundedJSON(resolve(path)),
    boundedJSON(resolve(repositoryRoot, 'docs/templates/visual-qualification.schema.json'))
  ]);
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(document)) {
    throw new Error(`visual qualification schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const axisIds = document.axes.map(axis => axis.id);
  unique(axisIds, 'visual axis ids');
  unique(document.captures.map(capture => capture.id), 'capture ids');
  const axes = new Map(document.axes.map(axis => [axis.id, new Set(axis.values)]));
  const cells = new Map();
  for (const capture of document.captures) {
    const coordinateIds = Object.keys(capture.coordinates).sort();
    if (coordinateIds.join('\0') !== [...axisIds].sort().join('\0')) {
      throw new Error(`${capture.id} coordinates must cover every declared visual axis exactly once`);
    }
    for (const [axis, value] of Object.entries(capture.coordinates)) {
      if (!axes.get(axis)?.has(value)) throw new Error(`${capture.id} uses undeclared coordinate ${axis}=${value}`);
    }
    const assertionKinds = capture.assertions.map(assertion => assertion.kind);
    unique(assertionKinds, `${capture.id} assertion kinds`);
    const missingAssertions = document.required_assertions.filter(kind => !assertionKinds.includes(kind));
    if (missingAssertions.length > 0) {
      throw new Error(`${capture.id} misses required assertions: ${missingAssertions.join(', ')}`);
    }
    const assertionFailures = capture.assertions.filter(assertion => assertion.result !== 'pass');
    if ((capture.result === 'pass') !== (assertionFailures.length === 0)) {
      throw new Error(`${capture.id} result disagrees with its assertions`);
    }
    const key = cellKey(capture.coordinates, axisIds);
    if (cells.has(key)) throw new Error(`duplicate visual matrix cell ${key}`);
    cells.set(key, capture);
  }

  const expected = combinations(document.axes).map(coordinates => cellKey(coordinates, axisIds));
  const missing = expected.filter(key => !cells.has(key));
  if (missing.length > 0) throw new Error(`visual matrix is incomplete: ${missing.slice(0, 3).join(', ')}`);
  if (cells.size !== expected.length) throw new Error('visual matrix contains unexpected cells');
  const allPass = [...cells.values()].every(capture => capture.result === 'pass');
  if ((document.verdict === 'qualified') !== allPass) {
    throw new Error('visual verdict disagrees with matrix results');
  }

  return { ok: true, verdict: document.verdict, axes: document.axes.length, cells: cells.size };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: verify-visual-qualification QUALIFICATION.json');
  process.stdout.write(`${JSON.stringify(await verifyVisualQualification(process.argv[2]), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
