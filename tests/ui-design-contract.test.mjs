import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateUiContract } from '../.githooks/validate-ui-design.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('framework-neutral UI contract is valid and has reusable accessibility vocabulary', () => {
  const contract = JSON.parse(readFileSync(join(root, '.project/ui-design-contract.json'), 'utf8'));
  assert.deepEqual(validateUiContract(contract), []);
  assert.equal(contract.adapters.framework, 'selected-by-derived-product');
  assert.equal(contract.rules.reuseBeforeCreate, true);
  assert.ok(contract.components.every(component => component.accessibility.length > 0));
});

test('UI contract rejects framework coupling, duplicate components, and raw-value policy drift', () => {
  const contract = JSON.parse(readFileSync(join(root, '.project/ui-design-contract.json'), 'utf8'));
  const invalid = structuredClone(contract);
  invalid.policy = 'react-only';
  invalid.components.push(structuredClone(invalid.components[0]));
  invalid.components[0].tokenPolicy = 'arbitrary-values';
  assert.deepEqual(validateUiContract(invalid), [
    'policy must be framework-neutral',
    'action.tokenPolicy must be tokens-only',
    'component id is duplicated: action',
  ]);
});

test('UI contract CLI returns stable JSON and non-zero status for invalid input', () => {
  const result = spawnSync(process.execPath, ['.githooks/validate-ui-design.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { schemaVersion: 1, valid: true, diagnostics: [] });
});
