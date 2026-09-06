import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  beginOrchestratorTransaction, blockOrchestratorTransaction, completeOrchestratorTransaction,
  currentSwarmMode, findMission, loadOrchestratorConfig, readOrchestratorState, transactOrchestrator, updateMission, withGlobalMutationLock,
} from './orchestrator-core.mjs';
import { assertBootstrapAllows, bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { runMissionValidations } from './orchestrator-validation.mjs';
import {
  inspectMissionChanges, prepareMissionWorktree, purgeMissionWorktree, reconcileManagedWorktrees,
  recoverMissionWorktree, rollbackMissionWorktree,
} from './worktree-manager.mjs';
import { queryCtxroute } from './ctxroute-query.mjs';

export async function readCoordination(root = process.cwd(), environment = process.env) {
  const state = await readOrchestratorState(root);
  if (environment.CTXROUTE_AGENT_ROLE !== 'worker') return state;
  const found = findMission(state, environment.CTXROUTE_MISSION_ID);
  if (!found?.mission.worktree_allocation?.path) throw new Error('worker role requires an assigned CTXROUTE_MISSION_ID');
  const mission = found.mission;
  const view = { mission_id: mission.mission_id, file_scope: mission.file_scope, skill_id: mission.skill_id, skill_version: mission.skill_version, acceptance: mission.acceptance, validations: mission.validations, response_format: mission.response_format, worktree: mission.worktree_allocation.path };
  assertOrchestratorContract('mission-view-v2', view);
  return view;
}

export async function mutateCoordination(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => mutateCoordination(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment);
  if (command.action === 'skill.register') await assertSkillRegistration(command.payload, root);
  if (['mission.prepare', 'report.submit', 'worktree.reconcile', 'mission.rollback', 'worktree.purge'].includes(command.action)) throw new Error(`${command.action} must use its dedicated service operation`);
  return transactOrchestrator(command, root, dependencies);
}

export async function prepareMission(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => prepareMission(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment);
  assertOrchestratorContract('transaction-v2', command);
  if (command.action !== 'mission.prepare') throw new Error('prepare-mission requires action mission.prepare');
  const effective = await currentSwarmMode(root, environment);
  const request = routeMissingSkill(command.payload.mission, root);
  const decision = executionDecision(effective, request);
  const normalized = { ...command, payload: { ...command.payload, mission: request } };
  if (!decision.coordinated) {
    const begun = await beginOrchestratorTransaction(normalized, root, dependencies);
    if (begun.replayed && !begun.pending) return { ...begun, bypassed: true, mode: effective.mode, mode_source: effective.mode_source, reason: decision.reason };
    const completed = await completeOrchestratorTransaction(normalized, state => state, 'BYPASSED', root, dependencies);
    return { ...completed, bypassed: true, mode: effective.mode, mode_source: effective.mode_source, reason: decision.reason };
  }
  const record = missionRecord(request, decision.reason);
  const config = await loadOrchestratorConfig(root);
  const pendingWorktree = { operation_id: command.operation_id, mission_id: request.mission_id, kind: 'ALLOCATE', status: 'PENDING', classification: 'NEEDS_ATTENTION', path: `${config.worktreeRoot}/${request.mission_id}`, base_revision: null, dirty: null, proof_ref: null, cause: null };
  const begun = await beginOrchestratorTransaction(normalized, root, dependencies, state => addPreparingMission(state, command.payload.goal_id, record, pendingWorktree));
  if (begun.replayed && !begun.pending) return { ...begun, mode: effective.mode, mode_source: effective.mode_source };
  try {
    let allocation;
    try { allocation = await recoverMissionWorktree(request.mission_id, root, dependencies); }
    catch (error) {
      if (!/does not exist/u.test(error.message)) throw error;
      allocation = await prepareMissionWorktree(request.mission_id, root, dependencies);
    }
    const completed = await completeOrchestratorTransaction(normalized, state => {
      const updated = updateMission(state, command.payload.goal_id, request.mission_id, mission => ({ ...mission, status: 'ASSIGNED', worktree_allocation: { path: allocation.path, base_revision: allocation.base, status: 'ACTIVE', recovery_proof: null } }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'ACTIVE_COHERENT', base_revision: allocation.base, dirty: false } : item) };
    }, 'CREATED', root, dependencies);
    return { ...completed, mode: effective.mode, mode_source: effective.mode_source, reason: decision.reason };
  } catch (error) {
    if (error.simulatedCrash) throw error;
    const cause = error.causeCode ?? 'WORKTREE_ALLOCATION_FAILED';
    await blockOrchestratorTransaction(normalized, cause, root, dependencies, state => {
      const updated = updateMission(state, command.payload.goal_id, request.mission_id, mission => ({ ...mission, status: 'BLOCKED' }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'BLOCKED', classification: cause === 'INSUFFICIENT_SPACE' ? 'LOW_DISK' : 'NEEDS_ATTENTION', cause } : item) };
    });
    throw error;
  }
}

