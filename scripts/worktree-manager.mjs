import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath, rename, statfs } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { loadOrchestratorConfig, readOrchestratorState, safeRelativePath } from './orchestrator-core.mjs';

const execFile = promisify(execFileCallback);
const TERMINAL = new Set(['COMPLETED', 'CANCELLED']);
const ID = /^[a-z][a-z0-9-]{0,127}$/u;

export function createWorktreeDependencies(overrides = {}) {
  return { execFile, statfs, now: () => new Date(), ...overrides };
}

export async function prepareMissionWorktree(missionId, root = process.cwd(), dependencies = {}) {
  if (!ID.test(missionId)) throw new Error('invalid mission id');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const managedRoot = await ensureManagedRoot(root, config.worktreeRoot);
  const worktreeRelative = `${config.worktreeRoot}/${missionId}`.replaceAll('\\', '/');
  const worktree = resolve(managedRoot, missionId);
  assertContained(managedRoot, worktree, 'worktree');
  if (await pathExists(worktree)) throw new Error(`worktree path already exists: ${worktreeRelative}`);
  const disk = await deps.statfs(managedRoot);
  const freeBytes = Number(disk.bavail) * Number(disk.bsize);
  if (freeBytes < config.minFreeBytes) throw categorized('INSUFFICIENT_SPACE', `free space is below ${config.minFreeBytes} bytes`);
  const registered = await listManagedWorktrees(root, config, deps);
  if (registered.length >= config.parallelWorktrees) throw categorized('WORKTREE_LIMIT', `physical worktree parallelism limit reached: ${config.parallelWorktrees}`);
  const base = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  await git(root, ['worktree', 'add', '--detach', worktree, base], config, deps);
  await deps.fault?.('afterWorktreeCreate');
  const actual = await realpath(worktree);
  assertContained(managedRoot, actual, 'created worktree');
  const head = (await git(actual, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  if (head !== base) throw categorized('BASE_REVISION_MISMATCH', 'created worktree HEAD differs from requested base');
  return { path: worktreeRelative, base, status: 'READY' };
}

export async function recoverMissionWorktree(missionId, root = process.cwd(), dependencies = {}) {
  if (!ID.test(missionId)) throw new Error('invalid mission id');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const path = `${config.worktreeRoot}/${missionId}`.replaceAll('\\', '/');
  const absolute = await resolveManagedPath(root, config.worktreeRoot, path, true);
  const registrations = await listManagedWorktrees(root, config, deps);
  if (!registrations.some(item => item.absolute === absolute && item.present)) throw categorized('WORKTREE_NOT_REGISTERED', 'pending worktree is not registered by Git');
  return { path, base: (await git(absolute, ['rev-parse', 'HEAD'], config, deps)).stdout.trim(), status: 'READY' };
}

export async function inspectMissionChanges(worktreePath, fileScope, root = process.cwd(), baseRevision, dependencies = {}) {
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const worktree = await resolveManagedPath(root, config.worktreeRoot, worktreePath, true);
  if (!Array.isArray(fileScope) || fileScope.length === 0 || fileScope.some(path => !safeRelativePath(path))) throw new Error('invalid worktree inspection scope');
  const changed = new Set();
  for (const args of [['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    parseNull((await git(worktree, args, config, deps)).stdout).forEach(path => changed.add(normalizePath(path)));
  }
  if (baseRevision) parseNull((await git(worktree, ['diff', '--name-only', '-z', `${baseRevision}...HEAD`], config, deps)).stdout).forEach(path => changed.add(normalizePath(path)));
  const ignoreCase = (await git(root, ['config', '--bool', 'core.ignoreCase'], config, deps, true)).stdout.trim() === 'true';
  const files = [...changed].sort();
  const outsideScope = files.filter(path => !fileScope.some(scope => scopeContains(scope, path, ignoreCase)));
  return { files, outsideScope, ok: outsideScope.length === 0, head: (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim() };
}

export async function reconcileManagedWorktrees(root = process.cwd(), dependencies = {}) {
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const state = await readOrchestratorState(root);
  const managedRoot = await ensureManagedRoot(root, config.worktreeRoot);
  const missions = new Map(state.goals.flatMap(goal => goal.missions).filter(mission => mission.worktree_allocation?.path).map(mission => [normalizePath(mission.worktree_allocation.path), mission]));
  const registered = await listManagedWorktrees(root, config, deps);
  const remaining = new Map(registered.map(item => [item.relative, item]));
  const results = [];
  let shouldPrune = false;
  for (const [worktreePath, mission] of missions) {
    const registration = remaining.get(worktreePath);
    const present = await pathExists(resolve(root, worktreePath));
    if (!registration) { results.push(result(worktreePath, present ? 'DIRECTORY_NOT_REGISTERED' : 'METADATA_MISSING', 'NEEDS_ATTENTION')); continue; }
    remaining.delete(worktreePath);
    if (!registration.present) { shouldPrune = true; results.push(result(worktreePath, 'REGISTERED_PATH_MISSING', 'PRUNE_METADATA')); continue; }
    const status = await worktreeStatus(registration.absolute, config, deps);
    if (!TERMINAL.has(mission.status)) { results.push(result(worktreePath, status.dirty ? 'ACTIVE_DIRTY' : 'ACTIVE_COHERENT', 'PRESERVED')); continue; }
    if (status.dirty) { results.push(result(worktreePath, 'TERMINAL_DIRTY', 'NEEDS_ATTENTION')); continue; }
    await git(root, ['worktree', 'remove', registration.absolute], config, deps);
    results.push(result(worktreePath, 'TERMINAL_CLEAN', 'REMOVED'));
  }
  for (const registration of remaining.values()) {
    if (!registration.present) { shouldPrune = true; results.push(result(registration.relative, 'ORPHAN_REGISTERED_MISSING', 'PRUNE_METADATA')); continue; }
    const status = await worktreeStatus(registration.absolute, config, deps);
    results.push(result(registration.relative, status.dirty ? 'ORPHAN_REGISTERED_DIRTY' : 'ORPHAN_REGISTERED_CLEAN', 'NEEDS_ATTENTION'));
  }
  const registeredPaths = new Set(registered.filter(item => item.present).map(item => item.absolute));
  for (const entry of await readdir(managedRoot, { withFileTypes: true })) {
    const absolute = resolve(managedRoot, entry.name);
    if (!entry.isDirectory() || entry.isSymbolicLink() || registeredPaths.has(absolute)) continue;
    results.push(result(`${config.worktreeRoot}/${entry.name}`, 'DIRECTORY_NOT_REGISTERED', 'NEEDS_ATTENTION'));
  }
  if (shouldPrune) await git(root, ['worktree', 'prune'], config, deps);
  return { results: results.sort((left, right) => left.path.localeCompare(right.path)), changed: results.some(item => ['REMOVED', 'PRUNE_METADATA'].includes(item.action)) };
}

export async function rollbackMissionWorktree(mission, root = process.cwd(), dependencies = {}) {
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const isPath = mission === String(mission);
  const worktreePath = isPath ? mission : mission?.worktree_allocation?.path;
  const missionId = isPath ? worktreePath.split('/').at(-1) : mission?.mission_id;
  if (!ID.test(String(missionId))) throw new Error('invalid rollback mission');
  const worktree = await resolveManagedPath(root, config.worktreeRoot, worktreePath, true);
  const inventory = await inspectRollbackState(worktree, config, deps);
  const patch = await capturePatch(worktree, inventory.files, config, deps);
  const patchDigest = `sha256:${createHash('sha256').update(patch).digest('hex')}`;
  const header = `${JSON.stringify({ schemaVersion: 1, mission_id: missionId, head: inventory.head, files: inventory.files, digest: patchDigest })}\n`;
  const proof = Buffer.concat([Buffer.from(header), patch]);
  if (proof.byteLength > config.rollbackBytes) throw categorized('ROLLBACK_PROOF_TOO_LARGE', `rollback proof exceeds ${config.rollbackBytes} bytes`);
  const recoveryRoot = resolve(root, '.ctxroute/recovery');
  await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  const proofRelative = `.ctxroute/recovery/${missionId}-${deps.now().toISOString().replace(/[:.]/gu, '-')}.patch`;
  const temporary = resolve(root, `${proofRelative}.${process.pid}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(proof); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, resolve(root, proofRelative));
  await git(root, ['worktree', 'remove', '--force', worktree], config, deps);
  return { mission_id: missionId, worktree: worktreePath, status: 'ROLLED_BACK', proof: proofRelative, digest: `sha256:${createHash('sha256').update(proof).digest('hex')}` };
}

export async function purgeMissionWorktree({ mission_id, worktree, confirmation, reason }, root = process.cwd(), dependencies = {}) {
  if (!ID.test(String(mission_id)) || confirmation !== mission_id || reason !== String(reason) || reason.trim().length < 8) throw new Error('purge requires mission_id, exact confirmation, and a reason');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const absolute = await resolveManagedPath(root, config.worktreeRoot, worktree, true);
  await git(root, ['worktree', 'remove', '--force', absolute], config, deps);
  return { mission_id, worktree, status: 'PURGED' };
}

async function inspectRollbackState(worktree, config, deps) {
  const status = await worktreeStatus(worktree, config, deps);
  return { ...status, head: (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim() };
}
async function capturePatch(worktree, files, config, deps) {
  let source = (await git(worktree, ['diff', '--binary', '--no-ext-diff', 'HEAD'], config, deps)).stdout;
  const untracked = parseNull((await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], config, deps)).stdout);
  for (const file of untracked) {
    const outcome = await git(worktree, ['diff', '--binary', '--no-index', '--', '/dev/null', file], config, deps, true);
    if (![0, 1].includes(outcome.code)) throw categorized('ROLLBACK_CAPTURE_FAILED', `cannot capture ${file}`);
    source += outcome.stdout;
    if (Buffer.byteLength(source) > config.rollbackBytes) throw categorized('ROLLBACK_PROOF_TOO_LARGE', 'rollback patch exceeds its byte budget');
  }
  if (files.length && source.length === 0) throw categorized('ROLLBACK_CAPTURE_FAILED', 'changed files produced no restorable patch');
  return Buffer.from(source);
}
async function worktreeStatus(worktree, config, deps) {
  const source = (await git(worktree, ['status', '--porcelain=v1', '-z'], config, deps)).stdout;
  return { dirty: source.length > 0, files: parseNull(source).map(record => normalizePath(record.slice(3))).sort() };
}
async function listManagedWorktrees(root, config, deps) {
  const managedRoot = await ensureManagedRoot(root, config.worktreeRoot);
  const repository = await realpath(root);
  const records = (await git(root, ['worktree', 'list', '--porcelain'], config, deps)).stdout.split(/\n\n+/u);
  const entries = [];
  for (const record of records) {
    const first = record.split(/\r?\n/u).find(line => line.startsWith('worktree '));
    if (!first) continue;
    const absolute = first.slice(9);
    if (absolute !== managedRoot && !absolute.startsWith(`${managedRoot}${sep}`)) continue;
    entries.push({ absolute, relative: normalizePath(relative(repository, absolute)), present: await pathExists(absolute) });
  }
  return entries;
}
async function resolveManagedPath(root, worktreeRoot, candidate, mustExist) {
  if (!safeRelativePath(candidate) || !normalizePath(candidate).startsWith(`${normalizePath(worktreeRoot)}/`)) throw new Error('path is outside the managed worktree root');
  const managedRoot = await ensureManagedRoot(root, worktreeRoot);
  const relativeCandidate = normalizePath(candidate).slice(normalizePath(worktreeRoot).replace(/\/$/u, '').length + 1);
  const absolute = resolve(managedRoot, relativeCandidate);
  assertContained(managedRoot, absolute, 'worktree');
  const details = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (mustExist && !details) throw new Error(`worktree does not exist: ${candidate}`);
  if (details?.isSymbolicLink()) throw new Error('managed worktree path must not be a symlink');
  if (details) assertContained(managedRoot, await realpath(absolute), 'worktree');
  return absolute;
}
async function ensureManagedRoot(root, worktreeRoot) {
  if (!safeRelativePath(worktreeRoot)) throw new Error('invalid managed worktree root');
  const repository = await realpath(root);
  const absolute = resolve(root, worktreeRoot);
  await mkdir(absolute, { recursive: true, mode: 0o700 });
  const details = await lstat(absolute);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('managed worktree root must be a real directory');
  const canonical = await realpath(absolute);
  assertContained(repository, canonical, 'managed root');
  return canonical;
}
async function git(cwd, args, config, deps, acceptFailure = false) {
  try {
    const value = await deps.execFile('git', args, { cwd, encoding: 'utf8', timeout: config.subprocessTimeoutMs, maxBuffer: config.reportBytes, windowsHide: true });
    return { ...value, code: 0 };
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : error.killed ? 124 : 1;
    if (acceptFailure) return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), code };
    throw categorized(error.killed ? 'GIT_TIMEOUT' : 'GIT_FAILED', `git ${args[0]} failed (${code})`);
  }
}
function scopeContains(scope, file, ignoreCase) { const normalize = value => ignoreCase ? normalizePath(value).toLocaleLowerCase('en-US') : normalizePath(value); const left = normalize(scope).replace(/\/$/u, ''); const right = normalize(file); return right === left || right.startsWith(`${left}/`); }
function result(path, classification, action) { return { path, classification, action }; }
function parseNull(source) { return source.split('\0').filter(Boolean); }
function normalizePath(path) { return path.replaceAll('\\', '/'); }
function assertContained(parent, child, label) { if (child !== parent && !child.startsWith(`${parent}${sep}`)) throw new Error(`${label} escapes its managed root`); }
async function pathExists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
