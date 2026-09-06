import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { emitDecisionEvent } from './orchestrator-telemetry.mjs';

export const MODES = Object.freeze(['SWARM_ON', 'SWARM_OFF']);
export const GOAL_STATUSES = Object.freeze(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export const MISSION_STATUSES = Object.freeze(['PREPARING', 'ASSIGNED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'CANCELLED']);
const GOAL_TRANSITIONS = Object.freeze({ ACTIVE: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] });
const MISSION_TRANSITIONS = Object.freeze({ PREPARING: ['ASSIGNED', 'BLOCKED', 'CANCELLED'], ASSIGNED: ['RUNNING', 'CANCELLED'], RUNNING: ['BLOCKED', 'COMPLETED', 'CANCELLED'], BLOCKED: ['RUNNING', 'CANCELLED'], COMPLETED: [], CANCELLED: [] });
const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/iu;
const DEFAULTS = Object.freeze({
  defaultMode: 'SWARM_ON',
  statePath: '.ctxroute/orchestrator/state.json',
  worktreeRoot: '.ctxroute/worktrees',
  recoveryRoot: '.ctxroute/recovery',
  telemetryPath: '.ctxroute/orchestrator/events.jsonl',
  stateBytes: 512 * 1024,
  reportBytes: 64 * 1024,
  contextBytes: 16 * 1024,
  lockTimeoutMs: 2000,
  subprocessTimeoutMs: 30_000,
  parallelWorktrees: 8,
  minFreeBytes: 256 * 1024 * 1024,
  telemetryBytes: 1024 * 1024,
  rollbackBytes: 16 * 1024 * 1024,
  auditTraceBytes: 2 * 1024 * 1024,
  auditTraceFiles: 32,
});

export function createOrchestratorDependencies(overrides = {}) {
  return {
    now: () => new Date(),
    id: () => randomUUID(),
    processAlive: pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } },
    wait: milliseconds => new Promise(resolveWait => { setTimeout(resolveWait, milliseconds); }),
    ...overrides,
  };
}

export function emptyOrchestratorState(mode = 'SWARM_ON') {
  const state = { revision: 0, mode, telemetry_sequence: 0, goals: [], skills: [], audits: [], transactions: [], worktree_operations: [] };
  assertOrchestratorContract('state', state);
  return state;
}

export async function loadOrchestratorConfig(root = process.cwd()) {
  try {
    const source = await readFile(resolve(root, '.project/orchestrator-config.json'), 'utf8');
    const config = JSON.parse(source);
    assertOrchestratorContract('config', config);
    return {
      ...DEFAULTS,
      ...config,
      ...config.limits,
      minFreeBytes: config.limits.minimumFreeBytes,
      rollbackBytes: config.limits.recoveryBytes,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULTS };
    throw new Error(`Cannot load orchestrator config: ${error.message}`);
  }
}

export async function readOrchestratorState(root = process.cwd(), _dependencies = {}) {
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  const details = await lstat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details) throw categorized('STATE_MISSING', 'Cannot read orchestrator state: state is not initialized');
  if (!details.isFile() || details.isSymbolicLink()) throw categorized('STATE_UNSAFE', 'Cannot read orchestrator state: state path must be a regular file');
  let source;
  try { source = await readFile(path, 'utf8'); }
  catch (error) {
    throw new Error(`Cannot read orchestrator state: ${error.message}`);
  }
  if (Buffer.byteLength(source) > config.stateBytes) throw new Error('Cannot read orchestrator state: state exceeds its byte budget');
  let state;
  try { state = JSON.parse(source); } catch (error) { throw new Error(`Cannot read orchestrator state: corrupt JSON (${error.message})`); }
  try { assertNoSecrets(state); assertOrchestratorContract('state', state); }
  catch (error) { throw new Error(`Cannot read orchestrator state: ${error.message}`); }
  return state;
}

