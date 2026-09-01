import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listArchifyDiagrams, productDiagramViolations, selectArchifyDiagrams } from '../scripts/archify-registry.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Archify registry discovers every typed source in stable order', () => {
  const diagrams = listArchifyDiagrams(root);
  assert.deepEqual(diagrams.map(diagram => diagram.id), ['blueprint.architecture', 'sensor.dataflow', 'traffic.dataflow']);
  assert.deepEqual(diagrams.map(diagram => diagram.type), ['architecture', 'dataflow', 'dataflow']);
  assert.deepEqual(diagrams.map(diagram => diagram.audience), ['internal', 'internal', 'internal']);
});

test('product diagrams reject blueprint control-plane names', () => {
  assert.deepEqual(productDiagramViolations({ label: 'Customer API' }), []);
  assert.deepEqual(productDiagramViolations({ nodes: ['CTXRoute', 'Progress MCP', 'Stop hook'] }), ['CTXRoute', 'Progress MCP', 'agent hooks']);
});

test('Archify selector keeps internal sources out of every product selection', () => {
  assert.equal(selectArchifyDiagrams('internal', root).length, 3);
  assert.equal(selectArchifyDiagrams('all', root).length, 0);
  assert.throws(() => selectArchifyDiagrams('traffic', root), /Unknown product Archify diagram/u);
  assert.throws(() => selectArchifyDiagrams('architecture', root), /Unknown product Archify diagram/u);
  assert.throws(() => selectArchifyDiagrams('missing', root), /Unknown product Archify diagram/u);
});

test('Archify discovery fails closed for malformed or untyped sources', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'archify-registry-'));
  mkdirSync(join(fixture, '.project'), { recursive: true });
  mkdirSync(join(fixture, 'docs/architecture/src'), { recursive: true });
  writeFileSync(join(fixture, '.project/project-config.json'), JSON.stringify({ architecture: { documents: [], internalDocuments: [] } }));
  writeFileSync(join(fixture, 'docs/architecture/src/broken.json'), '{');
  assert.throws(() => listArchifyDiagrams(fixture), /invalid Archify JSON source/u);
  writeFileSync(join(fixture, 'docs/architecture/src/broken.json'), '{}');
  assert.throws(() => listArchifyDiagrams(fixture), /unsupported Archify diagram_type/u);
});

test('Archify discovery rejects undeclared and overlapping audiences', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'archify-audience-'));
  mkdirSync(join(fixture, '.project'), { recursive: true });
  mkdirSync(join(fixture, 'docs/architecture/src'), { recursive: true });
  const source = 'docs/architecture/src/product.architecture.json';
  writeFileSync(join(fixture, source), JSON.stringify({ schema_version: 1, diagram_type: 'architecture' }));
  writeFileSync(join(fixture, '.project/project-config.json'), JSON.stringify({ architecture: { documents: [], internalDocuments: [] } }));
  assert.throws(() => listArchifyDiagrams(fixture), /not declared/u);
  writeFileSync(join(fixture, '.project/project-config.json'), JSON.stringify({ architecture: { documents: [source], internalDocuments: [source] } }));
  assert.throws(() => listArchifyDiagrams(fixture), /both product and internal/u);
});

test('Archify CLI cannot publish an internal diagram', () => {
  for (const command of ['build', 'visual-check', 'preview']) {
    const result = spawnSync(process.execPath, ['.githooks/archify', command, 'internal'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /validation-only/u, command);
  }
});

test('Archify product-wide commands are explicit no-ops before initialization', () => {
  for (const command of ['validate', 'build', 'visual-check']) {
    const result = spawnSync(process.execPath, ['.githooks/archify', command, 'all'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    assert.match(result.stdout, /"diagrams":0/u, command);
  }
  const preview = spawnSync(process.execPath, ['.githooks/archify', 'preview', 'all'], { cwd: root, encoding: 'utf8' });
  assert.equal(preview.status, 1);
  assert.match(preview.stderr, /No product Archify diagram/u);
});
