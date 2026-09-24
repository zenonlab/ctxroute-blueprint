import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  beginOrchestratorTransaction, blockOrchestratorTransaction, completeOrchestratorTransaction,
  currentSwarmMode, findMission, loadOrchestratorConfig, readOrchestratorState, transactOrchestrator, updateMission, withGlobalMutationLock,
} from './orchestrator-core.mjs';
import { assertBootstrapAllows, bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { runMissionValidations } from './orchestrator-validation.mjs';
import {
  commitMissionWorktree, inspectMissionChanges, integrateMissionCommit, prepareMissionWorktree, purgeMissionWorktree, reconcileManagedWorktrees,
  recoverMissionWorktree, rollbackMissionWorktree,
} from './worktree-manager.mjs';
import { queryCtxroute } from './ctxroute-query.mjs';
import { MODE_DESCRIPTORS, WORKFLOW_DESCRIPTORS, canonicalMode, explainExecutionPolicy, hasValidPolicyDigest, resolveExecutionPolicy } from './orchestration-policy-core.mjs';
import { writePolicySnapshot } from './orchestrator-policy-snapshot.mjs';
import { executionBindingForMission } from './orchestrator-execution-binding.mjs';
import { decide } from './agent-governance.mjs';
import { verifyWorkerRoots } from './orchestrator-worker-roots.mjs';

export async function readCoordination(root = process.cwd(), environment = process.env) {
  const state = await readOrchestratorState(root);
  if (environment.CTXROUTE_AGENT_ROLE !== 'worker') return state;
  const found = findMission(state, environment.CTXROUTE_MISSION_ID);
  if (!found?.mission.worktree_allocation?.path) throw new Error('worker role requires an assigned CTXROUTE_MISSION_ID');
  if (environment.CTXROUTE_WORKTREE) {
    const expected = resolve(root, found.mission.worktree_allocation.path);
    if (resolve(environment.CTXROUTE_WORKTREE) !== expected) throw new Error('worker worktree contradicts the assigned mission');
    await verifyWorkerRoots(root, expected);
  }
  const config = await loadOrchestratorConfig(root);
  const { binding, mission, requestedMode, resolvedMode } = executionBindingForMission(state, environment.CTXROUTE_MISSION_ID, config, environment.CTXROUTE_SESSION_ID);
  const portableBinding = { ...binding };
  delete portableBinding.session_id;
  const view = { ...portableBinding, file_scope: mission.file_scope, skill_id: mission.skill_id, skill_version: mission.skill_version, acceptance: mission.acceptance, validations: mission.validations, response_format: mission.response_format, worktree: mission.worktree_allocation.path, requested_mode: requestedMode, resolved_mode: resolvedMode, reinforcements: mission.reinforcements ?? [] };
  assertOrchestratorContract('mission-view', view);
  return view;
}

export async function mutateCoordination(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => mutateCoordination(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment);
  if (['operating-mode.set', 'mode.set'].includes(command.action) && !['mcp', 'cli'].includes(environment.CTXROUTE_CONTROL_CHANNEL)) throw new Error('persistent operating mode may change only through the MCP or CLI control adapter');
  if (command.action === 'skill.register') await assertSkillRegistration(command.payload, root);
  if (['mission.prepare', 'report.submit', 'worktree.reconcile', 'mission.rollback', 'worktree.purge'].includes(command.action)) throw new Error(`${command.action} must use its dedicated service operation`);
  let normalized = command;
  if (command.action === 'goal.create' && command.payload.repository_baseline === undefined) {
    normalized = { ...command, payload: { ...command.payload, repository_baseline: await repositorySnapshot(root, dependencies) } };
  }
  if (command.action === 'goal.transition' && command.payload.status === 'COMPLETED') {
    const state = await readOrchestratorState(root);
    const goal = state.goals.find(item => item.goal_id === command.payload.goal_id);
    await verifyOutcomeEffect(goal, command.payload.outcome_receipt, state, root, dependencies);
  }
  const result = await transactOrchestrator(normalized, root, dependencies);
  await persistPolicySnapshotForMutation(normalized, result.state, root, dependencies);
  return result;
}

async function persistPolicySnapshotForMutation(command, state, root, dependencies) {
  const config = await loadOrchestratorConfig(root);
  if (['operating-mode.set', 'mode.set'].includes(command.action)) {
    const policy = resolveExecutionPolicy({ requested_mode: canonicalMode(state.mode), workflow: 'STANDARD', capabilities: ['git'] });
    await writePolicySnapshot(policy, resolve(root, config.policySnapshotPath), dependencies);
  }
  if (['goal.create', 'goal.policy.rebase'].includes(command.action)) {
    const goal = state.goals.find(item => item.goal_id === command.payload.goal_id);
    if (goal?.resolved_policy) await writePolicySnapshot(goal.resolved_policy, resolve(root, config.policySnapshotRoot, `${goal.goal_id}.json`), dependencies);
  }
}

export async function repositorySnapshot(root = process.cwd(), dependencies = {}) {
  const exec = dependencies.execFile ?? promisify(execFileCallback);
  try {
    const top = String((await exec('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' })).stdout).trim();
    if (resolve(await realpath(top)) !== resolve(await realpath(root))) throw new Error('goal must bind to the primary repository checkout');
    const head = String((await exec('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })).stdout).trim();
    const status = String((await exec('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', ':(exclude).ctxroute/**'], { cwd: root, encoding: 'utf8' })).stdout);
    return { head, status_digest: createHash('sha256').update(status).digest('hex') };
  } catch (error) {
    if (/primary repository checkout/u.test(error.message)) throw error;
    return null;
  }
}

export async function verifyOutcomeEffect(goal, receipt, state, root = process.cwd(), dependencies = {}) {
  if (!goal || !receipt || receipt.goal_id !== goal.goal_id || receipt.policy_digest !== goal.policy_digest) throw new Error('outcome does not match the frozen goal policy');
  for (const reference of receipt.evidence_refs) await assertEvidenceReference(reference, root);
  const snapshot = await repositorySnapshot(root, dependencies);
  if (!snapshot) throw new Error('outcome verification requires the primary Git checkout');
  if (receipt.effect === 'read-only') {
    if (!goal.repository_baseline || receipt.repository_unchanged !== true || JSON.stringify(snapshot) !== JSON.stringify(goal.repository_baseline)) throw new Error('read-only outcome changed the repository snapshot');
    return snapshot;
  }
  if (receipt.effect === 'recovery') {
    if (!receipt.recovery_backup_refs?.length || receipt.final_repository_digest !== snapshot.status_digest) throw new Error('recovery outcome requires backup evidence and verified final Git state');
    for (const reference of receipt.recovery_backup_refs) await assertEvidenceReference(reference, root);
    return snapshot;
  }
  if (!receipt.integrated_commit) throw new Error('mutation outcome requires an integrated commit');
  const exec = dependencies.execFile ?? promisify(execFileCallback);
  await exec('git', ['cat-file', '-e', `${receipt.integrated_commit}^{commit}`], { cwd: root, encoding: 'utf8' });
  await exec('git', ['merge-base', '--is-ancestor', receipt.integrated_commit, snapshot.head], { cwd: root, encoding: 'utf8' });
  if (receipt.effect === 'experiment') {
    const promoted = state.decision_receipts.some(item => item.policy_digest === goal.policy_digest && item.selection === 'promote');
    if (!promoted || goal.stage !== 'integration') throw new Error('experiment outcome requires consumed promotion before integration');
  }
  return snapshot;
}

async function assertEvidenceReference(reference, root) {
  const absolute = resolve(root, reference);
  const fromRoot = relative(resolve(root), absolute);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('outcome evidence escapes the repository');
  const details = await lstat(absolute).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!details || !details.isFile() || details.isSymbolicLink()) throw new Error(`outcome evidence is missing or unsafe: ${reference}`);
}

export function listOperatingModes() {
  return { modes: Object.values(MODE_DESCRIPTORS), workflows: Object.values(WORKFLOW_DESCRIPTORS), default: { mode: 'SWARM', workflow: 'STANDARD' } };
}

export async function setOperatingMode(input, root = process.cwd(), environment = process.env, dependencies = {}) {
  assertOrchestratorRole(environment);
  const state = await readOrchestratorState(root);
  const mode = canonicalMode(input.mode);
  if (!mode) throw new Error(`unknown operating mode: ${input.mode}`);
  const command = { operation_id: input.operation_id, expected_revision: input.expected_revision ?? state.revision, action: 'operating-mode.set', payload: { mode } };
  return mutateCoordination(command, root, { ...environment, CTXROUTE_CONTROL_CHANNEL: environment.CTXROUTE_CONTROL_CHANNEL ?? 'mcp' }, dependencies);
}

export async function explainExecution(input = {}, root = process.cwd()) {
  const state = await readOrchestratorState(root).catch(error => error.causeCode === 'STATE_MISSING' ? null : Promise.reject(error));
  const goal = input.goal_id ? state?.goals.find(item => item.goal_id === input.goal_id) : null;
  return explainExecutionPolicy({ ...input, requested_mode: input.requested_mode ?? goal?.requested_mode ?? canonicalMode(state?.mode ?? 'SWARM'), workflow: input.workflow ?? goal?.workflow ?? 'STANDARD', capabilities: input.capabilities ?? ['git'] });
}

export async function pendingDecisions(root = process.cwd()) {
  const state = await readOrchestratorState(root);
  return (state.decision_requests ?? []).filter(item => item.status === 'PENDING').map(request => ({ request, checkpoint: [...(state.checkpoints ?? [])].reverse().find(item => item.goal_id === request.goal_id && item.policy_digest === request.policy_digest) ?? null }));
}

export async function resolveDecision(input, root = process.cwd(), environment = process.env, dependencies = {}) {
  const state = await readOrchestratorState(root);
  const receipt = { ...input.receipt, resolved_via: input.receipt.resolved_via ?? 'mcp', resolved_at: input.receipt.resolved_at ?? new Date().toISOString(), subject: input.receipt.subject ?? 'local-user-unverified' };
  return mutateCoordination({ operation_id: input.operation_id, expected_revision: input.expected_revision ?? state.revision, action: 'decision.resolve', payload: { receipt } }, root, environment, dependencies);
}

export async function promoteExperiment(input, root = process.cwd(), environment = process.env, dependencies = {}) {
  const state = await readOrchestratorState(root);
  return mutateCoordination({ operation_id: input.operation_id, expected_revision: input.expected_revision ?? state.revision, action: 'experiment.promote', payload: { goal_id: input.goal_id, decision_receipt_id: input.decision_receipt_id } }, root, environment, dependencies);
}

export async function prepareMission(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => prepareMission(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment);
  assertOrchestratorContract('transaction', command);
  if (command.action !== 'mission.prepare') throw new Error('prepare-mission requires action mission.prepare');
  const effective = await currentSwarmMode(root, environment);
  const request = routeMissingSkill(command.payload.mission, root);
  const current = await readOrchestratorState(root);
  const goal = current.goals.find(item => item.goal_id === command.payload.goal_id);
  assertGoalPolicyCanRunMission(goal, request);
  const decision = executionDecision(effective, request);
  const normalized = { ...command, payload: { ...command.payload, mission: request } };
  if (!decision.coordinated) {
    const begun = await beginOrchestratorTransaction(normalized, root, dependencies);
    if (begun.replayed && !begun.pending) return { ...begun, bypassed: true, mode: effective.mode, mode_source: effective.mode_source, reason: decision.reason };
    const completed = await completeOrchestratorTransaction(normalized, state => state, 'BYPASSED', root, dependencies);
    return { ...completed, bypassed: true, mode: effective.mode, mode_source: effective.mode_source, reason: decision.reason };
  }
  const record = missionRecord(request, decision.reason, goal);
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
  assertOrchestratorContract('transaction', command);
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
    if (mission.access === 'read-only' && inspection.files.length) throw categorized('READ_ONLY_POLICY_VIOLATION', 'read-only mission changed repository files');
    const reported = [...report.files_touched].sort();
    if (JSON.stringify(reported) !== JSON.stringify(inspection.files)) throw categorized('REPORT_DIFF_MISMATCH', 'worker report files_touched does not match the worktree diff');
    if (report.status === 'BLOCKED') return blockOrchestratorTransaction(command, 'WORKER_BLOCKED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...blockedAttempt(item, 'WORKER_BLOCKED'), report })));
    const worktree = resolve(root, mission.worktree_allocation.path);
    const receipt = await runMissionValidations(mission, worktree, root, dependencies);
    if (receipt.status !== 'PASSED') return blockOrchestratorTransaction(command, receipt.status === 'TIMED_OUT' ? 'VALIDATION_TIMEOUT' : 'VALIDATION_FAILED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...blockedAttempt(item, receipt.status === 'TIMED_OUT' ? 'VALIDATION_TIMEOUT' : 'VALIDATION_FAILED'), report, validation_receipt: receipt })));
    return completeOrchestratorTransaction(command, current => updateMission(current, command.payload.goal_id, report.mission_id, item => ({ ...item, status: 'COMPLETED', report, validation_receipt: receipt })), 'UPDATED', root, dependencies);
  } catch (error) {
    await blockOrchestratorTransaction(command, error.causeCode ?? 'REPORT_REJECTED', root, dependencies, current => updateMission(current, command.payload.goal_id, report.mission_id, item => blockedAttempt(item, error.causeCode ?? 'REPORT_REJECTED'))).catch(() => {});
    throw error;
  }
}

export async function commitMission(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => commitMission(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'mission.commit');
  const begun = await beginOrchestratorTransaction(command, root, dependencies, state => {
    const found = findMission(state, command.payload.mission_id);
    if (!found || found.goal.goal_id !== command.payload.goal_id || found.mission.orchestrator_commit) throw new Error('mission is not eligible for orchestrator commit');
    const operation = { operation_id: command.operation_id, mission_id: found.mission.mission_id, kind: 'COMMIT', status: 'PENDING', classification: 'NEEDS_ATTENTION', path: found.mission.worktree_allocation?.path, base_revision: found.mission.worktree_allocation?.base_revision ?? null, dirty: true, proof_ref: null, cause: null };
    return { ...state, worktree_operations: [...state.worktree_operations, operation] };
  });
  if (begun.replayed && !begun.pending) return begun;
  const found = findMission(begun.state, command.payload.mission_id);
  try {
    const committed = await commitMissionWorktree(found.mission, command.payload.message, root, dependencies);
    return completeOrchestratorTransaction(command, state => {
      const updated = updateMission(state, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, orchestrator_commit: committed.commit }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'COMMITTED', dirty: false } : item) };
    }, 'UPDATED', root, dependencies);
  } catch (error) {
    await blockOrchestratorTransaction(command, error.causeCode ?? 'ORCHESTRATOR_COMMIT_FAILED', root, dependencies);
    throw error;
  }
}

