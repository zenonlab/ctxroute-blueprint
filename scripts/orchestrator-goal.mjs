import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { currentSwarmMode, findMission, loadOrchestratorConfig, readOrchestratorState, transactOrchestrator } from './orchestrator-core.mjs';
import { mutateCoordination, prepareMission, reconcileWorktrees, resumeWaitingMission, submitWorkerReport } from './orchestrator-service.mjs';
import { runMissionValidations } from './orchestrator-validation.mjs';
import { inspectMissionChanges } from './worktree-manager.mjs';
import { dispatchWorker } from './orchestrator-worker.mjs';

const execFile = promisify(execFileCallback);

export async function runGoal(request, root = process.cwd(), environment = process.env, dependencies = {}) {
  assertOrchestratorContract('goal-run-request', request);
  const mode = await currentSwarmMode(root, environment);
  if (mode.mode === 'SWARM_OFF') return { bypassed: true, mode: mode.mode, mode_source: mode.mode_source, request };
  const config = await loadOrchestratorConfig(root);
  const started = Date.now();
  const deadline = started + config.goalTimeoutMs;
  const dispatch = options => dispatchWorker(options, root, environment, dependencies);
  const planned = await dispatch({ dispatch_id: `${request.goal_id}-plan`, phase: 'plan', mission: request, skill_path: '.agents/skills/goal-planner/SKILL.md', output_contract: 'goal-plan', worktree: '.' });
  validateGoalPlan(planned.report, request);
  const baseRevision = await gitHead(root, dependencies);
  let state = (await transactOrchestrator({ operation_id: `${request.goal_id}-create`, expected_revision: request.expected_revision, action: 'goal.create', payload: { goal_id: request.goal_id, title: request.title, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision } }, root, dependencies)).state;
  for (const mission of planned.report.missions) {
    ensureDeadline(deadline);
    state = (await prepareMission({ operation_id: `${mission.mission_id}-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: request.goal_id, mission } }, root, environment, dependencies)).state;
  }

  try {
    await executeMissionGraph(request.goal_id, deadline, root, environment, dependencies, dispatch);
    state = await readOrchestratorState(root);
    const goal = state.goals.find(item => item.goal_id === request.goal_id);
    const evidenceRefs = [...new Set(goal.missions.flatMap(mission => mission.report?.files_touched ?? []))].sort();
    const audited = await dispatch({ dispatch_id: `${request.goal_id}-acceptance`, phase: 'goal-audit', mission: { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: evidenceRefs }, skill_path: '.agents/skills/goal-auditor/SKILL.md', output_contract: 'goal-acceptance-report', worktree: '.' });
    if (audited.report.decision === 'repair') {
      if (!audited.report.repair_missions.length) throw categorized('AUDIT_REPAIR_EMPTY', 'goal audit requested repair without missions');
      for (const mission of audited.report.repair_missions) {
        ensureDeadline(deadline);
        state = await readOrchestratorState(root);
        await prepareMission({ operation_id: `${mission.mission_id}-repair-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: request.goal_id, mission } }, root, environment, dependencies);
      }
      await executeMissionGraph(request.goal_id, deadline, root, environment, dependencies, dispatch);
      return runFinalAudit(request, baseRevision, deadline, root, environment, dependencies, dispatch);
    }
    return finalizeGoal(request.goal_id, audited.report, root, environment, dependencies);
  } catch (error) {
    return blockGoal(request.goal_id, error.causeCode ?? 'GOAL_RUN_FAILED', root, dependencies, error);
  }
}

