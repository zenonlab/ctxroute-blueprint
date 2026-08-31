import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

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
