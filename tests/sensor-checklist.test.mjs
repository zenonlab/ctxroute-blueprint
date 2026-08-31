import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sensor = join(root, '.githooks', 'sensor');

test('sensor checklist is read-only and passes in JSON and terminal formats', () => {
  const json = spawnSync(process.execPath, [sensor, '--checklist', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(json.status, 0);
  const result = JSON.parse(json.stdout);
  assert.equal(result.status, 'PASS');
  assert.equal(result.checks.find(item => item.name === 'rust').status, 'PASS');
  assert.equal(result.checks.find(item => item.name === 'toml').status, 'PASS');
  assert.equal(result.adapters.find(item => item.id === 'lexical-source').extensions.includes('.rs'), true);
  assert.equal(result.adapters.find(item => item.id === 'lexical-data').extensions.includes('.toml'), true);
  const text = spawnSync(process.execPath, [sensor, '--checklist'], { cwd: root, encoding: 'utf8' });
  assert.equal(text.status, 0);
  assert.match(text.stdout, /Sensor checklist/u);
  assert.match(text.stdout, /Result: PASS/u);
});