export async function integrateMission(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => integrateMission(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'mission.integrate');
  const begun = await beginOrchestratorTransaction(command, root, dependencies, state => {
    const found = findMission(state, command.payload.mission_id);
    if (!found || found.goal.goal_id !== command.payload.goal_id || found.mission.orchestrator_commit !== command.payload.commit_oid || found.mission.integrated_commit) throw new Error('mission is not eligible for integration');
    if (found.goal.stage !== 'integration') throw new Error('goal has not reached its integration stage');
    if (found.goal.workflow === 'EXPERIMENT' && !state.decision_receipts.some(item => item.policy_digest === found.goal.policy_digest && item.selection === 'promote')) throw new Error('experiment cannot integrate before explicit promotion');
    const operation = { operation_id: command.operation_id, mission_id: found.mission.mission_id, kind: 'INTEGRATE', status: 'PENDING', classification: 'NEEDS_ATTENTION', path: found.mission.worktree_allocation.path, base_revision: found.mission.worktree_allocation.base_revision, dirty: false, proof_ref: null, cause: null };
    return { ...state, worktree_operations: [...state.worktree_operations, operation] };
  });
  if (begun.replayed && !begun.pending) return begun;
  try {
    const integration = await integrateMissionCommit(command.payload.commit_oid, root, dependencies);
    return completeOrchestratorTransaction(command, state => {
      const updated = updateMission(state, command.payload.goal_id, command.payload.mission_id, mission => ({ ...mission, integrated_commit: integration.integrated_commit }));
      return { ...updated, worktree_operations: updated.worktree_operations.map(item => item.operation_id === command.operation_id ? { ...item, status: 'COMPLETED', classification: 'INTEGRATED', base_revision: integration.integrated_commit } : item) };
    }, 'UPDATED', root, dependencies);
  } catch (error) {
    await blockOrchestratorTransaction(command, error.causeCode ?? 'INTEGRATION_FAILED', root, dependencies);
    throw error;
  }
}

