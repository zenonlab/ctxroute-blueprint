import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, '.githooks', 'sensor-languages.mjs');

test('language status compares configured parsers, manifest, and lockfile', () => {
  const result = runFixture(['status', '--json'], ['javascript', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.status, 'PASS');
  assert.equal(body.catalogVersion, 2);
  assert.equal(body.languages.find(item => item.id === 'javascript').locked, true);
  assert.equal(body.languages.find(item => item.id === 'rust').support, 'MISSING');
  assert.equal(body.languages.find(item => item.id === 'rust').installCommand, null);
  assert.match(body.languages.find(item => item.id === 'rust').unavailableReason, /No Node 22 parser pack/u);
});

test('list exposes atomic preset readiness and blocked packs', () => {
  const result = runFixture(['list', '--json'], ['javascript', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(result.stdout);
  assert.equal(body.presets.web.status, 'BLOCKED');
  assert.ok(body.presets.web.blocked.some(item => item.id === 'astro'));
  assert.equal(body.presets.web.packs.includes('astro'), true);
});

test('install is idempotent for a structured built-in pack', () => {
  const directory = fixture([]);
  for (let index = 0; index < 2; index += 1) {
    const result = spawnSync(process.execPath, [cli, 'install', 'json', '--json'], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const project = JSON.parse(readFileSync(join(directory, '.project/project-config.json'), 'utf8'));
  assert.deepEqual(project.quality.sensor.languages, ['json']);
});

test('unknown and unavailable packs are refused without changing manifests', () => {
  const directory = fixture(['json']);
  const paths = ['package.json', 'package-lock.json', '.project/project-config.json'];
  const before = paths.map(path => readFileSync(join(directory, path), 'utf8'));
  for (const id of ['unknown-package', 'rust']) {
    const result = spawnSync(process.execPath, [cli, 'install', id], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 1);
  }
  assert.deepEqual(paths.map(path => readFileSync(join(directory, path), 'utf8')), before);
});

test('a failed npm install rolls back every manifest', () => {
  const directory = fixture(['json']);
  const paths = ['package.json', 'package-lock.json', '.project/project-config.json'];
  const before = paths.map(path => readFileSync(join(directory, path), 'utf8'));
  const result = spawnSync(process.execPath, [cli, 'install', 'javascript'], { cwd: directory, encoding: 'utf8', env: { ...process.env, npm_execpath: '' } });
  assert.equal(result.status, 1);
  assert.deepEqual(paths.map(path => readFileSync(join(directory, path), 'utf8')), before);
});

test('remove refuses a language still required by codeExtensions', () => {
  const directory = fixture(['javascript'], ['.js']);
  const result = spawnSync(process.execPath, [cli, 'remove', 'javascript'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /still required by codeExtensions/u);
});

function runFixture(args, languages) { const directory = fixture(languages); return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' }); }
function fixture(languages, codeExtensions = []) {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-languages-'));
  mkdirSync(join(directory, '.project'));
  writeFileSync(join(directory, '.project/project-config.json'), `${JSON.stringify({ quality: { sensor: { languages, antiSlopEffect: 'auto' } }, codeExtensions }, null, 2)}\n`);
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify({ type: 'module', devDependencies: { 'tree-sitter-javascript': '0.23.1' } }, null, 2)}\n`);
  writeFileSync(join(directory, 'package-lock.json'), `${JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/tree-sitter-javascript': { version: '0.23.1' } } }, null, 2)}\n`);
  return directory;
}