export async function currentSwarmMode(root = process.cwd(), environment = process.env) {
  const override = environment.CTXROUTE_SWARM_MODE;
  if (override !== undefined) {
    if (!MODES.includes(override)) throw new Error(`CTXROUTE_SWARM_MODE must be one of: ${MODES.join(', ')}`);
    return { mode: override, mode_source: 'environment' };
  }
  const config = await loadOrchestratorConfig(root);
  const state = await readOrchestratorState(root).catch(error => error.causeCode === 'STATE_MISSING' ? null : Promise.reject(error));
  if (!state) return { mode: config.defaultMode, mode_source: 'default' };
  if (state.revision > 0 || state.mode !== config.defaultMode) return { mode: state.mode, mode_source: 'state' };
  return { mode: config.defaultMode, mode_source: 'default' };
}

export async function beginOrchestratorTransaction(command, root = process.cwd(), dependencies = {}, intentMutation = null) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => beginOrchestratorTransaction(command, root, locked, intentMutation));
  assertNoSecrets(command);
  assertOrchestratorContract('transaction', command);
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  const deps = createOrchestratorDependencies(dependencies);
  await ensureOrchestratorState(root, deps);
  return withLock(`${path}.lock`, config.lockTimeoutMs, deps, async () => {
    const state = await readOrchestratorState(root, deps);
    const digest = transactionDigest(command);
    const prior = state.transactions.find(item => item.operation_id === command.operation_id);
    if (prior) {
      if (prior.digest !== digest || prior.action !== command.action) throw new Error(`operation_id reused with different payload: ${command.operation_id}`);
      return { replayed: true, pending: prior.status === 'PENDING', receipt: prior, state };
    }
    if (command.expected_revision !== state.revision) throw new Error(`revision conflict: expected ${command.expected_revision}, actual ${state.revision}`);
    const receipt = { operation_id: command.operation_id, digest, action: command.action, intent: structuredClone(command.payload), status: 'PENDING', start_revision: state.revision, end_revision: null, result: null, cause: null };
    const intended = intentMutation ? await intentMutation(state) : state;
    const next = { ...intended, revision: state.revision + 1, telemetry_sequence: state.telemetry_sequence + 1, transactions: [...intended.transactions, receipt] };
    assertOrchestratorContract('state', next);
    await atomicWriteState(path, next, config.stateBytes, deps);
    await emitSafely(root, config, { sequence: next.telemetry_sequence, event_type: 'TRANSACTION', operation_id: command.operation_id, revision_before: state.revision, revision_after: next.revision, entity_type: 'transaction', entity_id: command.operation_id }, deps);
    return { replayed: false, pending: true, receipt, state: next };
  });
}

export async function completeOrchestratorTransaction(command, mutation, result = 'UPDATED', root = process.cwd(), dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => completeOrchestratorTransaction(command, mutation, result, root, locked));
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  const deps = createOrchestratorDependencies(dependencies);
  return withLock(`${path}.lock`, config.lockTimeoutMs, deps, async () => {
    const state = await readOrchestratorState(root, deps);
    const index = state.transactions.findIndex(item => item.operation_id === command.operation_id);
    if (index < 0) throw new Error(`transaction intent is missing: ${command.operation_id}`);
    const prior = state.transactions[index];
    if (prior.digest !== transactionDigest(command)) throw new Error(`operation_id reused with different payload: ${command.operation_id}`);
    if (prior.status === 'COMPLETED') return { replayed: true, pending: false, receipt: prior, state };
    if (prior.status === 'BLOCKED') return { replayed: true, blocked: true, receipt: prior, state };
    const mutated = mutation ? await mutation(state) : applyOperation(state, command);
    const revision = state.revision + 1;
    const receipt = { ...prior, status: 'COMPLETED', end_revision: revision, result, cause: null };
    const transactions = [...mutated.transactions];
    transactions[index] = receipt;
    const provisional = { ...mutated, revision, transactions };
    const events = decisionEvents(command, state, provisional, result === 'UNCHANGED' ? 'NO_CHANGE' : 'SUCCESS');
    const next = { ...provisional, telemetry_sequence: state.telemetry_sequence + events.length };
    assertNoSecrets(next);
    assertOrchestratorContract('state', next);
    await atomicWriteState(path, next, config.stateBytes, deps);
    for (const [offset, event] of events.entries()) await emitSafely(root, config, { ...event, sequence: state.telemetry_sequence + offset + 1 }, deps);
    return { replayed: false, pending: false, receipt, state: next };
  });
}

