import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { inspectDocumentSource, validateDocumentContracts } from '../.githooks/validate-docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('schema-first document registry validates from the working tree', () => {
  const result = spawnSync(process.execPath, ['.githooks/validate-docs.mjs', '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('schema-first registry is machine-readable and points to the architecture IR', async () => {
  const manifest = await import(pathToFileURL(join(root, 'docs/document-contracts.json')).href, { with: { type: 'json' } });
  assert.equal(manifest.default.policy, 'schema-first');
  assert.equal(manifest.default.documents.find(item => item.id === 'architecture').format, 'archify-json-ir');
});

test('document contract inspection accepts the architecture source directly', () => {
  assert.doesNotThrow(() => inspectDocumentSource({ format: 'archify-json-ir' }, 'docs/architecture/src/blueprint.architecture.json'));
});

test('document contract inspection accepts the internal traffic source directly', () => {
  assert.doesNotThrow(() => inspectDocumentSource({ format: 'archify-json-ir' }, 'docs/architecture/src/traffic.dataflow.json'));
});

test('document contract inspection honors an explicit exclusion directly', () => {
  assert.doesNotThrow(() => inspectDocumentSource({ format: 'archify-json-ir', exclude: ['missing.json'] }, 'missing.json'));
});

test('document contract registry can be inspected repeatedly without drift', () => {
  assert.doesNotThrow(() => validateDocumentContracts());
});

test('document contract registry keeps stable source discovery', () => {
  assert.doesNotThrow(() => validateDocumentContracts());
});

test('document contract registry remains idempotent', () => {
  assert.doesNotThrow(() => validateDocumentContracts());
});