export async function reconcileWorktrees(command, root = process.cwd(), environment = process.env, dependencies = {}) {
  if (dependencies.globalMutationRoot !== resolve(root)) return withGlobalMutationLock(root, dependencies, locked => reconcileWorktrees(command, root, environment, locked));
  const health = await bootstrapOrchestrator(root, dependencies); assertBootstrapAllows(health, command.action);
  assertOrchestratorRole(environment); assertAction(command, 'worktree.reconcile');
  if (!decide('repository.repair', { authority: 'orchestrator' }).allowed) throw new Error('repository repair requires orchestrator authority');
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
    const decision = state.decision_receipts.find(item => item.receipt_id === command.payload.decision_receipt_id && item.policy_digest === entry.goal.policy_digest && item.selection === 'purge');
    if (!decision) throw new Error('purge requires an explicit matching DecisionReceipt');
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

function missionRecord(request, reason, goal) {
  const stage = goal.resolved_policy.stages[goal.stage_index];
  const record = { ...request, response_format: 'worker-report', execution_reason: reason, stage: stage.stage, strategy: stage.strategy, access: stage.access, policy_digest: goal.policy_digest, reinforcements: goal.reinforcements ?? [], status: 'PREPARING', worktree_allocation: null, orchestrator_commit: null, integrated_commit: null, report: null, validation_receipt: null };
  assertOrchestratorContract('mission-record', record);
  return record;
}
function blockedAttempt(mission, cause) {
  if (!mission.attempt) return { ...mission, status: 'BLOCKED' };
  return { ...mission, status: 'BLOCKED', attempt: { ...mission.attempt, status: 'BLOCKED', finished_at: mission.attempt.finished_at ?? new Date().toISOString(), cause } };
}
function assertGoalPolicyCanRunMission(goal, request) {
  if (!goal || goal.status !== 'ACTIVE') throw new Error('mission requires an active goal');
  if (!goal.resolved_policy || goal.policy_digest !== goal.resolved_policy.policy_digest || !hasValidPolicyDigest(goal.resolved_policy)) throw new Error('goal frozen policy digest is invalid');
  const stage = goal.resolved_policy.stages[goal.stage_index];
  if (!stage || stage.stage !== goal.stage || stage.strategy !== goal.strategy) throw new Error('goal stage does not match its frozen policy');
  if (!['single-worker', 'parallel-workers', 'independent-auditor'].includes(stage.strategy)) throw new Error(`stage strategy ${stage.strategy} does not authorize a worker mission`);
  if (stage.access === 'read-only' && request.execution === 'direct') throw new Error('read-only durable missions cannot bypass policy context');
}
function addPreparingMission(state, goalId, record, worktreeOperation) {
  const goalIndex = state.goals.findIndex(goal => goal.goal_id === goalId);
  if (goalIndex < 0 || state.goals[goalIndex].status !== 'ACTIVE') throw new Error(`unknown or terminal goal: ${goalId}`);
  if (findMission(state, record.mission_id)) throw new Error(`mission already exists: ${record.mission_id}`);
  const active = state.goals.flatMap(goal => goal.missions).filter(mission => !['COMPLETED', 'CANCELLED'].includes(mission.status));
  if (active.some(mission => mission.file_scope.some(left => record.file_scope.some(right => scopesOverlap(left, right))))) throw new Error('mission file_scope overlaps an active worker');
  const goals = [...state.goals]; goals[goalIndex] = { ...goals[goalIndex], missions: [...goals[goalIndex].missions, record] }; return { ...state, goals, worktree_operations: [...state.worktree_operations, worktreeOperation] };
}
function executionDecision(effective, request) {
  if (['SWARM_OFF', 'DIRECT', 'GUARDED'].includes(effective.mode)) return { coordinated: false, reason: effective.mode_source === 'environment' ? 'ENVIRONMENT_SWARM_OFF' : effective.mode_source === 'state' ? 'PERSISTED_MODE' : 'DEFAULT_MODE' };
  if (request.execution === 'direct') return { coordinated: false, reason: 'EXPLICIT_DIRECT' };
  if (request.execution === 'coordinated') return { coordinated: true, reason: 'EXPLICIT_COORDINATED' };
  return request.file_scope.length === 1 ? { coordinated: false, reason: 'AUTO_SINGLE_SCOPE' } : { coordinated: true, reason: 'AUTO_COORDINATED' };
}
function routeMissingSkill(mission, root) {
  assertOrchestratorContract('mission-request', mission);
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
function assertAction(command, action) { assertOrchestratorContract('transaction', command); if (command.action !== action) throw new Error(`expected action ${action}`); }
function assertOrchestratorRole(environment) { if (environment.CTXROUTE_AGENT_ROLE === 'worker') throw new Error('workers cannot mutate global orchestrator state'); }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