export async function blockOrchestratorTransaction(command, cause, root = process.cwd(), dependencies = {}, mutation = null) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => blockOrchestratorTransaction(command, cause, root, locked, mutation));
  if (!/^[A-Z][A-Z0-9_]{0,63}$/u.test(cause)) cause = 'UNCLASSIFIED_FAILURE';
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  const deps = createOrchestratorDependencies(dependencies);
  return withLock(`${path}.lock`, config.lockTimeoutMs, deps, async () => {
    const state = await readOrchestratorState(root, deps);
    const index = state.transactions.findIndex(item => item.operation_id === command.operation_id);
    if (index < 0) throw new Error(`transaction intent is missing: ${command.operation_id}`);
    const prior = state.transactions[index];
    if (prior.digest !== transactionDigest(command)) throw new Error(`operation_id reused with different payload: ${command.operation_id}`);
    if (prior.status !== 'PENDING') return { replayed: true, blocked: prior.status === 'BLOCKED', receipt: prior, state };
    const blockedState = mutation ? await mutation(state) : state;
    const revision = state.revision + 1;
    const receipt = { ...prior, status: 'BLOCKED', end_revision: revision, result: null, cause };
    const transactions = [...blockedState.transactions]; transactions[index] = receipt;
    const provisional = { ...blockedState, revision, transactions };
    const events = decisionEvents(command, state, provisional, 'BLOCKED', cause);
    const next = { ...provisional, telemetry_sequence: state.telemetry_sequence + events.length };
    assertOrchestratorContract('state', next);
    await atomicWriteState(path, next, config.stateBytes, deps);
    for (const [offset, event] of events.entries()) await emitSafely(root, config, { ...event, sequence: state.telemetry_sequence + offset + 1 }, deps);
    return { replayed: false, blocked: true, receipt, state: next };
  });
}

export async function transactOrchestrator(command, root = process.cwd(), dependencies = {}) {
  return withGlobalMutationLock(root, dependencies, async locked => {
    const begun = await beginOrchestratorTransaction(command, root, locked);
    if (begun.replayed && !begun.pending) return begun;
    try { return await completeOrchestratorTransaction(command, null, operationResult(command.action), root, locked); }
    catch (error) {
      await blockOrchestratorTransaction(command, error.causeCode ?? 'OPERATION_REJECTED', root, locked).catch(() => {});
      throw error;
    }
  });
}

export function validateWorkerReport(report, maximumBytes = DEFAULTS.reportBytes) { return validateContract('worker-report', report, maximumBytes, 'worker report'); }
export function validateAuditReport(report, maximumBytes = DEFAULTS.reportBytes) { return validateContract('audit-report', report, maximumBytes, 'audit report'); }
export function validateState(state) { try { assertNoSecrets(state); assertOrchestratorContract('state', state); return []; } catch (error) { return [error.message]; } }
export function transactionDigest(command) { return createHash('sha256').update(stableJson({ action: command.action, payload: command.payload })).digest('hex'); }

