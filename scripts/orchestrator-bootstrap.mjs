import { createHash } from 'node:crypto';
import {
  blockOrchestratorTransaction, completeOrchestratorTransaction, ensureOrchestratorState,
  findMission, loadOrchestratorConfig, readOrchestratorState, updateMission, withGlobalMutationLock,
} from './orchestrator-core.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { runMissionValidations } from './orchestrator-validation.mjs';
import {
  inspectMissionChanges, prepareMissionWorktree, purgeMissionWorktree, reconcileManagedWorktrees,
  recoverMissionWorktree, recoverRollbackProof, rollbackMissionWorktree,
} from './worktree-manager.mjs';
import { resolve } from 'node:path';
import { lstat, readdir } from 'node:fs/promises';

const RECOVERY_ACTIONS = Object.freeze(['doctor', 'reconcile-worktrees', 'rollback-mission', 'purge-worktree']);
const ALLOWED_WHEN_BLOCKED = new Set(['worktree.reconcile', 'mission.rollback', 'worktree.purge']);

export async function bootstrapOrchestrator(root = process.cwd(), dependencies = {}) {
  return withGlobalMutationLock(root, dependencies, async locked => {
    const prepared = await ensureOrchestratorState(root, locked);
    let state = prepared.state;
    const initialRevision = state.revision;
    const recoveryCauses = [];
    for (const receipt of state.transactions.filter(item => item.status === 'PENDING')) {
      try { await resumePending(receipt, root, locked); }
      catch (error) {
        recoveryCauses.push(error.causeCode ?? 'PENDING_RECOVERY_FAILED');
        if (receipt.intent) {
          const command = commandFrom(receipt);
          await blockOrchestratorTransaction(command, error.causeCode ?? 'PENDING_RECOVERY_FAILED', root, locked).catch(() => {});
        }
      }
      state = await readOrchestratorState(root);
    }
    let reconciliation;
    try { reconciliation = await reconcileManagedWorktrees(root, { ...locked, repair: false }, state); }
    catch (error) {
      reconciliation = { results: [], changed: false };
      const hasAllocations = state.goals.some(goal => goal.missions.some(mission => mission.worktree_allocation?.path));
      const config = await loadOrchestratorConfig(root);
      const managedPath = resolve(root, config.worktreeRoot);
      const managedRoot = await lstat(managedPath).catch(failure => failure.code === 'ENOENT' ? null : Promise.reject(failure));
      const hasManagedEntries = managedRoot ? managedRoot.isSymbolicLink() || !managedRoot.isDirectory() || (await readdir(managedPath)).length > 0 : false;
      if (hasAllocations || hasManagedEntries) recoveryCauses.push(error.causeCode ?? 'WORKTREE_INVENTORY_FAILED');
    }
    const attention = reconciliation.results.filter(item => item.action === 'NEEDS_ATTENTION');
    const latestOperations = new Map();
    for (const item of state.worktree_operations) latestOperations.set(item.mission_id, item);
    const stateAttention = [...latestOperations.values()].filter(item => item.status !== 'COMPLETED' && item.classification === 'NEEDS_ATTENTION');
    const blockedRecovery = state.transactions.filter(item => item.status === 'BLOCKED' && item.cause?.startsWith('PENDING_'));
    const causes = [...new Set([
      ...recoveryCauses,
      ...attention.map(item => item.classification),
      ...stateAttention.map(item => item.cause ?? 'NEEDS_ATTENTION'),
      ...blockedRecovery.map(item => item.cause),
    ])].sort();
    const status = causes.length ? 'BLOCKED' : reconciliation.results.some(item => ['TERMINAL_CLEAN', 'REGISTERED_PATH_MISSING', 'ORPHAN_REGISTERED_MISSING'].includes(item.classification)) ? 'DEGRADED' : 'READY';
    const classifications = reconciliation.results;
    const inventory_digest = createHash('sha256').update(stableJson(classifications)).digest('hex');
    const report = { schemaVersion: 2, status, inventory_digest, classifications, causes, recovery_actions: status === 'BLOCKED' ? [...RECOVERY_ACTIONS] : [], changed: prepared.reset || prepared.initialized || prepared.cleaned || state.revision !== initialRevision };
    assertOrchestratorContract('bootstrap-report-v2', report);
    return report;
  });
}

export function assertBootstrapAllows(report, action) {
  if (report.status === 'BLOCKED' && !ALLOWED_WHEN_BLOCKED.has(action)) {
    const error = new Error(`orchestrator is blocked: ${report.causes.join(', ')}`);
    error.causeCode = 'ORCHESTRATOR_BLOCKED';
    throw error;
  }
}

async function resumePending(receipt, root, dependencies) {
  if (!receipt.intent) throw categorized('PENDING_INTENT_UNPROVABLE', 'pending transaction has no recoverable intent');
  const command = commandFrom(receipt);
  if (receipt.action === 'mission.prepare') return resumePreparation(command, root, dependencies);
  if (receipt.action === 'report.submit') return resumeReport(command, root, dependencies);
  if (receipt.action === 'worktree.reconcile') {
    const before = await readOrchestratorState(root);
    const reconciliation = await reconcileManagedWorktrees(root, { ...dependencies, repair: command.payload.repair });
    const plannedClean = new Set(before.worktree_operations.filter(item => item.operation_id === command.operation_id && item.status === 'PENDING' && item.classification === 'TERMINAL_CLEAN').map(item => item.path));
    reconciliation.results = reconciliation.results.map(item => plannedClean.has(item.path) && item.classification === 'METADATA_MISSING' ? { ...item, classification: 'TERMINAL_CLEAN', action: 'REMOVED' } : item);
    return completeOrchestratorTransaction(command, state => applyReconciliation(state, command.operation_id, reconciliation), 'RECONCILED', root, dependencies);
  }
  if (receipt.action === 'mission.rollback') return resumeRollback(command, root, dependencies);
  if (receipt.action === 'worktree.purge') return resumePurge(command, root, dependencies);
  return completeOrchestratorTransaction(command, null, operationResult(receipt.action), root, dependencies);
}