async function executeMissionGraph(goalId, deadline, root, environment, dependencies, dispatch) {
  const config = await loadOrchestratorConfig(root);
  while (true) {
    ensureDeadline(deadline);
    let state = await readOrchestratorState(root);
    const goal = state.goals.find(item => item.goal_id === goalId);
    const unfinished = goal.missions.filter(item => !['COMPLETED', 'CANCELLED'].includes(item.status));
    if (!unfinished.length) return;
    const failedDependency = unfinished.find(mission => mission.dependencies?.some(id => ['BLOCKED', 'NEEDS_ATTENTION', 'CANCELLED'].includes(findMission(state, id)?.mission.status)));
    if (failedDependency) throw categorized('DEPENDENCY_BLOCKED', `mission dependency blocked: ${failedDependency.mission_id}`);
    const waiting = unfinished.find(item => item.status === 'WAITING_FOR_SKILL');
    if (waiting) { await runSkillSaga(goalId, waiting, deadline, root, environment, dependencies, dispatch); continue; }
    const completed = new Set(goal.missions.filter(item => item.status === 'COMPLETED').map(item => item.mission_id));
    const ready = unfinished.filter(item => item.status === 'ASSIGNED' && (item.dependencies ?? []).every(id => completed.has(id))).slice(0, config.parallelWorktrees);
    if (!ready.length) throw categorized('MISSION_GRAPH_STALLED', 'mission dependency graph has no runnable mission');
    const running = [];
    for (const mission of ready) {
      state = await readOrchestratorState(root);
      const transitioned = await transactOrchestrator({ operation_id: `${mission.mission_id}-run`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: mission.mission_id, status: 'RUNNING' } }, root, dependencies);
      running.push(transitioned.state.goals.flatMap(item => item.missions).find(item => item.mission_id === mission.mission_id));
    }
    const outputs = await Promise.all(running.map(mission => runWorkerWithSafeRetry(mission, root, environment, dependencies, dispatch)));
    for (const { mission, report } of outputs) {
      state = await readOrchestratorState(root);
      await submitWorkerReport({ operation_id: `${mission.mission_id}-report`, expected_revision: state.revision, action: 'report.submit', payload: { goal_id: goalId, report } }, root, environment, dependencies);
    }
  }
}

async function runWorkerWithSafeRetry(mission, root, environment, dependencies, dispatch) {
  const worktree = mission.worktree_allocation.path;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await dispatch({ dispatch_id: `${mission.mission_id}-work-${attempt}`, phase: 'work', mission: missionView(mission), skill_path: mission.skill_path ?? `.agents/skills/${mission.skill_id}/SKILL.md`, output_contract: 'worker-report', worktree });
      return { mission, report: result.report };
    } catch (error) {
      const inspection = await inspectMissionChanges(worktree, mission.file_scope, root, mission.worktree_allocation.base_revision, dependencies);
      if (inspection.files.length) {
        const state = await readOrchestratorState(root);
        const found = findMission(state, mission.mission_id);
        if (found?.mission.status === 'RUNNING') await transactOrchestrator({ operation_id: `${mission.mission_id}-dirty-block`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: found.goal.goal_id, mission_id: mission.mission_id, status: 'BLOCKED' } }, root, dependencies);
        throw categorized('WORKER_DIED_DIRTY', error.message);
      }
      if (attempt === 2) throw categorized(error.causeCode ?? 'WORKER_FAILED', error.message);
    }
  }
}

