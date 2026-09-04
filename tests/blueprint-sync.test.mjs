import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  assert.equal(preview.sourceVersion, '2026.09.05.1');
  assert.equal(preview.targetVersion, null);
  assert.ok(preview.changes.some(change => change.file === 'AGENTS.md' && change.action === 'update'));
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), 'old doctrine\n');
  const check = spawnSync(process.execPath, [join(source, 'scripts/blueprint-sync.mjs'), '--check', '--target', target], { cwd: source, encoding: 'utf8' });
  assert.equal(check.status, 1);
  assert.equal(JSON.parse(check.stdout).current, false);
  const applied = await synchronizeBlueprint({ source, target, apply: true, timestamp: 'fixture' });
  assert.equal(applied.applied, true);
  assert.equal(applied.targetVersion, '2026.09.05.1');
  assert.equal(readFileSync(join(target, 'AGENTS.md'), 'utf8'), readFileSync(join(source, 'AGENTS.md'), 'utf8'));
  assert.equal(readFileSync(join(target, '.ctxroute/blueprint-backups/fixture/AGENTS.md'), 'utf8'), 'old doctrine\n');
  assert.ok(existsSync(join(target, '.codex/agents/progress-worker.toml')));
  assert.equal(JSON.parse(readFileSync(join(target, '.project/blueprint-version.json'), 'utf8')).version, '2026.09.05.1');
  await assert.rejects(() => synchronizeBlueprint({ source, target, apply: true }), /dirty/u);
});

test('blueprint sync copies tracked allowlisted files only', async () => {
  const fixtureSource = mkdtempSync(join(tmpdir(), 'blueprint-source-'));
  const target = mkdtempSync(join(tmpdir(), 'blueprint-target-'));
  git(fixtureSource, ['init']);
  git(target, ['init']);
  mkdirSync(join(fixtureSource, '.codex/hooks'), { recursive: true });
  mkdirSync(join(fixtureSource, '.claude/hooks/docs/adr-memory'), { recursive: true });
  writeFileSync(join(fixtureSource, 'AGENTS.md'), 'tracked doctrine\n');
  writeFileSync(join(fixtureSource, '.codex/hooks/tracked.mjs'), 'export {};\n');
  writeFileSync(join(fixtureSource, '.codex/hooks/local-cache.mjs'), 'ignored local cache\n');
  writeFileSync(join(fixtureSource, '.claude/hooks/docs/adr-memory/generated.md'), 'generated memory\n');
  writeFileSync(join(fixtureSource, '.gitignore'), '.codex/hooks/local-cache.mjs\n.claude/hooks/docs/adr-memory/\n');
  git(fixtureSource, ['add', 'AGENTS.md', '.codex/hooks/tracked.mjs', '.gitignore']);
  git(fixtureSource, ['-c', 'user.email=test@example.test', '-c', 'user.name=Blueprint', 'commit', '-m', 'fixture']);

  const preview = await synchronizeBlueprint({ source: fixtureSource, target });
  assert.deepEqual(preview.changes.map(change => change.file), ['.codex/hooks/tracked.mjs', 'AGENTS.md']);
  await synchronizeBlueprint({ source: fixtureSource, target, apply: true });
  assert.ok(existsSync(join(target, '.codex/hooks/tracked.mjs')));
  assert.equal(existsSync(join(target, '.codex/hooks/local-cache.mjs')), false);
  assert.equal(existsSync(join(target, '.claude/hooks/docs/adr-memory/generated.md')), false);
});

function git(cwd, args) { execFileSync('git', args, { cwd, stdio: 'ignore' }); }