async function resumePreparation(command, root, dependencies) {
  const state = await readOrchestratorState(root);
  const request = command.payload.mission;
  const found = findMission(state, request.mission_id);
  if (!found) return completeOrchestratorTransaction(command, current => current, 'BYPASSED', root, dependencies);
  let allocation;
  try { allocation = await recoverMissionWorktree(request.mission_id, root, dependencies); }
  catch (error) {
    if (!/does not exist/u.test(error.message)) throw error;
    allocation = await prepareMissionWorktree(request.mission_id, root, dependencies);
  }
  return completeOrchestratorTransaction(command, current => {
    const updated = updateMission(current, command.payload.goal_id, request.mission_id, mission => ({ ...mission, status: 'ASSIGNED', worktree_allocation: { path: allocation.path, base_revision: allocation.base, status: 'ACTIVE', recovery_proof: null } }));
    return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'ACTIVE_COHERENT', base_revision: allocation.base, dirty: false } : item) };
  }, 'CREATED', root, dependencies);
}

async function resumeReport(command, root, dependencies) {
  const state = await readOrchestratorState(root);
  const report = command.payload.report;
  const found = findMission(state, report.mission_id);
  if (!found?.mission.worktree_allocation?.path) throw categorized('REPORT_RECOVERY_UNPROVABLE', 'pending report has no active worktree');
  const mission = found.mission;
  const inspection = await inspectMissionChanges(mission.worktree_allocation.path, mission.file_scope, root, mission.worktree_allocation.base_revision, dependencies);
  if (!inspection.ok || stableJson([...report.files_touched].sort()) !== stableJson(inspection.files)) throw categorized('REPORT_DIFF_MISMATCH', 'pending report no longer matches worktree');
  if (report.status === 'BLOCKED') return blockOrchestratorTransaction(command, 'WORKER_BLOCKED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'BLOCKED', report })));
  const receipt = await runMissionValidations(mission, resolve(root, mission.worktree_allocation.path), root, dependencies);
  if (receipt.status !== 'PASSED') return blockOrchestratorTransaction(command, receipt.status === 'TIMED_OUT' ? 'VALIDATION_TIMEOUT' : 'VALIDATION_FAILED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'BLOCKED', report, validation_receipt: receipt })));
  return completeOrchestratorTransaction(command, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'COMPLETED', report, validation_receipt: receipt })), 'UPDATED', root, dependencies);
}

async function resumeRollback(command, root, dependencies) {
  const state = await readOrchestratorState(root);
  const found = findMission(state, command.payload.mission_id);
  if (!found?.mission.worktree_allocation) throw categorized('ROLLBACK_RECOVERY_UNPROVABLE', 'pending rollback mission is missing');
  let rollback;
  try { rollback = await rollbackMissionWorktree(found.mission, root, dependencies); }
  catch (error) {
    if (!/does not exist/u.test(error.message)) throw error;
    rollback = await recoverRollbackProof(command.payload.mission_id, root);
  }
  return completeOrchestratorTransaction(command, current => {
    const updated = updateMission(current, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'ROLLED_BACK', recovery_proof: rollback.proof }, status: mission.status === 'COMPLETED' ? mission.status : 'CANCELLED' }));
    return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'ROLLED_BACK', proof_ref: rollback.proof } : item) };
  }, 'ROLLED_BACK', root, dependencies);
}

async function resumePurge(command, root, dependencies) {
  const state = await readOrchestratorState(root);
  const found = findMission(state, command.payload.mission_id);
  if (!found?.mission.worktree_allocation) throw categorized('PURGE_RECOVERY_UNPROVABLE', 'pending purge mission is missing');
  const physical = await lstat(resolve(root, found.mission.worktree_allocation.path)).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (physical) await purgeMissionWorktree({ ...command.payload, worktree: found.mission.worktree_allocation.path }, root, dependencies);
  return completeOrchestratorTransaction(command, current => {
    const updated = updateMission(current, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, worktree_allocation: { ...mission.worktree_allocation, status: 'REMOVED' }, status: ['COMPLETED', 'CANCELLED'].includes(mission.status) ? mission.status : 'CANCELLED' }));
    return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'PURGED' } : item) };
  }, 'PURGED', root, dependencies);
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

function mapClassification(value) { if (['ACTIVE_COHERENT', 'TERMINAL_CLEAN', 'TERMINAL_DIRTY'].includes(value)) return value; if (value.startsWith('ORPHAN_REGISTERED')) return 'REGISTERED_ORPHAN'; if (value === 'DIRECTORY_NOT_REGISTERED') return 'UNREGISTERED_DIRECTORY'; if (value.includes('METADATA') || value.includes('MISSING')) return 'BROKEN_METADATA'; return 'NEEDS_ATTENTION'; }
function commandFrom(receipt) { return { operation_id: receipt.operation_id, expected_revision: receipt.start_revision, action: receipt.action, payload: receipt.intent }; }
function operationResult(action) { if (action.endsWith('.create') || action === 'skill.register') return 'CREATED'; return 'UPDATED'; }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && value === Object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
