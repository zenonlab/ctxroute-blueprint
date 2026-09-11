#!/usr/bin/env node
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySourceRelations } from './verify-source-relations.mjs';
import { verifyVisualQualification } from './verify-visual-qualification.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function regularJSON(path, maximum = 1_048_576, root = null) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1 || metadata.size > maximum) {
    throw new Error(`bounded regular JSON required: ${path}`);
  }
  const canonical = await realpath(path);
  if (root) {
    const distance = relative(root, canonical);
    if (distance.startsWith('..') || isAbsolute(distance)) throw new Error('evidence path escapes correction record directory');
  }
  const bytes = await readFile(canonical);
  try { return { value: JSON.parse(bytes.toString('utf8')), bytes, canonical }; }
  catch { throw new Error(`invalid JSON: ${path}`); }
}

function linked(base, value) {
  const path = resolve(base, value);
  const distance = relative(base, path);
  if (isAbsolute(value) || distance.startsWith('..') || isAbsolute(distance)) {
    throw new Error('evidence path escapes correction record directory');
  }
  return path;
}

export async function verifyCorrectionRecord(path, { checkLinks = true } = {}) {
  const absolute = resolve(path);
  const root = await realpath(dirname(absolute));
  const [recordFile, schemaFile] = await Promise.all([
    regularJSON(absolute),
    regularJSON(resolve(repositoryRoot, 'docs/templates/correction-record.schema.json'))
  ]);
  const record = recordFile.value;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schemaFile.value);
  if (!validate(record)) {
    throw new Error(`correction record schema: ${validate.errors.map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }

  const failures = record.validations.filter(validation => validation.exit_code !== 0);
  let artifact = null;
  let visual = null;
  let relations = null;
  if (checkLinks) {
    const artifactFile = await regularJSON(linked(root, record.active_artifact_receipt), 1_048_576, root);
    artifact = artifactFile.value;
    if (!['orbite.active-theme-receipt/1', 'orbite.active-theme-receipt/2'].includes(artifact.format)) {
      throw new Error('invalid active artifact receipt');
    }
    if (record.source_relations) {
      const relationsPath = linked(root, record.source_relations);
      relations = await verifySourceRelations(relationsPath);
    }
    if (record.visual_qualification) {
      const visualPath = linked(root, record.visual_qualification);
      const visualFile = await regularJSON(visualPath, 1_048_576, root);
      visual = visualFile.value;
      await verifyVisualQualification(visualPath);
      const receiptDigest = createHash('sha256').update(artifactFile.bytes).digest('hex');
      if (visual.artifact_receipt_sha256 !== receiptDigest) {
        throw new Error('visual qualification references a different active artifact receipt');
      }
    }
  }
  const artifactVerified = artifact?.format === 'orbite.active-theme-receipt/2' ?
    artifact.integrity_verified === true : artifact?.qualified === true;
  const spatialCorrection = record.source_of_truth.coordinate_space !== null &&
    record.source_of_truth.coordinate_space !== undefined;
  if (record.status === 'qualified' && (failures.length > 0 || record.unknowns?.length ||
      !record.visual_qualification || (artifact && !artifactVerified) ||
      (spatialCorrection && (!record.source_relations || relations?.status !== 'qualified')) ||
      (visual && visual.verdict !== 'qualified'))) {
    throw new Error('qualified correction contains failed, unknown, experimental, or unqualified evidence');
  }
  return { ok: true, id: record.id, status: record.status, validations: record.validations.length,
    linked_evidence_checked: checkLinks };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('usage: verify-correction-record RECORD.json');
  process.stdout.write(`${JSON.stringify(await verifyCorrectionRecord(process.argv[2]), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