function applyOperation(state, command) {
  const payload = command.payload;
  if (command.action === 'mode.set') return { ...state, mode: payload.mode };
  if (command.action === 'goal.create') {
    if (state.goals.some(goal => goal.goal_id === payload.goal_id)) throw new Error(`goal already exists: ${payload.goal_id}`);
    return { ...state, goals: [...state.goals, { goal_id: payload.goal_id, title: payload.title.trim(), status: 'ACTIVE', missions: [] }] };
  }
  if (command.action === 'goal.transition') return updateGoal(state, payload.goal_id, goal => {
    assertTransition(GOAL_TRANSITIONS, goal.status, payload.status, 'goal');
    return { ...goal, status: payload.status };
  });
  if (command.action === 'mission.prepare') {
    const request = payload.mission;
    if (state.goals.some(goal => goal.missions.some(mission => mission.mission_id === request.mission_id))) throw new Error(`mission already exists: ${request.mission_id}`);
    const record = { ...request, response_format: 'worker-report', execution_reason: request.execution === 'direct' ? 'EXPLICIT_DIRECT' : request.execution === 'coordinated' ? 'EXPLICIT_COORDINATED' : request.file_scope.length === 1 ? 'AUTO_SINGLE_SCOPE' : 'AUTO_COORDINATED', status: 'PREPARING', worktree_allocation: null, report: null, validation_receipt: null };
    assertOrchestratorContract('mission-record', record);
    return addMission(state, payload.goal_id, record);
  }
  if (command.action === 'mission.transition') return updateMission(state, payload.goal_id, payload.mission_id, mission => {
    assertTransition(MISSION_TRANSITIONS, mission.status, payload.status, 'mission');
    if (payload.status === 'COMPLETED' && mission.validation_receipt?.status !== 'PASSED') throw new Error('mission completion requires an orchestrator PASSED receipt');
    return { ...mission, status: payload.status };
  });
  if (command.action === 'report.submit') return updateMission(state, payload.goal_id, payload.report.mission_id, mission => ({ ...mission, report: payload.report, status: 'BLOCKED' }));
  if (command.action === 'audit.apply') {
    if (state.audits.some(audit => audit.audit_id === payload.report.audit_id)) throw new Error(`audit already exists: ${payload.report.audit_id}`);
    return { ...state, audits: [...state.audits, payload.report] };
  }
  if (command.action === 'skill.register') {
    if (state.skills.some(skill => skill.skill_id === payload.skill_id)) throw new Error(`skill already registered: ${payload.skill_id}`);
    return { ...state, skills: [...state.skills, { skill_id: payload.skill_id, version: payload.version, path: payload.path, artifact_digest: payload.artifact_digest, validation_receipt: payload.validation_receipt, audit_id: payload.audit_id, registered_revision: state.revision + 1 }] };
  }
  if (['worktree.reconcile', 'mission.rollback', 'worktree.purge'].includes(command.action)) throw new Error(`${command.action} requires the orchestrator service effect handler`);
  throw new Error(`unsupported orchestrator action: ${command.action}`);
}

function addMission(state, goalId, mission) { return updateGoal(state, goalId, goal => ({ ...goal, missions: [...goal.missions, mission] })); }
export function updateGoal(state, goalId, operation) { const index = state.goals.findIndex(goal => goal.goal_id === goalId); if (index < 0) throw new Error(`unknown goal: ${goalId}`); const goals = [...state.goals]; goals[index] = operation(goals[index]); return { ...state, goals }; }
export function updateMission(state, goalId, missionId, operation) { return updateGoal(state, goalId, goal => { const index = goal.missions.findIndex(mission => mission.mission_id === missionId); if (index < 0) throw new Error(`unknown mission: ${missionId}`); const missions = [...goal.missions]; missions[index] = operation(missions[index]); return { ...goal, missions }; }); }
export function findMission(state, missionId) { return state.goals.flatMap(goal => goal.missions.map(mission => ({ goal, mission }))).find(item => item.mission.mission_id === missionId) ?? null; }

export async function ensureOrchestratorState(root = process.cwd(), dependencies = {}) {
  const deps = createOrchestratorDependencies(dependencies);
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  const details = await lstat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details) {
    const initial = emptyOrchestratorState(config.defaultMode);
    await atomicWriteState(path, initial, config.stateBytes, deps);
    const cleaned = await cleanupDeadStateTemporaries(path, deps);
    return { state: initial, initialized: true, cleaned };
  }
  if (!details.isFile() || details.isSymbolicLink()) throw categorized('STATE_UNSAFE', 'Cannot bootstrap orchestrator state: state path must be a regular file');
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source) > config.stateBytes) throw categorized('STATE_TOO_LARGE', 'Cannot bootstrap orchestrator state: state exceeds its byte budget');
  let state;
  try { state = JSON.parse(source); } catch (error) { throw categorized('STATE_CORRUPT', `Cannot bootstrap orchestrator state: corrupt JSON (${error.message})`); }
  assertNoSecrets(state); assertOrchestratorContract('state', state);
  const cleaned = await cleanupDeadStateTemporaries(path, deps);
  return { state, initialized: false, cleaned };
}

