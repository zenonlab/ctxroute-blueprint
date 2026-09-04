import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synchronizeBlueprint } from '../scripts/blueprint-sync.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));

test('blueprint sync previews, backs up, applies, and refuses dirty targets', async () => {
  const target = mkdtempSync(join(tmpdir(), 'blueprint-sync-'));
  git(target, ['init']);
  git(target, ['config', 'user.email', 'test@example.test']);
  git(target, ['config', 'user.name', 'Blueprint Test']);
  writeFileSync(join(target, 'AGENTS.md'), 'old doctrine\n');
  git(target, ['add', 'AGENTS.md']);
  git(target, ['commit', '-m', 'test: fixture']);
  const preview = await synchronizeBlueprint({ source, target, timestamp: 'fixture' });
  assert.equal(preview.applied, false);
  assert.equal(preview.current, false);
  assert.equal(preview.sourceVersion, '2026.09.04.2');
  assert.equal(preview.targetVersion, null);
  assert.ok(preview.changes.some(change => change.file === 'AGENTS.md' && change.action === 'update'));
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), 'old doctrine\n');
  const check = spawnSync(process.execPath, [join(source, 'scripts/blueprint-sync.mjs'), '--check', '--target', target], { cwd: source, encoding: 'utf8' });
  assert.equal(check.status, 1);
  assert.equal(JSON.parse(check.stdout).current, false);
  const applied = await synchronizeBlueprint({ source, target, apply: true, timestamp: 'fixture' });
  assert.equal(applied.applied, true);
  assert.equal(applied.targetVersion, '2026.09.04.2');
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), readFileSync(join(source, 'AGENTS.md'), 'utf8'));
  assert.equal(readFileSync(join(target, '.ctxroute/blueprint-backups/fixture/AGENTS.md'), 'utf8'), 'old doctrine\n');
  assert.ok(existsSync(join(target, '.codex/agents/progress-worker.toml')));
  assert.equal(JSON.parse(readFileSync(join(target, '.project/blueprint-version.json'), 'utf8')).version, '2026.09.04.2');
  await assert.rejects(() => synchronizeBlueprint({ source, target, apply: true }), /dirty/u);
});

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
