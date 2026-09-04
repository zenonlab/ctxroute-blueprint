import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  assert.ok(preview.changes.some(change => change.file === 'AGENTS.md' && change.action === 'update'));
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), 'old doctrine\n');
  const applied = await synchronizeBlueprint({ source, target, apply: true, timestamp: 'fixture' });
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), readFileSync(join(source, 'AGENTS.md'), 'utf8'));
  assert.equal(readFileSync(join(target, '.ctxroute/blueprint-backups/fixture/AGENTS.md'), 'utf8'), 'old doctrine\n');
  assert.ok(existsSync(join(target, '.codex/agents/progress-worker.toml')));
  await assert.rejects(() => synchronizeBlueprint({ source, target, apply: true }), /dirty/u);
});

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
