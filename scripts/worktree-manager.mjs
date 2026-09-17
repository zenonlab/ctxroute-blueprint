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

export async function commitMissionWorktree(mission, message, root = process.cwd(), dependencies = {}) {
  if (!mission?.worktree_allocation?.path || mission.validation_receipt?.status !== 'PASSED' || mission.status !== 'COMPLETED') throw new Error('orchestrator commit requires a completed validated mission');
  if (mission.access !== 'write') throw new Error('read-only missions cannot be committed');
  if (message !== String(message) || !message.trim() || /[\r\n\0]/u.test(message)) throw new Error('invalid orchestrator commit message');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const worktree = await resolveManagedPath(root, config.worktreeRoot, mission.worktree_allocation.path, true);
  const before = await worktreeStatus(worktree, config, deps);
  if (!before.dirty) {
    if (before.head !== mission.worktree_allocation.base_revision) return { commit: before.head, path: mission.worktree_allocation.path, base_revision: mission.worktree_allocation.base_revision };
    throw new Error('orchestrator commit requires validated worktree changes');
  }
  await git(worktree, ['add', '--all'], config, deps);
  await git(worktree, ['commit', '-m', message.trim()], config, deps);
  const commit = (await git(worktree, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  return { commit, path: mission.worktree_allocation.path, base_revision: mission.worktree_allocation.base_revision };
}

export async function integrateMissionCommit(commitOid, root = process.cwd(), dependencies = {}) {
  if (!/^[0-9a-f]{40}$/u.test(String(commitOid))) throw new Error('integration requires an exact commit OID');
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const status = (await git(root, ['status', '--porcelain=v1', '-z', '--', '.', ':(exclude).ctxroute/**'], config, deps)).stdout;
  if (status) throw categorized('PRIMARY_CHECKOUT_DIRTY', 'integration requires a clean primary checkout');
  await git(root, ['cat-file', '-e', `${commitOid}^{commit}`], config, deps);
  const before = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  const alreadyIntegrated = await git(root, ['diff', '--quiet', commitOid, before], config, deps, true);
  if (alreadyIntegrated.code === 0) return { source_commit: commitOid, previous_head: before, integrated_commit: before };
  try { await git(root, ['cherry-pick', commitOid], config, deps); }
  catch (error) {
    await git(root, ['cherry-pick', '--abort'], config, deps, true);
    throw error;
  }
  const integrated = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  return { source_commit: commitOid, previous_head: before, integrated_commit: integrated };
}

export async function reconcileManagedWorktrees(root = process.cwd(), dependencies = {}, suppliedState = null) {
  const deps = createWorktreeDependencies(dependencies);
  const repair = dependencies.repair === true;
  const config = await loadOrchestratorConfig(root);
  const state = suppliedState ?? await readOrchestratorState(root);
  const managedRoot = await managedRootForInventory(root, config.worktreeRoot);
  const missions = new Map(state.goals.flatMap(goal => goal.missions).filter(mission => mission.worktree_allocation?.path && !['REMOVED', 'ROLLED_BACK'].includes(mission.worktree_allocation.status)).map(mission => [normalizePath(mission.worktree_allocation.path), mission]));
  const registered = await listManagedWorktrees(root, config, deps, false);
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
    if (mission.status === 'COMPLETED' && mission.validation_receipt?.status === 'PASSED' && !mission.orchestrator_commit && status.dirty) { results.push(result(worktreePath, 'VALIDATED_AWAITING_COMMIT', 'PRESERVED', base, status)); continue; }
    if (status.dirty) { results.push(result(worktreePath, 'TERMINAL_DIRTY', 'NEEDS_ATTENTION', base, status)); continue; }
    if (mission.orchestrator_commit === status.head && !mission.integrated_commit) { results.push(result(worktreePath, 'COMMITTED_AWAITING_INTEGRATION', 'PRESERVED', base, status)); continue; }
    if (status.head !== base && !mission.integrated_commit) { results.push(result(worktreePath, 'REVISION_DIVERGED', 'NEEDS_ATTENTION', base, status)); continue; }
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
  for (const entry of managedRoot ? await readdir(managedRoot, { withFileTypes: true }) : []) {
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

export async function inventoryRepositoryRecovery(root = process.cwd(), dependencies = {}) {
  const deps = createWorktreeDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const probe = await git(root, ['rev-parse', '--git-dir'], config, deps, true);
  if (probe.code !== 0) return [];
  const repository = await realpath(root);
  const results = [];
  const worktrees = (await git(root, ['worktree', 'list', '--porcelain'], config, deps)).stdout.split(/\n\n+/u);
  for (const record of worktrees) {
    const lines = record.split(/\r?\n/u);
    const absolute = lines.find(line => line.startsWith('worktree '))?.slice(9);
    const head = lines.find(line => line.startsWith('HEAD '))?.slice(5) ?? null;
    if (!absolute || resolve(absolute) === resolve(repository)) continue;
    const path = normalizePath(relative(repository, absolute));
    if (path.startsWith('../')) results.push(result(`external-worktrees/${createHash('sha256').update(absolute).digest('hex').slice(0, 16)}`, 'UNMANAGED_WORKTREE', 'PRESERVED', null, { head, dirty: null }));
  }
  const branches = (await git(root, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads'], config, deps)).stdout.split('\n').filter(Boolean);
  const primary = (await git(root, ['rev-parse', 'HEAD'], config, deps)).stdout.trim();
  for (const row of branches) {
    const [branch, oid] = row.split('\0');
    if (!branch || oid === primary) continue;
    const branchAncestor = await git(root, ['merge-base', '--is-ancestor', oid, primary], config, deps, true);
    const primaryAncestor = await git(root, ['merge-base', '--is-ancestor', primary, oid], config, deps, true);
    if (branchAncestor.code !== 0 && primaryAncestor.code !== 0) results.push(result(`refs/heads/${branch}`, 'DIVERGENT_BRANCH', 'PRESERVED', oid, { head: primary, dirty: null }));
  }
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-merge', 'rebase-apply']) {
    const path = (await git(root, ['rev-parse', '--git-path', marker], config, deps)).stdout.trim();
    if (await pathExists(path)) results.push(result(`.git/${marker}`, 'INTERRUPTED_GIT_OPERATION', 'NEEDS_ATTENTION', null, { head: primary, dirty: null }));
  }
  const fsck = await git(root, ['fsck', '--unreachable', '--no-reflogs', '--no-progress'], config, deps, true);
  for (const line of `${fsck.stdout}\n${fsck.stderr}`.split(/\r?\n/u)) {
    const match = /^unreachable commit ([0-9a-f]{40})$/u.exec(line.trim());
    if (match) results.push(result(`objects/${match[1]}`, 'UNREACHABLE_COMMIT', 'PRESERVED', match[1], { head: primary, dirty: null }));
  }
  return results.sort((left, right) => left.path.localeCompare(right.path));
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
    if (header?.mission_id !== missionId || header.digest !== `sha256:${createHash('sha256').update(patch).digest('hex')}`) continue;
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
async function listManagedWorktrees(root, config, deps, createRoot = true) {
  const managedRoot = createRoot
    ? await ensureManagedRoot(root, config.worktreeRoot)
    : await managedRootForInventory(root, config.worktreeRoot);
  const repository = await realpath(root);
  const records = (await git(root, ['worktree', 'list', '--porcelain'], config, deps)).stdout.split(/\n\n+/u);
  const entries = [];
  for (const record of records) {
    const first = record.split(/\r?\n/u).find(line => line.startsWith('worktree '));
    if (!first) continue;
    const absolute = first.slice(9);
    if (!managedRoot || (absolute !== managedRoot && !absolute.startsWith(`${managedRoot}${sep}`))) continue;
    const details = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    entries.push({ absolute, relative: normalizePath(relative(repository, absolute)), present: Boolean(details), symlink: details?.isSymbolicLink() ?? false });
  }
  return entries;
}
async function managedRootForInventory(root, worktreeRoot) {
  if (!safeRelativePath(worktreeRoot)) throw new Error('invalid managed worktree root');
  const repository = await realpath(root);
  const absolute = resolve(repository, worktreeRoot);
  assertContained(repository, absolute, 'managed root');
  const details = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details) return null;
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('managed worktree root must be a real directory');
  const canonical = await realpath(absolute);
  assertContained(repository, canonical, 'managed root');
  return canonical;
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
function result(path, classification, action, baseRevision = null, status = {}) { return { path, classification, action, head: status.head ?? null, base_revision: baseRevision, dirty: status.dirty ?? null, index_lock: status.indexLock ?? false }; }
function parseNull(source) { return source.split('\0').filter(Boolean); }
function normalizePath(path) { return path.replaceAll('\\', '/'); }
function assertContained(parent, child, label) { if (child !== parent && !child.startsWith(`${parent}${sep}`)) throw new Error(`${label} escapes its managed root`); }
async function pathExists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