export async function submitWorkerReport(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => submitWorkerReport(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorContract('transaction-v2', command);
  if (command.action !== 'report.submit') throw new Error('submit-report requires action report.submit');
  const report = command.payload.report;
  if (environment.CTXROUTE_AGENT_ROLE === 'worker' && environment.CTXROUTE_MISSION_ID !== report.mission_id) throw new Error('worker may submit only its assigned mission report');
  const state = await readOrchestratorState(root);
  const found = findMission(state, report.mission_id);
  if (!found || found.goal.goal_id !== command.payload.goal_id) throw new Error(`unknown mission: ${report.mission_id}`);
  const mission = found.mission;
  if (!['RUNNING', 'BLOCKED'].includes(mission.status)) throw new Error(`mission cannot report from ${mission.status}`);
  const begun = await beginOrchestratorTransaction(command, root, dependencies);
  if (begun.replayed && !begun.pending) return begun;
  try {
    if (!mission.worktree_allocation?.path) throw new Error('mission has no active worktree');
    const inspection = await inspectMissionChanges(mission.worktree_allocation.path, mission.file_scope, root, mission.worktree_allocation.base_revision, dependencies);
    if (!inspection.ok) throw categorized('OUTSIDE_SCOPE', `worktree changed files outside mission scope: ${inspection.outsideScope.join(', ')}`);
    const reported = [...report.files_touched].sort();
    if (JSON.stringify(reported) !== JSON.stringify(inspection.files)) throw categorized('REPORT_DIFF_MISMATCH', 'worker report files_touched does not match the worktree diff');
    if (report.status === 'BLOCKED') return blockOrchestratorTransaction(command, 'WORKER_BLOCKED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'BLOCKED', report })));
    const worktree = resolve(root, mission.worktree_allocation.path);
    const receipt = await runMissionValidations(mission, worktree, root, dependencies);
    if (receipt.status !== 'PASSED') return blockOrchestratorTransaction(command, receipt.status === 'TIMED_OUT' ? 'VALIDATION_TIMEOUT' : 'VALIDATION_FAILED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'BLOCKED', report, validation_receipt: receipt })));
    return completeOrchestratorTransaction(command, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'COMPLETED', report, validation_receipt: receipt })), 'UPDATED', root, dependencies);
  } catch (error) {
    await blockOrchestratorTransaction(command, error.causeCode ?? 'REPORT_REJECTED', root, dependencies).catch(() => {});
    throw error;
  }
}

export async function reconcileWorktrees(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => reconcileWorktrees(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'worktree.reconcile');
  const plan = await reconcileManagedWorktrees(root, { ...dependencies, repair: false });
  const begun = await beginOrchestratorTransaction(command, root, dependencies, state => ({ ...state, worktree_operations: [...state.worktree_operations, ...reconciliationOperations(state, command.operation_id, plan, 'PENDING')] }));
  if (begun.replayed && !begun.pending) return begun;
  try {
    const reconciliation = await reconcileManagedWorktrees(root, { ...dependencies, repair: command.payload.repair });
    return completeOrchestratorTransaction(command, state => applyReconciliation(state, command.operation_id, reconciliation), 'RECONCILED', root, dependencies);
  } catch (error) { await blockOrchestratorTransaction(command, error.causeCode ?? 'RECONCILIATION_FAILED', root, dependencies); throw error; }
}

export async function rollbackMission(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => rollbackMission(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'mission.rollback');
  const begun = await beginOrchestratorTransaction(command, root, dependencies, state => {
    const entry = findMission(state, command.payload.mission_id);
    if (!entry || entry.goal.goal_id !== command.payload.goal_id || !entry.mission.worktree_allocation) throw new Error(`unknown mission: ${command.payload.mission_id}`);
    const operation = { operation_id: command.operation_id, mission_id: entry.mission.mission_id, kind: 'ROLLBACK', status: 'PENDING', classification: 'NEEDS_ATTENTION', path: entry.mission.worktree_allocation.path, base_revision: entry.mission.worktree_allocation.base_revision, dirty: null, proof_ref: null, cause: null };
    return { ...state, worktree_operations: [...state.worktree_operations, operation] };
  });
  if (begun.replayed && !begun.pending) return begun;
  const found = findMission(begun.state, command.payload.mission_id);
  if (!found || found.goal.goal_id !== command.payload.goal_id) throw new Error(`unknown mission: ${command.payload.mission_id}`);
  try {
    const rollback = await rollbackMissionWorktree(found.mission, root, dependencies);
    return completeOrchestratorTransaction(command, state => {
      const updated = updateMission(state, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'ROLLED_BACK', recovery_proof: rollback.proof }, status: mission.status === 'COMPLETED' ? mission.status : 'CANCELLED' }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'ROLLED_BACK', proof_ref: rollback.proof } : item) };
    }, 'ROLLED_BACK', root, dependencies);
  } catch (error) { const cause = error.causeCode ?? 'ROLLBACK_FAILED'; await blockOrchestratorTransaction(command, cause, root, dependencies, state => ({ ...state, worktree_operations: state.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'BLOCKED', cause } : item) })); throw error; }
}

