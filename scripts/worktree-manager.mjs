import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, readdir, realpath, rename, statfs } from 'node:fs/promises';
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

export async function integrateMissionChanges(mission, root = process.cwd(), dependencies = {}) {
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const allocation = mission.worktree_allocation;
  if (!allocation?.path || !allocation.base_revision) throw categorized('INTEGRATION_UNPROVABLE', 'mission has no active base revision');
  const worktree = await resolveManagedPath(root, config.worktreeRoot, allocation.path, true);
  const before = await inspectMissionChanges(allocation.path, mission.file_scope, root, allocation.base_revision, deps);
  if (before.head !== allocation.base_revision) throw categorized('WORKER_COMMITTED', 'worker changed worktree HEAD');
  if (!before.ok) throw categorized('OUTSIDE_SCOPE', `worktree changed files outside mission scope: ${before.outsideScope.join(', ')}`);
  if (!before.files.length) throw categorized('EMPTY_WORKER_DIFF', 'worker produced no repository change');
  await git(worktree, ['add', '-A', '--', '.'], config, deps);
  const staged = parseNull((await git(worktree, ['diff', '--cached', '--name-only', '-z'], config, deps)).stdout).map(normalizePath).sort();
  if (stableJson(staged) !== stableJson(before.files)) throw categorized('STAGED_SCOPE_MISMATCH', 'staged files differ from inspected mission files');
  const commitEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: 'CTXRoute Orchestrator',
    GIT_AUTHOR_EMAIL: 'orchestrator@ctxroute.invalid',
    GIT_COMMITTER_NAME: 'CTXRoute Orchestrator',
    GIT_COMMITTER_EMAIL: 'orchestrator@ctxroute.invalid',
  };
  await git(worktree, ['commit', '--no-gpg-sign', '-m', `feat(orchestrator): integrate ${mission.mission_id}`], config, { ...deps, gitEnvironment: commitEnvironment });
  const workerCommit = (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  const mainBefore = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  if (mainBefore !== allocation.base_revision) {
    const mainChanged = parseNull((await git(root, ['diff', '--name-only', '-z', `${allocation.base_revision}..${mainBefore}`], config, deps)).stdout).map(normalizePath);
    const ignoreCase = (await git(root, ['config', '--bool', 'core.ignoreCase'], config, deps, true)).stdout.trim() === 'true';
    const conflicts = mainChanged.filter(file => mission.file_scope.some(scope => scopeContains(scope, file, ignoreCase)));
    if (conflicts.length) {
      const proof = await writeIntegrationProof(root, mission.mission_id, workerCommit, mainBefore, conflicts, deps);
      const error = categorized('MAIN_SCOPE_CONFLICT', 'main checkout changed mission-scoped paths since the mission base');
      error.recoveryProof = proof;
      error.workerCommit = workerCommit;
      throw error;
    }
  }
  const picked = await git(root, ['cherry-pick', '--no-edit', workerCommit], config, deps, true);
  if (picked.code !== 0) {
    await git(root, ['cherry-pick', '--abort'], config, deps, true);
    const proof = await writeIntegrationProof(root, mission.mission_id, workerCommit, mainBefore, staged, deps);
    const error = categorized('CHERRY_PICK_CONFLICT', 'orchestrator cherry-pick conflicted and was aborted');
    error.recoveryProof = proof;
    error.workerCommit = workerCommit;
    throw error;
  }
  const integratedCommit = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  return { files: staged, worker_commit: workerCommit, integrated_commit: integratedCommit };
}

