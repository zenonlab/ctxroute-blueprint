import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { emitDecisionEvent } from './orchestrator-telemetry.mjs';
import { canonicalMode, decisionCanResolve, hasValidPolicyDigest, resolveExecutionPolicy } from './orchestration-policy-core.mjs';

export const MODES = Object.freeze(['SWARM', 'AUTO', 'SOLO', 'GUARDED', 'DIRECT']);
export const LEGACY_MODES = Object.freeze(['SWARM_ON', 'SWARM_OFF']);
export const GOAL_STATUSES = Object.freeze(['ACTIVE', 'WAITING_FOR_USER_DECISION', 'READY_FOR_PROMOTION', 'COMPLETED', 'CANCELLED']);
export const MISSION_STATUSES = Object.freeze(['PREPARING', 'ASSIGNED', 'RUNNING', 'BLOCKED', 'COMPLETED', 'CANCELLED']);
const GOAL_TRANSITIONS = Object.freeze({ ACTIVE: ['WAITING_FOR_USER_DECISION', 'READY_FOR_PROMOTION', 'COMPLETED', 'CANCELLED'], WAITING_FOR_USER_DECISION: ['ACTIVE', 'CANCELLED'], READY_FOR_PROMOTION: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [] });
const MISSION_TRANSITIONS = Object.freeze({ PREPARING: ['ASSIGNED', 'BLOCKED', 'CANCELLED'], ASSIGNED: ['RUNNING', 'CANCELLED'], RUNNING: ['BLOCKED', 'COMPLETED', 'CANCELLED'], BLOCKED: ['RUNNING', 'CANCELLED'], COMPLETED: [], CANCELLED: [] });
const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/iu;
const DEFAULTS = Object.freeze({
  defaultMode: 'SWARM',
  statePath: '.ctxroute/orchestrator/state.json',
  worktreeRoot: '.ctxroute/worktrees',
  recoveryRoot: '.ctxroute/recovery',
  telemetryPath: '.ctxroute/orchestrator/events.jsonl',
  policySnapshotPath: '.ctxroute/orchestrator/policy.json',
  policySnapshotRoot: '.ctxroute/orchestrator/policies',
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

export function emptyOrchestratorState(mode = 'SWARM') {
  const state = { revision: 0, mode, telemetry_sequence: 0, goals: [], skills: [], audits: [], transactions: [], worktree_operations: [], decision_requests: [], decision_receipts: [], checkpoints: [], experiment_receipts: [], outcome_receipts: [] };
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
      defaultMode: config.default_mode ?? config.defaultMode,
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
    if (![...MODES, ...LEGACY_MODES].includes(override)) throw new Error(`CTXROUTE_SWARM_MODE must be one of: ${[...MODES, ...LEGACY_MODES].join(', ')}`);
    return { mode: override, mode_source: 'environment' };
  }
  const config = await loadOrchestratorConfig(root);
  const state = await readOrchestratorState(root).catch(error => error.causeCode === 'STATE_MISSING' ? null : Promise.reject(error));
  if (!state) return { mode: config.defaultMode, mode_source: 'default' };
  if (state.revision > 0 || state.mode !== config.defaultMode) return { mode: state.mode, mode_source: 'state' };
  return { mode: config.defaultMode, mode_source: 'default' };
}

export async function currentOperatingMode(root = process.cwd()) {
  const config = await loadOrchestratorConfig(root);
  const state = await readOrchestratorState(root).catch(error => error.causeCode === 'STATE_MISSING' ? null : Promise.reject(error));
  const raw = state?.mode ?? config.defaultMode;
  return { mode: canonicalMode(raw), mode_source: state && (state.revision > 0 || state.mode !== config.defaultMode) ? 'state' : 'default', legacy_value: LEGACY_MODES.includes(raw) ? raw : null };
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
  if (['operating-mode.set', 'mode.set'].includes(command.action)) return { ...state, mode: canonicalMode(payload.mode) ?? payload.mode };
  if (command.action === 'goal.create') {
    if (state.goals.some(goal => goal.goal_id === payload.goal_id)) throw new Error(`goal already exists: ${payload.goal_id}`);
    const policy = resolveExecutionPolicy({ requested_mode: payload.requested_mode ?? canonicalMode(state.mode), workflow: payload.workflow ?? 'STANDARD', capabilities: payload.capabilities ?? ['git'] });
    if (policy.resolution_status !== 'RESOLVED') throw categorized(policy.resolution_status, `goal policy did not resolve: ${policy.causes?.join(', ') ?? policy.missing_capabilities?.join(', ')}`);
    const firstStage = policy.stages[0] ?? { stage: 'inventory', strategy: 'deterministic' };
    return { ...state, goals: [...state.goals, {
      goal_id: payload.goal_id, title: payload.title.trim(), status: 'ACTIVE', missions: [],
      requested_mode: policy.requested_mode, resolved_mode: policy.mode, workflow: policy.workflow,
      policy_digest: policy.policy_digest, resolved_policy: policy,
      stage: firstStage.stage, stage_index: 0, strategy: firstStage.strategy,
      reinforcements: policy.reinforcements ?? [], policy_justification: policy.reinforcements ?? [],
      repository_baseline: payload.repository_baseline ?? null, outcome_receipt_id: null,
    }] };
  }
  if (command.action === 'goal.stage.advance') {
    const checkpoint = payload.checkpoint;
    const goal = state.goals.find(item => item.goal_id === payload.goal_id);
    if (!goal || goal.status !== 'ACTIVE') throw new Error('stage advancement requires an active goal');
    assertFrozenPolicy(goal);
    if (checkpoint.goal_id !== goal.goal_id || checkpoint.policy_digest !== goal.policy_digest || checkpoint.completed_stage !== goal.stage) throw new Error('stage checkpoint does not match the active stage');
    if (state.checkpoints.some(item => item.checkpoint_id === checkpoint.checkpoint_id)) throw new Error('stage checkpoint was already consumed');
    const nextIndex = goal.stage_index + 1;
    const next = goal.resolved_policy.stages[nextIndex];
    if (!next || next.stage !== checkpoint.next_stage) throw new Error('checkpoint next stage does not match the frozen workflow');
    const readyExperiment = goal.workflow === 'EXPERIMENT' && next.stage === 'promotion';
    if (next.strategy === 'human-decision' && !readyExperiment) throw new Error('human-decision stages require an atomic decision.request checkpoint');
    if (readyExperiment) {
      const receipt = payload.experiment_receipt;
      if (!receipt || receipt.goal_id !== goal.goal_id || receipt.policy_digest !== goal.policy_digest || receipt.status !== 'READY_FOR_PROMOTION') throw new Error('experiment terminal stage requires a matching ExperimentReceipt');
    }
    const updated = updateGoal(state, goal.goal_id, item => ({ ...item, stage: next.stage, stage_index: nextIndex, strategy: next.strategy, status: readyExperiment ? 'READY_FOR_PROMOTION' : item.status }));
    return {
      ...updated,
      checkpoints: [...updated.checkpoints, checkpoint],
      experiment_receipts: readyExperiment ? [...updated.experiment_receipts, payload.experiment_receipt] : updated.experiment_receipts,
    };
  }
  if (command.action === 'goal.transition') {
    const updated = updateGoal(state, payload.goal_id, goal => {
      assertTransition(GOAL_TRANSITIONS, goal.status, payload.status, 'goal');
      if (payload.status === 'COMPLETED') validateOutcomeForGoal(goal, payload.outcome_receipt);
      return { ...goal, status: payload.status, outcome_receipt_id: payload.outcome_receipt?.receipt_id ?? goal.outcome_receipt_id };
    });
    return payload.outcome_receipt ? { ...updated, outcome_receipts: [...(updated.outcome_receipts ?? []), payload.outcome_receipt] } : updated;
  }
  if (command.action === 'goal.policy.rebase') return updateGoal(state, payload.goal_id, goal => {
    if (!['ACTIVE', 'WAITING_FOR_USER_DECISION', 'READY_FOR_PROMOTION'].includes(goal.status)) throw new Error('policy rebase requires a safe checkpoint');
    if (goal.policy_digest !== payload.expected_policy_digest) throw new Error('policy digest mismatch');
    assertFrozenPolicy(goal);
    const checkpoint = state.checkpoints.find(item => item.checkpoint_id === payload.checkpoint_id && item.goal_id === goal.goal_id && item.policy_digest === goal.policy_digest);
    if (!checkpoint || checkpoint.next_stage !== goal.stage) throw new Error('policy rebase requires the current safe checkpoint');
    if (goal.missions.some(mission => ['ASSIGNED', 'RUNNING'].includes(mission.status))) throw new Error('policy rebase requires no active mission');
    assertPolicyRebasePreservesInvariants(goal.resolved_policy, payload.policy);
    const stageIndex = payload.policy.stages.findIndex(item => item.stage === goal.stage);
    if (stageIndex < 0) throw new Error('rebased policy must preserve the current stage');
    return { ...goal, requested_mode: payload.policy.requested_mode, resolved_mode: payload.policy.mode, workflow: payload.policy.workflow, policy_digest: payload.policy.policy_digest, resolved_policy: payload.policy, stage_index: stageIndex, strategy: payload.policy.stages[stageIndex].strategy, reinforcements: payload.policy.reinforcements ?? [], policy_justification: payload.policy.reinforcements ?? [] };
  });
  if (command.action === 'decision.request') {
    if (state.decision_requests?.some(item => item.decision_id === payload.request.decision_id)) throw new Error(`decision already exists: ${payload.request.decision_id}`);
    const goal = state.goals.find(item => item.goal_id === payload.request.goal_id);
    if (!goal || goal.policy_digest !== payload.request.policy_digest || payload.checkpoint.policy_digest !== goal.policy_digest || payload.request.checkpoint_id !== payload.checkpoint.checkpoint_id) throw new Error('decision policy digest or checkpoint mismatch');
    assertFrozenPolicy(goal);
    if (payload.checkpoint.goal_id !== goal.goal_id || payload.checkpoint.completed_stage !== goal.stage) throw new Error('decision checkpoint does not match the active stage');
    const nextIndex = goal.stage_index + 1;
    const next = goal.resolved_policy.stages[nextIndex];
    if (!next || next.stage !== payload.checkpoint.next_stage) throw new Error('decision request does not match the frozen next stage');
    const promotionDecision = goal.workflow === 'EXPERIMENT' && goal.status === 'READY_FOR_PROMOTION' && goal.stage === 'promotion' && payload.request.category === 'promotion';
    if (payload.request.category === 'promotion' && !promotionDecision) throw new Error('promotion decision requires a ready experiment');
    const updated = updateGoal(state, goal.goal_id, item => ({ ...item, status: 'WAITING_FOR_USER_DECISION' }));
    return { ...updated, decision_requests: [...(updated.decision_requests ?? []), payload.request], checkpoints: [...(updated.checkpoints ?? []), payload.checkpoint] };
  }
  if (command.action === 'decision.resolve') {
    const request = state.decision_requests?.find(item => item.decision_id === payload.receipt.decision_id && item.status === 'PENDING');
    if (!decisionCanResolve(request, payload.receipt)) throw new Error('decision receipt is incompatible with the pending request');
    const checkpoint = state.checkpoints.find(item => item.checkpoint_id === request.checkpoint_id && item.goal_id === request.goal_id && item.policy_digest === request.policy_digest);
    if (!checkpoint) throw new Error('decision checkpoint is missing');
    const updated = updateGoal(state, request.goal_id, goal => {
      assertFrozenPolicy(goal);
      if (request.category === 'promotion') return { ...goal, status: payload.receipt.selection === 'promote' ? 'READY_FOR_PROMOTION' : 'CANCELLED' };
      const nextIndex = goal.stage_index + 1;
      const next = goal.resolved_policy.stages[nextIndex];
      if (!next || next.stage !== checkpoint.next_stage) throw new Error('decision checkpoint no longer matches the frozen workflow');
      return { ...goal, status: 'ACTIVE', stage: next.stage, stage_index: nextIndex, strategy: next.strategy };
    });
    return { ...updated, decision_requests: updated.decision_requests.map(item => item.decision_id === request.decision_id ? { ...item, status: 'RESOLVED' } : item), decision_receipts: [...(updated.decision_receipts ?? []), payload.receipt] };
  }
  if (command.action === 'experiment.promote') return updateGoal(state, payload.goal_id, goal => {
    if (goal.workflow !== 'EXPERIMENT' || goal.status !== 'READY_FOR_PROMOTION') throw new Error('experiment is not ready for promotion');
    const receipt = state.decision_receipts?.find(item => item.receipt_id === payload.decision_receipt_id && item.policy_digest === goal.policy_digest && item.selection === 'promote');
    if (!receipt) throw new Error('experiment promotion requires a matching decision receipt');
    const integrationIndex = goal.resolved_policy.stages.findIndex(item => item.stage === 'integration');
    if (integrationIndex < 0) throw new Error('experiment policy has no integration stage');
    return { ...goal, status: 'ACTIVE', stage: 'integration', stage_index: integrationIndex, strategy: goal.resolved_policy.stages[integrationIndex].strategy };
  });
  if (command.action === 'mission.prepare') {
    const request = payload.mission;
    if (state.goals.some(goal => goal.missions.some(mission => mission.mission_id === request.mission_id))) throw new Error(`mission already exists: ${request.mission_id}`);
    const goal = state.goals.find(item => item.goal_id === payload.goal_id);
    assertFrozenPolicy(goal);
    const stage = goal.resolved_policy.stages[goal.stage_index];
    const record = { ...request, response_format: 'worker-report', execution_reason: request.execution === 'direct' ? 'EXPLICIT_DIRECT' : request.execution === 'coordinated' ? 'EXPLICIT_COORDINATED' : request.file_scope.length === 1 ? 'AUTO_SINGLE_SCOPE' : 'AUTO_COORDINATED', stage: stage.stage, strategy: stage.strategy, access: stage.access, policy_digest: goal.policy_digest, reinforcements: goal.reinforcements ?? [], status: 'PREPARING', worktree_allocation: null, orchestrator_commit: null, integrated_commit: null, report: null, validation_receipt: null };
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
  if (['mission.commit', 'mission.integrate', 'worktree.reconcile', 'mission.rollback', 'worktree.purge'].includes(command.action)) throw new Error(`${command.action} requires the orchestrator service effect handler`);
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

export const repositoryMutationLock = withGlobalMutationLock;

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
function entityType(action) { if (action === 'report.submit') return 'validation'; if (action.startsWith('goal.')) return 'goal'; if (action.startsWith('mission.')) return 'mission'; if (action.startsWith('worktree.')) return 'worktree'; if (action.startsWith('audit.')) return 'audit'; if (action.startsWith('skill.')) return 'skill'; if (action.endsWith('mode.set')) return 'mode'; return 'transaction'; }
function entityId(command) { return command.payload?.mission_id ?? command.payload?.report?.mission_id ?? command.payload?.goal_id ?? command.payload?.audit_id ?? command.payload?.skill_id ?? null; }
function decisionEvents(command, before, after, result, cause = null) {
  const context = policyEventContext(command, before, after);
  const common = { operation_id: command.operation_id, revision_before: before.revision, revision_after: after.revision, result, cause, ...context };
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
function policyEventContext(command, before, after) {
  const goalId = command.payload?.goal_id;
  const missionId = command.payload?.mission_id ?? command.payload?.report?.mission_id ?? command.payload?.mission?.mission_id;
  const located = missionId ? findMission(after, missionId) ?? findMission(before, missionId) : null;
  const goal = located?.goal ?? after.goals.find(item => item.goal_id === goalId) ?? before.goals.find(item => item.goal_id === goalId);
  if (!goal?.policy_digest) return {};
  const mission = located?.mission;
  return {
    requested_mode: goal.requested_mode ?? null,
    resolved_mode: goal.resolved_mode ?? null,
    workflow: goal.workflow ?? null,
    stage: mission?.stage ?? goal.stage ?? null,
    strategy: mission?.strategy ?? goal.strategy ?? null,
    policy_digest: goal.policy_digest,
    reinforcements: goal.reinforcements ?? [],
    policy_justification: goal.policy_justification ?? [],
  };
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
function validateOutcomeForGoal(goal, receipt) {
  if (!receipt || receipt.goal_id !== goal.goal_id || receipt.policy_digest !== goal.policy_digest) throw new Error('goal completion requires a matching OutcomeReceipt');
  if (goal.workflow === 'EXPERIMENT' && receipt.effect !== 'experiment') throw new Error('experiment completion requires an experiment outcome');
  if (['RESEARCH', 'AUDIT'].includes(goal.workflow) && (receipt.effect !== 'read-only' || receipt.repository_unchanged !== true)) throw new Error('read-only completion requires unchanged-repository evidence');
  if (!['RESEARCH', 'AUDIT', 'RECOVERY'].includes(goal.workflow) && !receipt.integrated_commit) throw new Error('mutation completion requires an integrated commit');
}
function assertFrozenPolicy(goal) {
  if (!goal?.resolved_policy || goal.policy_digest !== goal.resolved_policy.policy_digest || !hasValidPolicyDigest(goal.resolved_policy)) throw new Error('goal frozen policy digest is invalid');
}
function assertPolicyRebasePreservesInvariants(before, after) {
  if (after.resolution_status !== 'RESOLVED' || !hasValidPolicyDigest(after)) throw new Error('rebased policy must be a valid resolved policy');
  if (before.repository_mutation_serialized && !after.repository_mutation_serialized) throw new Error('policy rebase cannot weaken repository mutation serialization');
  if (before.isolation_required && !after.isolation_required) throw new Error('policy rebase cannot weaken mandatory isolation');
  if (before.critical_audit_required && !after.critical_audit_required) throw new Error('policy rebase cannot remove critical audit');
  if (!before.write_allowed && after.write_allowed) throw new Error('policy rebase cannot grant write access denied by the frozen policy');
  if ((after.risk_floor ?? 0) < (before.risk_floor ?? 0) || (after.model_floor ?? 0) < (before.model_floor ?? 0)) throw new Error('policy rebase cannot lower risk or model floors');
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
