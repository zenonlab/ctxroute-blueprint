import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkBlueprintVersion, controlHash, updateBlueprintHash } from '../scripts/blueprint-version.mjs';

test('blueprint version binds tracked control changes to a version bump', () => {
  const root = mkdtempSync(join(tmpdir(), 'blueprint-version-'));
  git(root, ['init', '-b', 'main']);
  writeFileSync(join(root, 'AGENTS.md'), 'initial doctrine\n');
  writeFileSync(join(root, '.gitignore'), 'local-cache\n');
  mkdirSync(join(root, '.project'));
  writeFileSync(join(root, '.project/blueprint-version.json'), '{"schemaVersion":1,"version":"1.0.0","controlHash":"pending"}\n');
  git(root, ['add', '.']);
  commit(root, 'initial');

  const marker = JSON.parse(readFileSync(join(root, '.project/blueprint-version.json'), 'utf8'));
  marker.controlHash = controlHash(root);
  writeFileSync(join(root, '.project/blueprint-version.json'), `${JSON.stringify(marker, null, 2)}\n`);
  git(root, ['add', '.']);
  commit(root, 'record hash');
  assert.equal(checkBlueprintVersion(root).ok, true);

  writeFileSync(join(root, 'AGENTS.md'), 'changed doctrine\n');
  const stale = checkBlueprintVersion(root);
  assert.equal(stale.ok, false);
  assert.ok(stale.failures.some(failure => failure.includes('not bumped')));
  assert.throws(() => updateBlueprintHash(root), /Bump blueprint version/u);

  const bumped = JSON.parse(readFileSync(join(root, '.project/blueprint-version.json'), 'utf8'));
  bumped.version = '1.0.1';
  writeFileSync(join(root, '.project/blueprint-version.json'), `${JSON.stringify(bumped, null, 2)}\n`);
  updateBlueprintHash(root);
  assert.equal(checkBlueprintVersion(root).ok, true);
  git(root, ['add', '.']);
  commit(root, 'bump control plane');
  assert.equal(checkBlueprintVersion(root).ok, true);
});

function commit(root, message) { git(root, ['-c', 'user.email=test@example.test', '-c', 'user.name=Blueprint', 'commit', '-m', message]); }
function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'ignore' }); }