export async function reconcileManagedWorktrees(root = process.cwd(), dependencies = {}, suppliedState = null) {
  const deps = createWorktreeDependencies(dependencies);
  const repair = dependencies.repair !== false;
  const config = await loadOrchestratorConfig(root);
  const state = suppliedState ?? await readOrchestratorState(root);
  const managedRoot = await ensureManagedRoot(root, config.worktreeRoot);
  const missions = new Map(state.goals.flatMap(goal => goal.missions).filter(mission => mission.worktree_allocation?.path && !['REMOVED', 'ROLLED_BACK'].includes(mission.worktree_allocation.status)).map(mission => [normalizePath(mission.worktree_allocation.path), mission]));
  const registered = await listManagedWorktrees(root, config, deps);
  const remaining = new Map(registered.map(item => [item.relative, item]));
  const results = [];
  let shouldPrune = false;
  const foldedPaths = new Map();
  for (const path of [...missions.keys(), ...registered.map(item => item.relative)]) {
    const folded = path.toLocaleLowerCase('en-US');
    const values = foldedPaths.get(folded) ?? new Set(); values.add(path); foldedPaths.set(folded, values);
  }
  const collisions = new Set([...foldedPaths.values()].filter(values => values.size > 1).flatMap(values => [...values]));
  for (const [worktreePath, mission] of missions) {
    const registration = remaining.get(worktreePath);
    const physical = await lstat(resolve(root, worktreePath)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (collisions.has(worktreePath)) { results.push(result(worktreePath, 'CASE_COLLISION', 'NEEDS_ATTENTION', mission.worktree_allocation.base_revision)); continue; }
    if (physical?.isSymbolicLink()) { results.push(result(worktreePath, 'SYMLINK', 'NEEDS_ATTENTION', mission.worktree_allocation.base_revision)); continue; }
    if (!registration) { results.push(result(worktreePath, physical ? 'DIRECTORY_NOT_REGISTERED' : 'METADATA_MISSING', 'NEEDS_ATTENTION', mission.worktree_allocation.base_revision)); continue; }
    remaining.delete(worktreePath);
    if (registration.symlink) { results.push(result(worktreePath, 'SYMLINK', 'NEEDS_ATTENTION', mission.worktree_allocation.base_revision)); continue; }
    if (!registration.present) { shouldPrune = true; results.push(result(worktreePath, 'REGISTERED_PATH_MISSING', 'PRUNE_METADATA', mission.worktree_allocation.base_revision)); continue; }
    const status = await worktreeStatus(registration.absolute, config, deps);
    const base = mission.worktree_allocation.base_revision;
    if (status.indexLock) { results.push(result(worktreePath, 'INDEX_LOCK', 'NEEDS_ATTENTION', base, status)); continue; }
    if (!TERMINAL.has(mission.status)) { results.push(result(worktreePath, status.dirty ? 'ACTIVE_DIRTY' : 'ACTIVE_COHERENT', 'PRESERVED', base, status)); continue; }
    if (status.dirty) { results.push(result(worktreePath, 'TERMINAL_DIRTY', 'NEEDS_ATTENTION', base, status)); continue; }
    const expectedHead = mission.integration_status === 'INTEGRATED' && mission.worker_commit ? mission.worker_commit : base;
    if (status.head !== expectedHead) { results.push(result(worktreePath, 'REVISION_DIVERGED', 'NEEDS_ATTENTION', base, status)); continue; }
    if (repair) {
      await git(root, ['worktree', 'remove', registration.absolute], config, deps);
      await deps.fault?.('afterWorktreeRemove', worktreePath);
    }
    results.push(result(worktreePath, 'TERMINAL_CLEAN', repair ? 'REMOVED' : 'PRESERVED', base, status));
  }
  for (const registration of remaining.values()) {
    if (collisions.has(registration.relative)) { results.push(result(registration.relative, 'CASE_COLLISION', 'NEEDS_ATTENTION')); continue; }
    if (registration.symlink) { results.push(result(registration.relative, 'SYMLINK', 'NEEDS_ATTENTION')); continue; }
    if (!registration.present) { shouldPrune = true; results.push(result(registration.relative, 'ORPHAN_REGISTERED_MISSING', 'PRUNE_METADATA')); continue; }
    const status = await worktreeStatus(registration.absolute, config, deps);
    results.push(result(registration.relative, status.indexLock ? 'INDEX_LOCK' : status.dirty ? 'ORPHAN_REGISTERED_DIRTY' : 'ORPHAN_REGISTERED_CLEAN', 'NEEDS_ATTENTION', null, status));
  }
  const registeredPaths = new Set(registered.filter(item => item.present).map(item => item.absolute));
  for (const entry of await readdir(managedRoot, { withFileTypes: true })) {
    const absolute = resolve(managedRoot, entry.name);
    if (registeredPaths.has(absolute)) continue;
    const path = `${config.worktreeRoot}/${entry.name}`;
    if (results.some(item => item.path === path)) continue;
    results.push(result(path, entry.isSymbolicLink() ? 'SYMLINK' : entry.isDirectory() ? 'DIRECTORY_NOT_REGISTERED' : 'UNKNOWN_ENTRY', 'NEEDS_ATTENTION'));
  }
  if (shouldPrune && repair) await git(root, ['worktree', 'prune'], config, deps);
  if (!repair) for (const item of results) if (item.action === 'PRUNE_METADATA') item.action = 'PRESERVED';
  return { results: results.sort((left, right) => left.path.localeCompare(right.path)), changed: repair && results.some(item => ['REMOVED', 'PRUNE_METADATA'].includes(item.action)) };
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
  const header = `${JSON.stringify({ mission_id: missionId, head: inventory.head, files: inventory.files, digest: patchDigest })}\n`;
  const proof = Buffer.concat([Buffer.from(header), patch]);
  if (proof.byteLength > config.rollbackBytes) throw categorized('ROLLBACK_PROOF_TOO_LARGE', `rollback proof exceeds ${config.rollbackBytes} bytes`);
  const recoveryRoot = resolve(root, config.recoveryRoot);
  await mkdir(recoveryRoot, { recursive: true, mode: 0o700 });
  const proofRelative = `${config.recoveryRoot.replace(/\/$/u, '')}/${missionId}-${deps.now().toISOString().replace(/[:.]/gu, '-')}.patch`;
  const temporary = resolve(root, `${proofRelative}.${process.pid}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(proof); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, resolve(root, proofRelative));
  await deps.fault?.('afterRecoveryProof', proofRelative);
  await git(root, ['worktree', 'remove', '--force', worktree], config, deps);
  await deps.fault?.('afterRollbackRemove', worktreePath);
  return { mission_id: missionId, worktree: worktreePath, status: 'ROLLED_BACK', proof: proofRelative, digest: `sha256:${createHash('sha256').update(proof).digest('hex')}` };
}

export async function recoverRollbackProof(missionId, root = process.cwd()) {
  if (!ID.test(String(missionId))) throw new Error('invalid rollback mission');
  const config = await loadOrchestratorConfig(root);
  const recoveryRoot = resolve(root, config.recoveryRoot);
  const entries = await readdir(recoveryRoot, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const candidates = entries.filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.startsWith(`${missionId}-`) && entry.name.endsWith('.patch')).sort((left, right) => right.name.localeCompare(left.name));
  for (const entry of candidates) {
    const relativePath = `${config.recoveryRoot.replace(/\/$/u, '')}/${entry.name}`;
    const bytes = await readFile(resolve(recoveryRoot, entry.name));
    if (bytes.length > config.rollbackBytes) continue;
    const newline = bytes.indexOf(10);
    if (newline < 0 || newline > 4096) continue;
    let header;
    try { header = JSON.parse(bytes.subarray(0, newline).toString('utf8')); } catch { continue; }
    const patch = bytes.subarray(newline + 1);
    const patchDigest = `sha256:${createHash('sha256').update(patch).digest('hex')}`;
    if (!validRollbackHeader(header, missionId, patchDigest)) continue;
    return { mission_id: missionId, status: 'ROLLED_BACK', proof: relativePath, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  }
  throw categorized('ROLLBACK_PROOF_MISSING', 'pending rollback removed its worktree without a valid recovery proof');
}

export async function purgeMissionWorktree({ mission_id, worktree, confirmation, reason }, root = process.cwd(), dependencies = {}) {
  if (!ID.test(String(mission_id)) || confirmation !== mission_id || reason !== String(reason) || reason.trim().length < 8) throw new Error('purge requires mission_id, exact confirmation, and a reason');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const absolute = await resolveManagedPath(root, config.worktreeRoot, worktree, true);
  await git(root, ['worktree', 'remove', '--force', absolute], config, deps);
  await deps.fault?.('afterPurgeRemove', worktree);
  return { mission_id, worktree, status: 'PURGED' };
}

async function inspectRollbackState(worktree, config, deps) {
  const status = await worktreeStatus(worktree, config, deps);
  return { ...status, head: (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim() };
}
function validRollbackHeader(value, missionId, patchDigest) {
  if (!value || value !== Object(value) || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.join('\0') !== ['digest', 'files', 'head', 'mission_id'].join('\0')) return false;
  if (value.mission_id !== missionId || value.digest !== patchDigest || !/^[0-9a-f]{40,64}$/u.test(value.head)) return false;
  return Array.isArray(value.files) && value.files.length <= 4096
    && new Set(value.files).size === value.files.length && value.files.every(safeRelativePath);
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
  const head = (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  const gitDirectoryOutput = (await git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'], config, deps)).stdout.trim();
  const gitDirectory = resolve(worktree, gitDirectoryOutput);
  const lock = await lstat(resolve(gitDirectory, 'index.lock')).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  return { dirty: source.length > 0, files: parseNull(source).map(record => normalizePath(record.slice(3))).sort(), head, indexLock: Boolean(lock) };
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
    const details = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    entries.push({ absolute, relative: normalizePath(relative(repository, absolute)), present: Boolean(details), symlink: details?.isSymbolicLink() ?? false });
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
    const value = await deps.execFile('git', args, { cwd, encoding: 'utf8', timeout: config.subprocessTimeoutMs, maxBuffer: config.reportBytes, windowsHide: true, env: deps.gitEnvironment ?? process.env });
    return { ...value, code: 0 };
  } catch (error) {
    const code = Number.isInteger(error.code) ? error.code : error.killed ? 124 : 1;
    if (acceptFailure) return { stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), code };
    throw categorized(error.killed ? 'GIT_TIMEOUT' : 'GIT_FAILED', `git ${args[0]} failed (${code})`);
  }
}
async function writeIntegrationProof(root, missionId, workerCommit, mainHead, files, deps) {
  const config = await loadOrchestratorConfig(root);
  const directory = resolve(root, config.recoveryRoot);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const relativePath = `${config.recoveryRoot.replace(/\/$/u, '')}/${missionId}-integration-${deps.now().toISOString().replace(/[:.]/gu, '-')}.json`;
  const target = resolve(root, relativePath);
  const temporary = `${target}.${process.pid}.tmp`;
  const source = `${JSON.stringify({ mission_id: missionId, worker_commit: workerCommit, main_head: mainHead, files }, null, 2)}\n`;
  if (Buffer.byteLength(source) > config.reportBytes) throw categorized('RECOVERY_PROOF_TOO_LARGE', 'integration recovery proof exceeds its byte budget');
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, target);
  return relativePath;
}
function stableJson(value) { return JSON.stringify(value); }
function scopeContains(scope, file, ignoreCase) { const normalize = value => ignoreCase ? normalizePath(value).toLocaleLowerCase('en-US') : normalizePath(value); const left = normalize(scope).replace(/\/$/u, ''); const right = normalize(file); return right === left || right.startsWith(`${left}/`); }
function result(path, classification, action, baseRevision = null, status = {}) { return { path, classification, action, head: status.head ?? null, base_revision: baseRevision, dirty: status.dirty ?? null, index_lock: status.indexLock ?? false }; }
function parseNull(source) { return source.split('\0').filter(Boolean); }
function normalizePath(path) { return path.replaceAll('\\', '/'); }
function assertContained(parent, child, label) { if (child !== parent && !child.startsWith(`${parent}${sep}`)) throw new Error(`${label} escapes its managed root`); }
async function pathExists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