export async function purgeWorktree(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => purgeWorktree(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'worktree.purge');
  const begun = await beginOrchestratorTransaction(command, root, dependencies, state => {
    const entry = findMission(state, command.payload.mission_id);
    if (!entry || entry.goal.goal_id !== command.payload.goal_id || !entry.mission.worktree_allocation) throw new Error(`unknown mission: ${command.payload.mission_id}`);
    const operation = { operation_id: command.operation_id, mission_id: entry.mission.mission_id, kind: 'PURGE', status: 'PENDING', classification: 'NEEDS_ATTENTION', path: entry.mission.worktree_allocation.path, base_revision: entry.mission.worktree_allocation.base_revision, dirty: null, proof_ref: null, cause: null };
    return { ...state, worktree_operations: [...state.worktree_operations, operation] };
  });
  if (begun.replayed && !begun.pending) return begun;
  const found = findMission(begun.state, command.payload.mission_id);
  if (!found || found.goal.goal_id !== command.payload.goal_id) throw new Error(`unknown mission: ${command.payload.mission_id}`);
  try {
    await purgeMissionWorktree({ ...command.payload, worktree: found.mission.worktree_allocation?.path }, root, dependencies);
    return completeOrchestratorTransaction(command, state => {
      const updated = updateMission(state, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'REMOVED' }, status: ['COMPLETED', 'CANCELLED'].includes(mission.status) ? mission.status : 'CANCELLED' }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'PURGED' } : item) };
    }, 'PURGED', root, dependencies);
  } catch (error) { const cause = error.causeCode ?? 'PURGE_FAILED'; await blockOrchestratorTransaction(command, cause, root, dependencies, state => ({ ...state, worktree_operations: state.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'BLOCKED', cause } : item) })); throw error; }
}

export async function contextQuery(input, root = process.cwd()) { return queryCtxroute(input, root); }

