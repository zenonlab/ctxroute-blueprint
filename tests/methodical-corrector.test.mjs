import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { inspectActiveTheme } from '../scripts/verify-active-theme.mjs';
import { verifyCorrectionRecord } from '../scripts/verify-correction-record.mjs';
import { verifySourceRelations } from '../scripts/verify-source-relations.mjs';
import { verifyVisualQualification } from '../scripts/verify-visual-qualification.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');

test('documentation examples satisfy their schemas', async () => {
  for (const name of ['correction-record', 'source-relations', 'visual-qualification', 'theme-interface-v5']) {
    const schema = JSON.parse(await readFile(`docs/templates/${name}.schema.json`, 'utf8'));
    const example = JSON.parse(await readFile(`docs/templates/${name}.example.json`, 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.equal(validate(example), true, JSON.stringify(validate.errors));
  }
});

test('active theme receipt hashes contained artifacts and rejects experimental values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-active-theme-'));
  const entry = Buffer.from('{"format":"orbite.scene-probe/1","status":"experimental"}\n');
  const ui = Buffer.from('{"format":"orbite.theme-interface/5"}\n');
  await writeFile(join(root, 'entry.json'), entry);
  await writeFile(join(root, 'interface.json'), ui);
  await writeFile(join(root, 'orbite-theme.json'), JSON.stringify({
    format: 'orbite.theme-package/1', id: 'fixture.theme', display_name: 'Fixture',
    entry: { format: 'orbite.scene-probe/1', path: 'entry.json' }, renderer: 'fixture.renderer',
    interface: 'interface.json'
  }));
  const receipt = await inspectActiveTheme({ packagePath: join(root, 'orbite-theme.json') });
  assert.equal(receipt.integrity_verified, false);
  assert.equal(receipt.qualification, 'unreviewed');
  assert.equal(receipt.format, 'orbite.active-theme-receipt/2');
  assert.equal(receipt.artifacts.find(value => value.label === 'entry').sha256, digest(entry));
  assert.deepEqual(receipt.experimental_fields, ['entry:$']);
});

test('active theme receipt refuses traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-active-theme-'));
  await writeFile(join(root, 'orbite-theme.json'), JSON.stringify({
    format: 'orbite.theme-package/1', id: 'fixture.theme', display_name: 'Fixture',
    renderer: 'fixture.renderer',
    entry: { format: 'orbite.scene-probe/1', path: '../outside.json' }
  }));
  await assert.rejects(inspectActiveTheme({ packagePath: join(root, 'orbite-theme.json') }), /escapes root/);
});

test('active theme receipt refuses a descriptor and entry format mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-active-theme-'));
  await writeFile(join(root, 'entry.json'), '{"format":"orbite.other/1"}');
  await writeFile(join(root, 'orbite-theme.json'), JSON.stringify({
    format: 'orbite.theme-package/1', id: 'fixture.theme', display_name: 'Fixture',
    renderer: 'fixture.renderer',
    entry: { format: 'orbite.scene-probe/1', path: 'entry.json' }
  }));
  await assert.rejects(inspectActiveTheme({ packagePath: join(root, 'orbite-theme.json') }),
    /format does not match/);
});

test('active theme receipt refuses a symlinked package artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-active-theme-'));
  const outside = join(await mkdtemp(join(tmpdir(), 'orbite-outside-')), 'entry.json');
  await writeFile(outside, '{"format":"orbite.scene-probe/1"}');
  await symlink(outside, join(root, 'entry.json'));
  await writeFile(join(root, 'orbite-theme.json'), JSON.stringify({
    format: 'orbite.theme-package/1', id: 'fixture.theme', display_name: 'Fixture',
    renderer: 'fixture.renderer',
    entry: { format: 'orbite.scene-probe/1', path: 'entry.json' }
  }));
  await assert.rejects(inspectActiveTheme({ packagePath: join(root, 'orbite-theme.json') }),
    /bounded regular file|required|escapes root/);
});

test('qualified correction requires qualified linked evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-correction-'));
  const example = JSON.parse(await readFile('docs/templates/correction-record.example.json', 'utf8'));
  example.active_artifact_receipt = 'active.json';
  example.source_relations = 'relations.json';
  example.visual_qualification = 'visual.json';
  await writeFile(join(root, 'record.json'), JSON.stringify(example));
  const active = JSON.stringify({
    format: 'orbite.active-theme-receipt/2', integrity_verified: true, qualification: 'unreviewed'
  });
  await writeFile(join(root, 'active.json'), active);
  const relations = JSON.parse(await readFile('docs/templates/source-relations.example.json', 'utf8'));
  await writeFile(join(root, 'relations.json'), JSON.stringify(relations));
  const visual = JSON.parse(await readFile('docs/templates/visual-qualification.example.json', 'utf8'));
  visual.artifact_receipt_sha256 = digest(active);
  await writeFile(join(root, 'visual.json'), JSON.stringify(visual));
  assert.equal((await verifyCorrectionRecord(join(root, 'record.json'))).ok, true);
  const broken = { ...example, unknowns: ['coordinate space unresolved'] };
  await writeFile(join(root, 'broken.json'), JSON.stringify(broken));
  await assert.rejects(verifyCorrectionRecord(join(root, 'broken.json')), /unknown/);

  visual.artifact_receipt_sha256 = 'f'.repeat(64);
  await writeFile(join(root, 'visual.json'), JSON.stringify(visual));
  await assert.rejects(verifyCorrectionRecord(join(root, 'record.json')), /different active artifact/);
});

test('source relation qualification requires complete source-derived matrix cells', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-relations-'));
  const relations = JSON.parse(await readFile('docs/templates/source-relations.example.json', 'utf8'));
  await writeFile(join(root, 'valid.json'), JSON.stringify(relations));
  assert.equal((await verifySourceRelations(join(root, 'valid.json'))).cells, 8);

  relations.entries.pop();
  await writeFile(join(root, 'incomplete.json'), JSON.stringify(relations));
  await assert.rejects(verifySourceRelations(join(root, 'incomplete.json')), /matrix is incomplete/);

  const guessed = JSON.parse(await readFile('docs/templates/source-relations.example.json', 'utf8'));
  guessed.entries[0].derivation.kind = 'observation';
  guessed.sources.find(source => source.id === 'assembly-table').classification = 'observation';
  delete guessed.entries[0].derivation.locator;
  await writeFile(join(root, 'guessed.json'), JSON.stringify(guessed));
  await assert.rejects(verifySourceRelations(join(root, 'guessed.json')), /not source-qualified/);
});

test('visual qualification requires every declared cell and assertion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orbite-visual-'));
  const visual = JSON.parse(await readFile('docs/templates/visual-qualification.example.json', 'utf8'));
  await writeFile(join(root, 'valid.json'), JSON.stringify(visual));
  assert.equal((await verifyVisualQualification(join(root, 'valid.json'))).verdict, 'qualified');

  visual.captures[0].assertions.pop();
  await writeFile(join(root, 'missing-assertion.json'), JSON.stringify(visual));
  await assert.rejects(verifyVisualQualification(join(root, 'missing-assertion.json')), /misses required assertions/);
});
