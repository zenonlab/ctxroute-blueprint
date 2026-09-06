import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { loadOrchestratorConfig, safeRelativePath } from './orchestrator-core.mjs';

export async function prepareMissionWorktree(missionId, root = process.cwd()) {
  if (!/^[a-z][a-z0-9-]{0,127}$/u.test(missionId)) throw new Error('invalid mission id');
  const config = await loadOrchestratorConfig(root);
  const worktreeRelative = `${config.worktreeRoot}/${missionId}`.replaceAll('\\', '/');
  const worktree = resolve(root, worktreeRelative);
  if (existsSync(worktree)) throw new Error(`worktree path already exists: ${worktreeRelative}`);
  const active = listManagedWorktrees(root, config.worktreeRoot).length;
  if (active >= config.parallelWorktrees) throw new Error(`physical worktree parallelism limit reached: ${config.parallelWorktrees}`);
  await mkdir(dirname(worktree), { recursive: true });
  execFileSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: root, stdio: 'pipe', timeout: config.subprocessTimeoutMs });
  return { path: worktreeRelative, base: git(root, ['rev-parse', 'HEAD']).trim() };
}

export function inspectMissionChanges(worktreePath, fileScope, root = process.cwd(), baseRevision) {
  if (!safeRelativePath(worktreePath) || !Array.isArray(fileScope) || fileScope.some(path => !safeRelativePath(path))) throw new Error('invalid worktree inspection scope');
  const worktree = resolve(root, worktreePath);
  const changed = new Set();
  for (const args of [['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    git(worktree, args).split('\0').filter(Boolean).forEach(path => changed.add(path.replaceAll('\\', '/')));
  }
  if (baseRevision) git(worktree, ['diff', '--name-only', '-z', `${baseRevision}...HEAD`]).split('\0').filter(Boolean).forEach(path => changed.add(path.replaceAll('\\', '/')));
  const files = [...changed].sort();
  const outsideScope = files.filter(path => !fileScope.some(scope => path === scope || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)));
  return { files, outsideScope, ok: outsideScope.length === 0 };
}

export function rollbackMissionWorktree(worktreePath, root = process.cwd(), force = false) {
  if (!safeRelativePath(worktreePath)) throw new Error('invalid worktree rollback path');
  const absolute = resolve(root, worktreePath);
  const rootRelative = relative(root, absolute).replaceAll('\\', '/');
  if (!rootRelative.startsWith('.ctxroute/worktrees/')) throw new Error('rollback is restricted to managed worktrees');
  execFileSync('git', ['worktree', 'remove', ...(force ? ['--force'] : []), absolute], { cwd: root, stdio: 'pipe', timeout: 30_000 });
  execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'pipe', timeout: 30_000 });
  return { removed: rootRelative, force };
}

function listManagedWorktrees(root, worktreeRoot) {
  const prefix = `${resolve(root, worktreeRoot)}/`;
  return git(root, ['worktree', 'list', '--porcelain']).split(/\r?\n/u).filter(line => line.startsWith('worktree ')).map(line => line.slice(9)).filter(path => path.startsWith(prefix));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
}