async function cleanupDeadStateTemporaries(path, deps) {
  const directory = dirname(path);
  const pattern = new RegExp(`^${escapeRegex(basename(path))}\\.([1-9][0-9]*)\\.[a-z0-9-]{1,128}\\.tmp$`, 'u');
  const names = await readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  let cleaned = false;
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match || deps.processAlive(Number(match[1]))) continue;
    const temporary = resolve(directory, name);
    const details = await lstat(temporary);
    if (!details.isFile() || details.isSymbolicLink()) throw categorized('STATE_TEMP_UNSAFE', 'Cannot bootstrap orchestrator state: temporary path is unsafe');
    await unlink(temporary);
    cleaned = true;
  }
  return cleaned;
}

async function atomicWriteState(path, state, maximumBytes, deps) {
  const source = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(source) > maximumBytes) throw new Error(`orchestrator state exceeds ${maximumBytes} bytes`);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${deps.id()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source, 'utf8'); await handle.sync(); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } finally { await handle.close(); }
  await deps.fault?.('beforeStateRename');
  await rename(temporary, path);
  await deps.fault?.('afterStateRename');
  const directory = await open(dirname(path), constants.O_RDONLY).catch(() => null);
  try { await directory?.sync(); } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EPERM'].includes(error.code)) throw error; } finally { await directory?.close(); }
}