async function runSkillSaga(goalId, original, deadline, root, environment, dependencies, dispatch) {
  ensureDeadline(deadline);
  const skillId = original.requested_skill_id ?? original.skill_id;
  const creatorId = `${original.mission_id}-skill`;
  let state = await readOrchestratorState(root);
  let creator = findMission(state, creatorId)?.mission;
  if (!creator) {
    const request = { mission_id: creatorId, skill_id: 'skill-creator', requested_skill_id: null, skill_version: '1.0.0', skill_path: '.agents/skills/skill-creator/SKILL.md', objective: `Create the missing ${skillId} skill`, dependencies: [], acceptance_criteria: original.acceptance_criteria ?? [], file_scope: [`.agents/skills/${skillId}/`], acceptance: [`Create a valid ${skillId} skill`, 'Pass a separate blueprint audit'], validations: [{ id: 'skill-diff', executable: 'git', args: ['diff', '--check'], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' };
    const prepared = await prepareMission({ operation_id: `${creatorId}-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: goalId, mission: request } }, root, environment, dependencies);
    creator = findMission(prepared.state, creatorId).mission;
  }
  state = await readOrchestratorState(root);
  if (creator.status === 'ASSIGNED') {
    state = (await transactOrchestrator({ operation_id: `${creatorId}-run`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: creatorId, status: 'RUNNING' } }, root, dependencies)).state;
    creator = findMission(state, creatorId).mission;
  }
  let worker; let audit; let accepted = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    ensureDeadline(deadline);
    worker = await runWorkerWithSafeRetry(creator, root, environment, dependencies, dispatch);
    const receipt = await runMissionValidations(creator, resolve(root, creator.worktree_allocation.path), root, dependencies);
    if (receipt.status !== 'PASSED') throw categorized('SKILL_INVALID', 'created skill failed orchestrator validation');
    audit = await dispatch({ dispatch_id: `${creatorId}-audit-${attempt}`, phase: 'audit', mission: missionView(creator), skill_path: '.agents/skills/blueprint-audit/SKILL.md', output_contract: 'audit-report', worktree: creator.worktree_allocation.path });
    state = await readOrchestratorState(root);
    state = (await transactOrchestrator({ operation_id: `${creatorId}-audit-apply-${attempt}`, expected_revision: state.revision, action: 'audit.apply', payload: { report: audit.report } }, root, dependencies)).state;
    if (audit.report.decision === 'accept') { accepted = true; break; }
    if (audit.report.decision !== 'repair') throw categorized('SKILL_AUDIT_REJECTED', 'created skill was rejected');
  }
  if (!accepted) throw categorized('SKILL_REPAIR_EXHAUSTED', 'skill audit repair budget expired');
  const integrated = await submitWorkerReport({ operation_id: `${creatorId}-report`, expected_revision: state.revision, action: 'report.submit', payload: { goal_id: goalId, report: worker.report } }, root, environment, dependencies);
  creator = findMission(integrated.state, creatorId).mission;
  const skillPath = `.agents/skills/${skillId}`;
  const digest = createHash('sha256').update(await readFile(resolve(root, skillPath, 'SKILL.md'))).update(await readFile(resolve(root, skillPath, 'blueprint.json'))).digest('hex');
  state = await readOrchestratorState(root);
  state = (await mutateCoordination({ operation_id: `${creatorId}-register`, expected_revision: state.revision, action: 'skill.register', payload: { skill_id: skillId, version: '1.0.0', path: skillPath, artifact_digest: digest, validation_receipt: creator.validation_receipt, audit_id: audit.report.audit_id } }, root, environment, dependencies)).state;
  await resumeWaitingMission({ operation_id: `${original.mission_id}-resume`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: original.mission_id, status: 'PREPARING' } }, root, environment, dependencies);
}

async function runFinalAudit(request, baseRevision, deadline, root, environment, dependencies, dispatch) {
  ensureDeadline(deadline);
  const state = await readOrchestratorState(root);
  const goal = state.goals.find(item => item.goal_id === request.goal_id);
  const audited = await dispatch({ dispatch_id: `${request.goal_id}-acceptance-repair`, phase: 'goal-audit', mission: { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: [...new Set(goal.missions.flatMap(item => item.report?.files_touched ?? []))] }, skill_path: '.agents/skills/goal-auditor/SKILL.md', output_contract: 'goal-acceptance-report', worktree: '.' });
  return finalizeGoal(request.goal_id, audited.report, root, environment, dependencies);
}

async function finalizeGoal(goalId, report, root, environment, dependencies) {
  const state = await readOrchestratorState(root);
  const status = report.decision === 'accept' ? 'COMPLETED' : 'BLOCKED';
  const result = await transactOrchestrator({ operation_id: `${goalId}-${status.toLowerCase()}`, expected_revision: state.revision, action: 'goal.transition', payload: { goal_id: goalId, status, acceptance_report: report, blocked_cause: status === 'BLOCKED' ? 'GOAL_AUDIT_REJECTED' : null, resume_action: status === 'BLOCKED' ? 'rerun orchestrator_run_goal after correcting evidence' : null } }, root, dependencies);
  if (status !== 'COMPLETED') return { goal: result.state.goals.find(item => item.goal_id === goalId), state: result.state, report };
  const reconciled = await reconcileWorktrees({ operation_id: `${goalId}-cleanup`, expected_revision: result.state.revision, action: 'worktree.reconcile', payload: { repair: true } }, root, environment, dependencies);
  return { goal: reconciled.state.goals.find(item => item.goal_id === goalId), state: reconciled.state, report };
}

async function blockGoal(goalId, cause, root, dependencies, error) {
  const state = await readOrchestratorState(root);
  const goal = state.goals.find(item => item.goal_id === goalId);
  if (!goal || goal.status !== 'ACTIVE') throw error;
  const result = await transactOrchestrator({ operation_id: `${goalId}-blocked-${state.revision}`, expected_revision: state.revision, action: 'goal.transition', payload: { goal_id: goalId, status: 'BLOCKED', blocked_cause: normalizeCause(cause), resume_action: 'inspect recoverable missions and rerun orchestrator_run_goal with a new goal id' } }, root, dependencies);
  return { goal: result.state.goals.find(item => item.goal_id === goalId), state: result.state, error: error.message };
}

export function validateGoalPlan(plan, request) {
  assertOrchestratorContract('goal-plan', plan);
  if (plan.goal_id !== request.goal_id) throw categorized('PLAN_GOAL_MISMATCH', 'plan goal_id differs from request');
  const ids = new Set(plan.missions.map(item => item.mission_id));
  if (ids.size !== plan.missions.length) throw categorized('PLAN_DUPLICATE_MISSION', 'plan mission ids must be unique');
  for (const mission of plan.missions) if (mission.dependencies.some(id => !ids.has(id) || id === mission.mission_id)) throw categorized('PLAN_INVALID_DEPENDENCY', 'plan has an unknown or self dependency');
  assertAcyclic(plan.missions);
  for (let left = 0; left < plan.missions.length; left += 1) for (let right = left + 1; right < plan.missions.length; right += 1) if (plan.missions[left].file_scope.some(a => plan.missions[right].file_scope.some(b => scopesOverlap(a, b)))) throw categorized('PLAN_SCOPE_OVERLAP', 'plan missions have overlapping file scopes');
  const expectedCriteria = request.acceptance_criteria.map((_, index) => `criterion-${index + 1}`).sort();
  const actualCriteria = plan.criterion_coverage.map(item => item.criterion_id).sort();
  if (JSON.stringify(expectedCriteria) !== JSON.stringify(actualCriteria)) throw categorized('PLAN_COVERAGE_GAP', 'plan does not cover every acceptance criterion exactly once');
  for (const coverage of plan.criterion_coverage) if (coverage.mission_ids.some(id => !ids.has(id))) throw categorized('PLAN_COVERAGE_UNKNOWN_MISSION', 'criterion coverage names an unknown mission');
  return plan;
}

function missionView(mission) { return { goal_id: 'bounded-goal', goal_title: 'Bounded orchestrated goal', mission_id: mission.mission_id, skill_id: mission.skill_id, skill_version: mission.skill_version, skill_path: mission.skill_path ?? `.agents/skills/${mission.skill_id}/SKILL.md`, objective: mission.objective ?? mission.acceptance.join('; '), dependencies: mission.dependencies ?? [], acceptance_criteria: mission.acceptance_criteria ?? [], file_scope: mission.file_scope, acceptance: mission.acceptance, validations: mission.validations, response_format: 'worker-report', worktree: mission.worktree_allocation.path }; }
function assertAcyclic(missions) { const byId = new Map(missions.map(item => [item.mission_id, item])); const visiting = new Set(); const visited = new Set(); const visit = id => { if (visiting.has(id)) throw categorized('PLAN_DEPENDENCY_CYCLE', 'plan dependency graph contains a cycle'); if (visited.has(id)) return; visiting.add(id); for (const dependency of byId.get(id).dependencies) visit(dependency); visiting.delete(id); visited.add(id); }; for (const id of byId.keys()) visit(id); }
function scopesOverlap(left, right) { const a = left.replace(/\/$/u, '').toLocaleLowerCase('en-US'); const b = right.replace(/\/$/u, '').toLocaleLowerCase('en-US'); return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function ensureDeadline(deadline) { if (Date.now() >= deadline) throw categorized('GOAL_TIMEOUT', 'goal exceeded its global timeout'); }
async function gitHead(root, dependencies) { const runner = dependencies.execFile ?? execFile; return (await runner('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false })).stdout.trim(); }
function normalizeCause(value) { return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : 'GOAL_RUN_FAILED'; }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