function missionRecord(request, reason) { const record = { ...request, response_format: 'worker-report-v2', execution_reason: reason, status: 'PREPARING', worktree_allocation: null, report: null, validation_receipt: null }; assertOrchestratorContract('mission-record-v2', record); return record; }
function addPreparingMission(state, goalId, record, worktreeOperation) {
  const goalIndex = state.goals.findIndex(goal => goal.goal_id === goalId);
  if (goalIndex < 0 || state.goals[goalIndex].status !== 'ACTIVE') throw new Error(`unknown or terminal goal: ${goalId}`);
  if (findMission(state, record.mission_id)) throw new Error(`mission already exists: ${record.mission_id}`);
  const active = state.goals.flatMap(goal => goal.missions).filter(mission => !['COMPLETED', 'CANCELLED'].includes(mission.status));
  if (active.some(mission => mission.file_scope.some(left => record.file_scope.some(right => scopesOverlap(left, right))))) throw new Error('mission file_scope overlaps an active worker');
  const goals = [...state.goals]; goals[goalIndex] = { ...goals[goalIndex], missions: [...goals[goalIndex].missions, record] }; return { ...state, goals, worktree_operations: [...state.worktree_operations, worktreeOperation] };
}
function executionDecision(effective, request) {
  if (effective.mode === 'SWARM_OFF') return { coordinated: false, reason: effective.mode_source === 'environment' ? 'ENVIRONMENT_SWARM_OFF' : effective.mode_source === 'state' ? 'PERSISTED_MODE' : 'DEFAULT_MODE' };
  if (request.execution === 'direct') return { coordinated: false, reason: 'EXPLICIT_DIRECT' };
  if (request.execution === 'coordinated') return { coordinated: true, reason: 'EXPLICIT_COORDINATED' };
  return request.file_scope.length === 1 ? { coordinated: false, reason: 'AUTO_SINGLE_SCOPE' } : { coordinated: true, reason: 'AUTO_COORDINATED' };
}
function routeMissingSkill(mission, root) {
  assertOrchestratorContract('mission-request-v2', mission);
  if (existsSync(resolve(root, `.agents/skills/${mission.skill_id}/SKILL.md`))) return mission;
  if (!existsSync(resolve(root, '.agents/skills/skill-creator/SKILL.md'))) throw new Error(`selected skill is missing and skill-creator is unavailable: ${mission.skill_id}`);
  return { ...mission, requested_skill_id: mission.skill_id, skill_id: 'skill-creator', skill_version: '1.0.0', file_scope: [`.agents/skills/${mission.skill_id}/`], acceptance: [`Create and validate the missing ${mission.skill_id} skill`, 'Obtain blueprint-audit review'], validations: [{ id: 'skills-validate', executable: 'node', args: ['scripts/validate-blueprint-skills.mjs'], cwd: '.', timeout_ms: 30_000 }, { id: 'blueprint-review', executable: 'node', args: ['scripts/blueprint-review.mjs'], cwd: '.', timeout_ms: 30_000 }], execution: 'coordinated' };
}
async function assertSkillRegistration(payload, root) {
  const skillRoot = resolve(root, `.agents/skills/${payload.skill_id}`);
  const skill = await readFile(resolve(skillRoot, 'SKILL.md'));
  const companion = await readFile(resolve(skillRoot, 'blueprint.json'));
  JSON.parse(companion);
  const digest = createHash('sha256').update(skill).update(companion).digest('hex');
  if (digest !== payload.artifact_digest) throw new Error('skill artifact digest mismatch');
  if (payload.validation_receipt.status !== 'PASSED') throw new Error('skill registration requires a successful validation receipt');
  const state = await readOrchestratorState(root);
  const audit = state.audits.find(item => item.audit_id === payload.audit_id);
  if (!audit || audit.audit_type !== 'blueprint-audit' || audit.decision !== 'accept') throw new Error('skill registration requires an accepted blueprint-audit');
}
function applyReconciliation(state, operationId, reconciliation) {
  let next = state;
  const operations = [];
  for (const item of reconciliation.results) {
    const found = state.goals.flatMap(goal => goal.missions.map(mission => ({ goal, mission }))).find(entry => entry.mission.worktree_allocation?.path === item.path);
    if (found && item.action === 'REMOVED') next = updateMission(next, found.goal.goal_id, found.mission.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'REMOVED' } }));
    if (found && item.action === 'NEEDS_ATTENTION') next = updateMission(next, found.goal.goal_id, found.mission.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'NEEDS_ATTENTION' } }));
    if (found) operations.push({ operation_id: operationId, mission_id: found.mission.mission_id, kind: 'RECONCILE', status: 'COMPLETED', classification: mapClassification(item.classification), path: item.path, base_revision: found.mission.worktree_allocation.base_revision, dirty: item.dirty, proof_ref: null, cause: item.action === 'NEEDS_ATTENTION' ? 'NEEDS_ATTENTION' : null });
  }
  const keys = new Set(operations.map(item => `${item.operation_id}\0${item.mission_id}`));
  return { ...next, worktree_operations: [...next.worktree_operations.filter(item => !keys.has(`${item.operation_id}\0${item.mission_id}`)), ...operations] };
}
function reconciliationOperations(state, operationId, reconciliation, status) { return reconciliation.results.flatMap(item => { const found = state.goals.flatMap(goal => goal.missions).find(mission => mission.worktree_allocation?.path === item.path); return found ? [{ operation_id: operationId, mission_id: found.mission_id, kind: 'RECONCILE', status, classification: mapClassification(item.classification), path: item.path, base_revision: found.worktree_allocation.base_revision, dirty: item.dirty, proof_ref: null, cause: null }] : []; }); }
function mapClassification(value) { if (value === 'ACTIVE_COHERENT') return value; if (value === 'TERMINAL_CLEAN') return value; if (value === 'TERMINAL_DIRTY') return value; if (value.startsWith('ORPHAN_REGISTERED')) return 'REGISTERED_ORPHAN'; if (value === 'DIRECTORY_NOT_REGISTERED') return 'UNREGISTERED_DIRECTORY'; if (value.includes('METADATA') || value.includes('MISSING')) return 'BROKEN_METADATA'; return 'NEEDS_ATTENTION'; }
function scopesOverlap(left, right) { const a = left.replace(/\/$/u, '').toLocaleLowerCase('en-US'); const b = right.replace(/\/$/u, '').toLocaleLowerCase('en-US'); return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function assertAction(command, action) { assertOrchestratorContract('transaction-v2', command); if (command.action !== action) throw new Error(`expected action ${action}`); }
function assertOrchestratorRole(environment) { if (environment.CTXROUTE_AGENT_ROLE === 'worker') throw new Error('workers cannot mutate global orchestrator state'); }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
