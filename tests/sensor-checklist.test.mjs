import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sensor = join(root, '.githooks', 'sensor');

test('sensor checklist reports honest syntax coverage in JSON and terminal formats', () => {
  const json = spawnSync(process.execPath, [sensor, '--checklist', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.status, 'PASS');
  assert.equal(result.catalogVersion, 2);
  assert.equal(result.checks.find(item => item.name === 'catalog-classification').detail, '115 extensions / 9 filenames');
  assert.equal(result.checks.find(item => item.name === 'no-false-pass').status, 'PASS');
  assert.equal(result.adapters.find(item => item.id === 'javascript').status, 'PASS');
  assert.equal(result.adapters.find(item => item.id === 'javascript').syntaxAware, true);
  assert.equal(result.adapters.find(item => item.id === 'rust').status, 'MISSING');
  assert.equal(result.adapters.find(item => item.id === 'rust').syntaxAware, false);
  assert.equal(result.adapters.find(item => item.id === 'toml').status, 'MISSING');
  assert.deepEqual(result.adapters.find(item => item.id === 'ruby').filenames, ['Gemfile', 'Rakefile', 'config.ru']);
  const text = spawnSync(process.execPath, [sensor, '--checklist'], { cwd: root, encoding: 'utf8' });
  assert.equal(text.status, 0);
  assert.match(text.stdout, /Sensor checklist/u);
  assert.match(text.stdout, /Result: PASS/u);
});