async function withLock(path, timeoutMs, deps, operation) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const started = deps.now().getTime();
  const token = deps.id();
  let handle;
  while (!handle) {
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, created_at: deps.now().toISOString() })}\n`);
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {}); handle = null;
      if (error.code !== 'EEXIST') throw error;
      await recoverStaleLock(path, deps);
      if (deps.now().getTime() - started >= timeoutMs) throw new Error('orchestrator transaction lock timeout');
      await deps.wait(25);
    }
  }
  try { return await operation(); }
  finally {
    await handle.close();
    const current = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
    if (current?.token === token) await unlink(path).catch(() => {});
  }
}

export async function withGlobalMutationLock(root = process.cwd(), dependencies = {}, operation) {
  const canonicalRoot = resolve(root);
  const deps = createOrchestratorDependencies(dependencies);
  if (deps.globalMutationRoot === canonicalRoot) return operation(deps);
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, `${config.statePath}.mutation.lock`);
  return withLock(path, config.lockTimeoutMs, deps, () => operation({ ...deps, globalMutationRoot: canonicalRoot }));
}

async function recoverStaleLock(path, deps) {
  let first;
  try { first = JSON.parse(await readFile(path, 'utf8')); } catch { return; }
  if (!first?.token || !Number.isInteger(first.pid) || Number.isNaN(Date.parse(first.created_at))) return;
  if (deps.processAlive(first.pid)) return;
  const second = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
  if (second?.token === first.token) await unlink(path).catch(() => {});
}

function validateContract(name, value, maximumBytes, label) { try { const source = JSON.stringify(value); if (Buffer.byteLength(source) > maximumBytes) throw new Error(`${label} exceeds ${maximumBytes} bytes`); assertNoSecrets(value); assertOrchestratorContract(name, value); return []; } catch (error) { return [error.message]; } }
export function assertNoSecrets(value, key = '', depth = 0) { if (depth > 16) throw new Error('object exceeds safe inspection depth'); if (SECRET_KEY.test(key)) throw new Error('secret-like key is forbidden'); if (value === String(value) && SECRET_VALUE.test(value)) throw new Error('secret-like material is forbidden'); if (Array.isArray(value)) value.forEach(item => assertNoSecrets(item, key, depth + 1)); else if (value && value === Object(value)) Object.entries(value).forEach(([name, item]) => assertNoSecrets(item, name, depth + 1)); }
export function safeRelativePath(value) { if (value !== String(value) || value.length === 0 || value.length > 1024 || isAbsolute(value) || value.startsWith('~') || [...value].some(character => character.codePointAt(0) < 32)) return false; const normalized = value.replaceAll('\\', '/').replace(/\/$/u, ''); if (normalized === '.') return true; return Boolean(normalized) && !normalized.split('/').includes('..') && relative('.', normalized).replaceAll('\\', '/') === normalized; }
function assertTransition(graph, before, after, label) { if (before === after) return; if (!graph[before]?.includes(after)) throw new Error(`illegal ${label} transition: ${before} -> ${after}`); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && value === Object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function operationResult(action) { if (action.endsWith('.create') || action === 'mission.prepare' || action === 'skill.register') return 'CREATED'; if (action === 'worktree.reconcile') return 'RECONCILED'; if (action === 'mission.rollback') return 'ROLLED_BACK'; if (action === 'worktree.purge') return 'PURGED'; return 'UPDATED'; }
async function emitSafely(root, config, event, deps) { try { if (deps.emitTelemetry) await deps.emitTelemetry(root, config, event); else await emitDecisionEvent(root, config, event, deps); } catch { /* State remains authoritative when telemetry is unavailable. */ } }
function eventType(action) { if (action === 'report.submit') return 'VALIDATION'; if (action === 'audit.apply') return 'AUDIT'; if (action === 'skill.register') return 'SKILL_REGISTRATION'; if (action === 'worktree.reconcile') return 'RECONCILIATION'; if (action === 'mission.rollback') return 'ROLLBACK'; if (action === 'worktree.purge') return 'PURGE'; if (action.includes('transition')) return 'TRANSITION'; return 'TRANSACTION'; }
function entityType(action) { if (action === 'report.submit') return 'validation'; if (action.startsWith('goal.')) return 'goal'; if (action.startsWith('mission.')) return 'mission'; if (action.startsWith('worktree.')) return 'worktree'; if (action.startsWith('audit.')) return 'audit'; if (action.startsWith('skill.')) return 'skill'; if (action.startsWith('mode.')) return 'mode'; return 'transaction'; }
function entityId(command) { return command.payload?.mission_id ?? command.payload?.report?.mission_id ?? command.payload?.goal_id ?? command.payload?.audit_id ?? command.payload?.skill_id ?? null; }
function decisionEvents(command, before, after, result, cause = null) {
  const common = { operation_id: command.operation_id, revision_before: before.revision, revision_after: after.revision, result, cause };
  const events = [];
  const beforeEntity = transitionEntity(before, command);
  const afterEntity = transitionEntity(after, command);
  if (beforeEntity?.status && afterEntity?.status && beforeEntity.status !== afterEntity.status) {
    const transition = `${beforeEntity.status}->${afterEntity.status}`;
    events.push({ ...common, event_type: 'TRANSITION', entity_type: command.action.startsWith('goal.') ? 'goal' : 'mission', entity_id: entityId(command), transition, policy_id: transitionPolicy(command.action), schema_id: command.action.startsWith('goal.') ? 'state' : 'mission-record', git_oid_before: beforeEntity.worktree_allocation?.base_revision ?? null, git_oid_after: afterEntity.worktree_allocation?.base_revision ?? null, evidence_digest: evidenceDigest({ transition, cause }) });
  }
  const validationResults = command.action === 'report.submit' ? afterEntity?.validation_receipt?.results ?? [] : [];
  for (const item of validationResults) events.push({ ...common, event_type: 'VALIDATION', entity_type: 'validation', entity_id: item.id, validation_id: item.id, duration_ms: item.duration_ms, exit_code: item.exit_code, policy_id: 'mission-validation', schema_id: 'validation-receipt', git_oid_before: beforeEntity?.worktree_allocation?.base_revision ?? null, git_oid_after: afterEntity?.worktree_allocation?.base_revision ?? null, evidence_digest: evidenceDigest({ id: item.id, status: item.status, exit_code: item.exit_code, cause: item.cause }) });
  if (events.length === 0) events.push({ ...common, event_type: cause ? 'BLOCKED' : eventType(command.action), entity_type: entityType(command.action), entity_id: entityId(command), policy_id: actionPolicy(command.action), schema_id: 'transaction', evidence_digest: evidenceDigest({ action: command.action, result, cause }) });
  return events;
}
function transitionEntity(state, command) {
  if (command.action.startsWith('goal.')) return state.goals.find(goal => goal.goal_id === command.payload.goal_id) ?? null;
  const missionId = command.payload?.mission_id ?? command.payload?.report?.mission_id ?? command.payload?.mission?.mission_id;
  return missionId ? findMission(state, missionId)?.mission ?? null : null;
}
function transitionPolicy(action) { return action.startsWith('goal.') ? 'goal-transition' : 'mission-transition'; }
function actionPolicy(action) { return action.replaceAll('.', '-'); }
function evidenceDigest(value) { return createHash('sha256').update(stableJson(value)).digest('hex'); }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
