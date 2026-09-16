import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { currentSwarmMode, findMission, loadOrchestratorConfig, readOrchestratorState, transactOrchestrator } from './orchestrator-core.mjs';
import { mutateCoordination, prepareMission, reconcileWorktrees, resumeWaitingMission, submitWorkerReport } from './orchestrator-service.mjs';
import { runMissionValidations } from './orchestrator-validation.mjs';
import { inspectMissionChanges } from './worktree-manager.mjs';
import { dispatchWorker } from './orchestrator-worker.mjs';
import { documentationFreshness, documentationGate, inventoryDocumentationRequirements } from './orchestrator-documentation.mjs';
import { modelCatalog } from './orchestrator-models.mjs';
import { assessTask, nextLevel, resolveConsumptionPolicy, routeTask } from './orchestrator-routing-core.mjs';
import { partitionAuditTargets } from './orchestrator-audit-sharding.mjs';

const execFile = promisify(execFileCallback);

export async function runGoal(request, root = process.cwd(), environment = process.env, dependencies = {}) {
  assertOrchestratorContract('goal-run-request', request);
  const mode = await currentSwarmMode(root, environment);
  if (mode.mode === 'SWARM_OFF') return { bypassed: true, mode: mode.mode, mode_source: mode.mode_source, request };
  const config = await loadOrchestratorConfig(root);
  const started = Date.now();
  const deadline = started + config.goalTimeoutMs;
  const dispatch = options => dispatchWorker(options, root, environment, dependencies);
  if (config.modelRouting?.mode !== 'adaptive') return runLegacyGoal(request, root, environment, dependencies, config, deadline, dispatch);
  const allowedProviders = environment.CTXROUTE_WORKER_RUNTIME === 'fixture' ? ['fixture'] : undefined;
  const consumption = resolveConsumptionPolicy(request.consumption, { preset: config.modelRouting.defaultPreset, allowed_providers: allowedProviders });
  const assessment = assessTask(request, assessmentFacts(request));
  const catalog = await modelCatalog(root, environment);
  const requirements = await inventoryDocumentationRequirements(request, root);
  const routes = [];
  const initialReceipts = [];
  const initialDispatch = options => dispatchAndCollect(options, dispatch, initialReceipts, consumption);
  let researchRoute = null;
  if (requirements.length) {
    researchRoute = routeTask({ decision_id: `${request.goal_id}-research-route`, phase: 'research', assessment, catalog, consumption, profile: config.modelRouting.profiles.research, remaining_units: remainingFromReceipts(consumption, initialReceipts) });
    routes.push(researchRoute);
  }
  const evidence = await documentationGate({ request, root, consumption, dispatch: researchRoute?.selected ? options => initialDispatch({ ...options, routing: researchRoute }) : null });
  const freshness = documentationFreshness(evidence);
  const baseRevision = await gitHead(root, dependencies);
  if (evidence.status === 'BLOCKED') {
    const cause = researchRoute && !researchRoute.selected && routeBlockedCause(researchRoute) === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : null;
    return createBlockedAdaptiveGoal(request, assessment, consumption, evidence, freshness, routes, initialReceipts, baseRevision, root, dependencies, 'BLOCKED', cause);
  }
  const planningRoute = routeTask({ decision_id: `${request.goal_id}-planning-route`, phase: 'planning', assessment, catalog, consumption, profile: config.modelRouting.profiles.planning, remaining_units: remainingFromReceipts(consumption, initialReceipts) });
  routes.push(planningRoute);
  if (!planningRoute.selected) return createBlockedAdaptiveGoal(request, assessment, consumption, evidence, freshness, routes, initialReceipts, baseRevision, root, dependencies, 'WAITING_FOR_CAPABILITY');
  const planned = await initialDispatch({ dispatch_id: `${request.goal_id}-plan`, phase: 'plan', mission: { ...request, assessment, documentation_evidence: evidence, consumption }, skill_path: '.agents/skills/goal-planner/SKILL.md', output_contract: 'goal-plan', worktree: '.', routing: planningRoute });
  const plan = { ...planned.report, assessment, documentation_requirements: evidence.requirements, importance: request.importance ?? 'normal', change_kind: request.change_kind ?? 'feature' };
  const missions = plan.missions.map(mission => {
    const route = routeTask({ decision_id: `${mission.mission_id}-work-route`, phase: mission.phase_profile ?? 'work', assessment, catalog, consumption, profile: config.modelRouting.profiles[mission.phase_profile ?? 'work'], planner_minimum: mission.minimum_level ?? null });
    routes.push(route);
    if (!route.selected) throw categorized('CAPABILITY_UNAVAILABLE', `no qualified model for ${mission.mission_id}`);
    return { ...mission, assessment, phase_profile: mission.phase_profile ?? 'work', documentation_evidence: evidence, documentation_freshness: freshness, consumption_policy: consumption, routing_decision: route, escalation_criteria: ['invalid-output', 'validation-failed', 'scope-expanded', 'provider-unavailable', 'confidence-low'] };
  });
  validateGoalPlan({ ...plan, missions }, request);
  let state = (await transactOrchestrator({ operation_id: `${request.goal_id}-create`, expected_revision: request.expected_revision, action: 'goal.create', payload: { goal_id: request.goal_id, title: request.title, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, importance: request.importance ?? 'normal', change_kind: request.change_kind ?? 'feature', assessment, consumption_policy: consumption, documentation_evidence: evidence, documentation_freshness: freshness, routing_decisions: routes, execution_receipts: initialReceipts } }, root, dependencies)).state;
  for (const mission of missions) {
    ensureDeadline(deadline);
    state = (await prepareMission({ operation_id: `${mission.mission_id}-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: request.goal_id, mission } }, root, environment, dependencies)).state;
  }

  try {
    await executeMissionGraph(request.goal_id, deadline, root, environment, dependencies, dispatch);
    state = await readOrchestratorState(root);
    const goal = state.goals.find(item => item.goal_id === request.goal_id);
    const evidenceRefs = [...new Set(goal.missions.flatMap(mission => mission.report?.files_touched ?? []))].sort();
    const auditRoute = routeTask({ decision_id: `${request.goal_id}-audit-route`, phase: 'goalAudit', assessment, catalog, consumption, profile: config.modelRouting.profiles.goalAudit, prior_provider_family: goal.missions[0]?.routing_decision?.selected?.provider_family ?? null, remaining_units: remainingUnits(goal) });
    if (!auditRoute.selected) throw categorized('INDEPENDENT_AUDITOR_UNAVAILABLE', 'no qualified independent goal auditor');
    const audited = await runAdaptiveGoalAudit({ request, goal, baseRevision, evidenceRefs, evidence, assessment, catalog, consumption, config, auditRoute, root, dependencies, dispatch });
    assertGoalAuditDocumentation(audited.report, evidence);
    if (audited.report.decision === 'repair') {
      if (!audited.report.repair_missions.length) throw categorized('AUDIT_REPAIR_EMPTY', 'goal audit requested repair without missions');
      for (const mission of audited.report.repair_missions) {
        ensureDeadline(deadline);
        state = await readOrchestratorState(root);
        const currentGoal = state.goals.find(item => item.goal_id === request.goal_id);
        const repairRoute = routeTask({ decision_id: `${mission.mission_id}-repair-route`, phase: 'repair', assessment, catalog, consumption, profile: config.modelRouting.profiles.repair, remaining_units: remainingUnits(currentGoal) });
        if (!repairRoute.selected) throw categorized('CAPABILITY_UNAVAILABLE', `no qualified repair model for ${mission.mission_id}`);
        const routedMission = { ...mission, assessment, phase_profile: 'repair', documentation_evidence: evidence, documentation_freshness: freshness, consumption_policy: consumption, routing_decision: repairRoute, escalation_criteria: ['invalid-output', 'validation-failed', 'scope-expanded', 'provider-unavailable', 'confidence-low'] };
        await prepareMission({ operation_id: `${mission.mission_id}-repair-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: request.goal_id, mission: routedMission } }, root, environment, dependencies);
      }
      await executeMissionGraph(request.goal_id, deadline, root, environment, dependencies, dispatch);
      return runFinalAudit(request, baseRevision, deadline, root, environment, dependencies, dispatch);
    }
    return finalizeGoal(request.goal_id, audited.report, root, environment, dependencies);
  } catch (error) {
    return blockGoal(request.goal_id, error.causeCode ?? 'GOAL_RUN_FAILED', root, dependencies, error);
  }
}

async function runLegacyGoal(request, root, environment, dependencies, config, deadline, dispatch) {
  const planned = await dispatch({ dispatch_id: `${request.goal_id}-plan`, phase: 'plan', mission: request, skill_path: '.agents/skills/goal-planner/SKILL.md', output_contract: 'goal-plan', worktree: '.' });
  validateGoalPlan(planned.report, request);
  const baseRevision = await gitHead(root, dependencies);
  let state = (await transactOrchestrator({ operation_id: `${request.goal_id}-create`, expected_revision: request.expected_revision, action: 'goal.create', payload: { goal_id: request.goal_id, title: request.title, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision } }, root, dependencies)).state;
  for (const mission of planned.report.missions) state = (await prepareMission({ operation_id: `${mission.mission_id}-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: request.goal_id, mission } }, root, environment, dependencies)).state;
  try {
    await executeMissionGraph(request.goal_id, deadline, root, environment, dependencies, dispatch);
    state = await readOrchestratorState(root);
    const goal = state.goals.find(item => item.goal_id === request.goal_id);
    const audited = await dispatch({ dispatch_id: `${request.goal_id}-acceptance`, phase: 'goal-audit', mission: { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: [...new Set(goal.missions.flatMap(item => item.report?.files_touched ?? []))].sort() }, skill_path: '.agents/skills/goal-auditor/SKILL.md', output_contract: 'goal-acceptance-report', worktree: '.' });
    return finalizeGoal(request.goal_id, audited.report, root, environment, dependencies);
  } catch (error) { return blockGoal(request.goal_id, error.causeCode ?? 'GOAL_RUN_FAILED', root, dependencies, error); }
}

async function createBlockedAdaptiveGoal(request, assessment, consumption, evidence, freshness, routes, receipts, baseRevision, root, dependencies, stateStatus = 'BLOCKED', suppliedCause = null) {
  let state = (await transactOrchestrator({ operation_id: `${request.goal_id}-create`, expected_revision: request.expected_revision, action: 'goal.create', payload: { goal_id: request.goal_id, title: request.title, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, importance: request.importance ?? 'normal', change_kind: request.change_kind ?? 'feature', assessment, consumption_policy: consumption, documentation_evidence: evidence, documentation_freshness: freshness, routing_decisions: routes, execution_receipts: receipts } }, root, dependencies)).state;
  const cause = suppliedCause ?? (evidence.status === 'BLOCKED' ? evidence.blocked_cause : routeBlockedCause(routes.at(-1)));
  const transitioned = await transactOrchestrator({ operation_id: `${request.goal_id}-blocked`, expected_revision: state.revision, action: 'goal.transition', payload: { goal_id: request.goal_id, status: stateStatus === 'WAITING_FOR_CAPABILITY' ? 'WAITING_FOR_CAPABILITY' : 'BLOCKED', blocked_cause: cause, resume_action: 'refresh documentation or provider capabilities, then resume with a new bounded goal' } }, root, dependencies);
  return { goal: transitioned.state.goals.find(goal => goal.goal_id === request.goal_id), state: transitioned.state, error: cause };
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
    const candidates = unfinished.filter(item => item.status === 'ASSIGNED' && (item.dependencies ?? []).every(id => completed.has(id)));
    const ready = affordableMissions(candidates, goal, config).slice(0, config.parallelWorktrees);
    if (candidates.length && !ready.length) throw categorized('BUDGET_EXHAUSTED', 'remaining normalized units cannot fund another bounded mission attempt');
    if (!ready.length) throw categorized('MISSION_GRAPH_STALLED', 'mission dependency graph has no runnable mission');
    const running = [];
    for (let mission of ready) {
      if (mission.documentation_evidence?.requirements.some(requirement => requirement.freshness === 'per-dispatch')) {
        const researchRoute = goal.routing_decisions?.find(decision => decision.phase === 'research');
        if (!researchRoute?.selected) throw categorized('FRESH_DOCUMENTATION_UNAVAILABLE', 'per-dispatch research has no qualified route');
        const refreshRequest = { goal_id: goal.goal_id, title: goal.title, objective: goal.objective, acceptance_criteria: goal.acceptance_criteria, suggested_paths: mission.file_scope, expected_revision: state.revision, importance: goal.importance, change_kind: goal.change_kind, consumption: goal.consumption_policy };
        const refreshed = await documentationGate({ request: refreshRequest, root, consumption: goal.consumption_policy, dispatch: options => dispatchAndRecord({ ...options, routing: researchRoute }, goalId, null, root, dependencies, dispatch) });
        if (refreshed.status !== 'SATISFIED') throw categorized('FRESH_DOCUMENTATION_UNAVAILABLE', 'per-dispatch evidence refresh failed');
        const freshness = documentationFreshness(refreshed, { dispatch_id: `${mission.mission_id}-work` });
        const refreshedState = await readOrchestratorState(root);
        const updated = await transactOrchestrator({ operation_id: `${mission.mission_id}-documentation-refresh-${refreshedState.revision}`, expected_revision: refreshedState.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: mission.mission_id, status: 'ASSIGNED', documentation_evidence: refreshed, documentation_freshness: freshness } }, root, dependencies);
        mission = findMission(updated.state, mission.mission_id).mission;
      }
      state = await readOrchestratorState(root);
      const transitioned = await transactOrchestrator({ operation_id: `${mission.mission_id}-run`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: mission.mission_id, status: 'RUNNING' } }, root, dependencies);
      const transitionedGoal = transitioned.state.goals.find(item => item.goal_id === goalId);
      running.push({ mission: transitionedGoal.missions.find(item => item.mission_id === mission.mission_id), goal: transitionedGoal });
    }
    const outputs = await Promise.all(running.map(item => runWorkerWithSafeRetry(item.mission, item.goal, root, environment, dependencies, dispatch)));
    for (const { mission, report } of outputs) {
      state = await readOrchestratorState(root);
      await submitWorkerReport({ operation_id: `${mission.mission_id}-report`, expected_revision: state.revision, action: 'report.submit', payload: { goal_id: goalId, report } }, root, environment, dependencies);
    }
  }
}

async function runWorkerWithSafeRetry(mission, goal, root, environment, dependencies, dispatch, cycle = null) {
  const worktree = mission.worktree_allocation.path;
  const config = await loadOrchestratorConfig(root);
  const routingPhase = mission.phase_profile ?? 'work';
  const maximumAttempts = mission.routing_decision ? config.modelRouting.profiles[routingPhase].attempts : 2;
  const catalog = mission.routing_decision ? await modelCatalog(root, environment) : [];
  let current = mission;
  let deniedModels = [...(mission.consumption_policy?.denied_models ?? [])];
  let unitsRemaining = mission.consumption_policy ? remainingUnits(goal) : null;
  let costRemaining = remainingCost(mission.consumption_policy, goal.execution_receipts ?? []);
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const attemptUnits = current.routing_decision?.selected?.normalized_units ?? 0;
      if (unitsRemaining !== null && unitsRemaining < attemptUnits) throw categorized('BUDGET_EXHAUSTED', 'normalized unit budget cannot fund the selected attempt');
      const dispatchId = `${current.mission_id}-work-${cycle === null ? '' : `${cycle}-`}${attempt}`;
      const dispatchMission = withRemainingCost(missionView(current, goal), current.routing_decision, costRemaining);
      const result = await dispatch({ dispatch_id: dispatchId, phase: 'work', mission: dispatchMission, skill_path: current.skill_path ?? `.agents/skills/${current.skill_id}/SKILL.md`, output_contract: 'worker-report', worktree, routing: current.routing_decision ?? null });
      if (result.receipt) {
        await recordReceipt(goal.goal_id, current.mission_id, result.receipt, root, dependencies);
        if (unitsRemaining !== null) unitsRemaining -= result.receipt.normalized_units;
        costRemaining = consumeKnownCost(costRemaining, result.receipt);
      }
      return { mission: current, report: result.report };
    } catch (error) {
      if (error.executionReceipt) {
        await recordReceipt(goal.goal_id, current.mission_id, error.executionReceipt, root, dependencies);
        if (unitsRemaining !== null) unitsRemaining -= error.executionReceipt.normalized_units;
        costRemaining = consumeKnownCost(costRemaining, error.executionReceipt);
      }
      const inspection = await inspectMissionChanges(worktree, current.file_scope, root, current.worktree_allocation.base_revision, dependencies);
      if (inspection.files.length) {
        const state = await readOrchestratorState(root);
        const found = findMission(state, current.mission_id);
        if (found?.mission.status === 'RUNNING') await transactOrchestrator({ operation_id: `${current.mission_id}-dirty-block`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: found.goal.goal_id, mission_id: current.mission_id, status: 'BLOCKED' } }, root, dependencies);
        throw categorized('WORKER_DIED_DIRTY', error.message);
      }
      if (!current.routing_decision || attempt === maximumAttempts || error.causeCode === 'BUDGET_EXHAUSTED') throw categorized(error.causeCode ?? 'WORKER_FAILED', error.message);
      const providerFailure = ['PROVIDER_AUTH', 'PROVIDER_QUOTA', 'PROVIDER_TIMEOUT', 'PROVIDER_MODEL_UNKNOWN', 'WORKER_CRASH'].includes(error.causeCode);
      deniedModels = [...new Set([...deniedModels, current.routing_decision.selected.model_id])];
      const fromLevel = current.routing_decision.level;
      const minimum = providerFailure ? fromLevel : nextLevel(fromLevel);
      const reroute = routeTask({ decision_id: `${current.mission_id}-reroute-${attempt}`, phase: routingPhase, assessment: current.assessment, catalog, consumption: { ...current.consumption_policy, denied_models: deniedModels }, profile: config.modelRouting.profiles[routingPhase], planner_minimum: minimum, remaining_units: unitsRemaining });
      if (!reroute.selected) throw categorized(unitsRemaining <= 0 ? 'BUDGET_EXHAUSTED' : 'CAPABILITY_UNAVAILABLE', 'no fallback or escalation candidate is available');
      const escalation = reroute.level === fromLevel ? null : { event_id: `${current.mission_id}-escalation-${attempt}`, mission_id: current.mission_id, from_level: fromLevel, to_level: reroute.level, cause: normalizeCause(error.causeCode ?? 'WORKER_FAILED'), attempt, timestamp: new Date().toISOString() };
      const state = await readOrchestratorState(root);
      const payload = { goal_id: goal.goal_id, mission_id: current.mission_id, status: 'RUNNING', routing_decision: reroute };
      if (escalation) payload.escalation_event = escalation;
      const updated = await transactOrchestrator({ operation_id: `${current.mission_id}-reroute-${attempt}`, expected_revision: state.revision, action: 'mission.transition', payload }, root, dependencies);
      current = findMission(updated.state, current.mission_id).mission;
    }
  }
}

async function runSkillSaga(goalId, original, deadline, root, environment, dependencies, dispatch) {
  ensureDeadline(deadline);
  const skillId = original.requested_skill_id ?? original.skill_id;
  const creatorId = `${original.mission_id}-skill`;
  let state = await readOrchestratorState(root);
  const goal = state.goals.find(item => item.goal_id === goalId);
  const config = await loadOrchestratorConfig(root);
  const catalog = original.assessment ? await modelCatalog(root, environment) : [];
  const creatorRoute = original.assessment ? routeTask({ decision_id: `${creatorId}-creation-route`, phase: 'skillCreation', assessment: original.assessment, catalog, consumption: original.consumption_policy, profile: config.modelRouting.profiles.skillCreation, remaining_units: remainingUnits(goal) }) : null;
  if (original.assessment && !creatorRoute.selected) throw categorized('CAPABILITY_UNAVAILABLE', 'skill creation requires an L2-capable model');
  let creator = findMission(state, creatorId)?.mission;
  if (!creator) {
    const request = { mission_id: creatorId, skill_id: 'skill-creator', requested_skill_id: null, skill_version: '1.0.0', skill_path: '.agents/skills/skill-creator/SKILL.md', objective: `Create the missing ${skillId} skill`, dependencies: [], acceptance_criteria: original.acceptance_criteria ?? [], file_scope: [`.agents/skills/${skillId}/`], acceptance: [`Create a valid ${skillId} skill`, 'Pass a separate blueprint audit'], validations: [{ id: 'skill-diff', executable: 'git', args: ['diff', '--check'], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' };
    if (creatorRoute) Object.assign(request, { assessment: original.assessment, phase_profile: 'skillCreation', documentation_evidence: original.documentation_evidence, documentation_freshness: original.documentation_freshness, consumption_policy: original.consumption_policy, routing_decision: creatorRoute, escalation_criteria: original.escalation_criteria });
    const prepared = await prepareMission({ operation_id: `${creatorId}-prepare`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: goalId, mission: request } }, root, environment, dependencies);
    creator = findMission(prepared.state, creatorId).mission;
  }
  state = await readOrchestratorState(root);
  if (creator.status === 'ASSIGNED') {
    state = (await transactOrchestrator({ operation_id: `${creatorId}-run`, expected_revision: state.revision, action: 'mission.transition', payload: { goal_id: goalId, mission_id: creatorId, status: 'RUNNING' } }, root, dependencies)).state;
    creator = findMission(state, creatorId).mission;
  }
  let worker; let audit; let accepted = false;
  const auditRoute = original.assessment ? routeTask({ decision_id: `${creatorId}-audit-route`, phase: 'skillAudit', assessment: original.assessment, catalog, consumption: original.consumption_policy, profile: config.modelRouting.profiles.skillAudit, prior_provider_family: creatorRoute.selected.provider_family, remaining_units: remainingUnits(goal) }) : null;
  if (auditRoute?.independence_required && !auditRoute.selected) throw categorized('INDEPENDENT_AUDITOR_UNAVAILABLE', 'skill audit requires an independent provider');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    ensureDeadline(deadline);
    const creatorGoal = state.goals.find(item => item.goal_id === goalId);
    worker = await runWorkerWithSafeRetry(creator, creatorGoal, root, environment, dependencies, dispatch, attempt);
    const receipt = await runMissionValidations(creator, resolve(root, creator.worktree_allocation.path), root, dependencies);
    if (receipt.status !== 'PASSED') throw categorized('SKILL_INVALID', 'created skill failed orchestrator validation');
    audit = await dispatchAndRecord({ dispatch_id: `${creatorId}-audit-${attempt}`, phase: 'audit', mission: missionView(creator, creatorGoal), skill_path: '.agents/skills/blueprint-audit/SKILL.md', output_contract: 'audit-report', worktree: creator.worktree_allocation.path, routing: auditRoute ?? creator.routing_decision ?? null }, goalId, null, root, dependencies, dispatch);
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
  const config = await loadOrchestratorConfig(root);
  let routing = null;
  if (goal.assessment) {
    const catalog = await modelCatalog(root, environment);
    routing = routeTask({ decision_id: `${request.goal_id}-repair-audit-route`, phase: 'goalAudit', assessment: goal.assessment, catalog, consumption: goal.consumption_policy, profile: config.modelRouting.profiles.goalAudit, prior_provider_family: goal.missions[0]?.routing_decision?.selected?.provider_family ?? null, remaining_units: remainingUnits(goal) });
    if (!routing.selected) throw categorized('INDEPENDENT_AUDITOR_UNAVAILABLE', 'no qualified independent final repair auditor');
  }
  const mission = { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: [...new Set(goal.missions.flatMap(item => item.report?.files_touched ?? []))] };
  if (goal.documentation_evidence) mission.documentation_evidence = goal.documentation_evidence;
  mission.consumption_policy = goal.consumption_policy;
  const audited = await runAdaptiveGoalAudit({ request, goal, baseRevision, evidenceRefs: mission.evidence_refs, evidence: goal.documentation_evidence, assessment: goal.assessment, catalog: await modelCatalog(root, environment), consumption: goal.consumption_policy, config, auditRoute: routing, root, dependencies, dispatch, suffix: 'repair' });
  if (goal.documentation_evidence) assertGoalAuditDocumentation(audited.report, goal.documentation_evidence);
  return finalizeGoal(request.goal_id, audited.report, root, environment, dependencies);
}

async function runAdaptiveGoalAudit({ request, goal, baseRevision, evidenceRefs, evidence, assessment, catalog, consumption, config, auditRoute, root, dependencies, dispatch, suffix = 'initial' }) {
  const maximum = config.modelRouting.profiles.goalAudit.max_context_bytes ?? 131072;
  const targets = await Promise.all(evidenceRefs.map(async path => ({ path, component: path.split('/')[0], risk: assessment.importance, context_bytes: Math.min(maximum, (await stat(resolve(root, path)).catch(() => ({ size: 0 }))).size) })));
  const shards = targets.length ? partitionAuditTargets(targets, maximum) : [{ shard_id: 'audit-shard-1', targets: [] }];
  const reports = [];
  for (const shard of shards) {
    const current = (await readOrchestratorState(root)).goals.find(item => item.goal_id === request.goal_id);
    assertRouteBudget(auditRoute, remainingUnits(current));
    const mission = { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: shard.targets.map(target => target.path), documentation_evidence: evidence, consumption_policy: consumption, audit_shard: { shard_id: shard.shard_id, shard_count: shards.length } };
    const dispatchId = shards.length === 1 ? `${request.goal_id}-acceptance${suffix === 'repair' ? '-repair' : ''}` : `${request.goal_id}-acceptance-${suffix}-${shard.shard_id}`;
    const result = await dispatchAndRecord({ dispatch_id: dispatchId, phase: 'goal-audit', mission, skill_path: '.agents/skills/goal-auditor/SKILL.md', output_contract: 'goal-acceptance-report', worktree: '.', routing: auditRoute }, request.goal_id, null, root, dependencies, dispatch);
    reports.push(result.report);
  }
  if (reports.length === 1) return { report: reports[0] };
  const current = (await readOrchestratorState(root)).goals.find(item => item.goal_id === request.goal_id);
  const synthesisRoute = routeTask({ decision_id: `${request.goal_id}-${suffix}-synthesis-route`, phase: 'synthesis', assessment, catalog, consumption, profile: config.modelRouting.profiles.synthesis, prior_provider_family: goal.missions[0]?.routing_decision?.selected?.provider_family ?? null, remaining_units: remainingUnits(current) });
  if (!synthesisRoute.selected) throw categorized(routeBlockedCause(synthesisRoute), 'no qualified model can synthesize the audit shards');
  const mission = { goal_id: request.goal_id, objective: request.objective, acceptance_criteria: request.acceptance_criteria, base_revision: baseRevision, mission_ids: goal.missions.map(item => item.mission_id), evidence_refs: evidenceRefs, documentation_evidence: evidence, consumption_policy: consumption, shard_reports: reports };
  const synthesized = await dispatchAndRecord({ dispatch_id: `${request.goal_id}-acceptance-${suffix}-synthesis`, phase: 'synthesis', mission, skill_path: '.agents/skills/goal-auditor/SKILL.md', output_contract: 'goal-acceptance-report', worktree: '.', routing: synthesisRoute }, request.goal_id, null, root, dependencies, dispatch);
  return synthesized;
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

function missionView(mission, goal) { const view = { goal_id: goal.goal_id, goal_title: goal.title, mission_id: mission.mission_id, skill_id: mission.skill_id, skill_version: mission.skill_version, skill_path: mission.skill_path ?? `.agents/skills/${mission.skill_id}/SKILL.md`, objective: mission.objective ?? mission.acceptance.join('; '), dependencies: mission.dependencies ?? [], acceptance_criteria: mission.acceptance_criteria ?? [], file_scope: mission.file_scope, acceptance: mission.acceptance, validations: mission.validations, response_format: 'worker-report', worktree: mission.worktree_allocation.path }; for (const field of ['assessment', 'phase_profile', 'documentation_evidence', 'documentation_freshness', 'consumption_policy', 'routing_decision', 'escalation_criteria']) if (mission[field] !== undefined) view[field] = mission[field]; assertOrchestratorContract('mission-view', view); return view; }
function assertAcyclic(missions) { const byId = new Map(missions.map(item => [item.mission_id, item])); const visiting = new Set(); const visited = new Set(); const visit = id => { if (visiting.has(id)) throw categorized('PLAN_DEPENDENCY_CYCLE', 'plan dependency graph contains a cycle'); if (visited.has(id)) return; visiting.add(id); for (const dependency of byId.get(id).dependencies) visit(dependency); visiting.delete(id); visited.add(id); }; for (const id of byId.keys()) visit(id); }
function scopesOverlap(left, right) { const a = left.replace(/\/$/u, '').toLocaleLowerCase('en-US'); const b = right.replace(/\/$/u, '').toLocaleLowerCase('en-US'); return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }
function ensureDeadline(deadline) { if (Date.now() >= deadline) throw categorized('GOAL_TIMEOUT', 'goal exceeded its global timeout'); }
async function gitHead(root, dependencies) { const runner = dependencies.execFile ?? execFile; return (await runner('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false })).stdout.trim(); }
function normalizeCause(value) { return /^[A-Z][A-Z0-9_]{0,63}$/u.test(value) ? value : 'GOAL_RUN_FAILED'; }
function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
function assessmentFacts(request) { const text = `${request.title}\n${request.objective}\n${request.acceptance_criteria.join('\n')}`; const signals = []; const patterns = { 'public-api': /\b(?:public api|contract)\b/iu, authentication: /\b(?:auth|oauth|login)\b/iu, permissions: /\bpermissions?\b/iu, secrets: /\bsecrets?\b/iu, data: /\b(?:data|database|corruption)\b/iu, concurrency: /\b(?:race|concurren)\w*/iu, infrastructure: /\b(?:cloud|ci|infrastructure)\b/iu, distributed: /\bdistributed\b/iu, intermittent: /\b(?:intermittent|flaky)\b/iu, irreversible: /\b(?:irreversible|data loss)\b/iu }; for (const [signal, pattern] of Object.entries(patterns)) if (pattern.test(text)) signals.push(signal); return { file_count: request.suggested_paths.length, component_count: new Set(request.suggested_paths.map(path => path.split('/')[0])).size, context_bytes: Buffer.byteLength(text), risk_signals: signals, reproducibility: request.change_kind === 'bugfix' ? (/\breproduc(?:ed|ible)\b/iu.test(text) ? 'reproduced' : 'not-reproduced') : 'not-applicable', validation_strength: request.acceptance_criteria.length ? 'moderate' : 'none', rollback: /\birreversible\b/iu.test(text) ? 'irreversible' : 'bounded', ambiguity: request.suggested_paths.length ? 'low' : 'high' }; }
function remainingUnits(goal) { return goal.consumption_policy ? Math.max(0, goal.consumption_policy.max_normalized_units - (goal.execution_receipts ?? []).reduce((sum, receipt) => sum + receipt.normalized_units, 0)) : Number.MAX_SAFE_INTEGER; }
function remainingFromReceipts(policy, receipts) { return Math.max(0, policy.max_normalized_units - receipts.reduce((sum, receipt) => sum + receipt.normalized_units, 0)); }
function affordableMissions(candidates, goal, config) {
  const availableUnits = remainingUnits(goal);
  const researchUnits = goal.routing_decisions?.find(decision => decision.phase === 'research')?.selected?.normalized_units ?? 0;
  let reserved = 0;
  return candidates.filter(mission => {
    if (!mission.routing_decision?.selected) return true;
    const attempts = config.modelRouting.profiles[mission.phase_profile ?? 'work'].attempts;
    const requiresRefresh = mission.documentation_evidence?.requirements.some(requirement => requirement.freshness === 'per-dispatch');
    const required = mission.routing_decision.selected.normalized_units * attempts + (requiresRefresh ? researchUnits : 0);
    if (reserved + required > availableUnits) return false;
    reserved += required;
    return true;
  });
}
async function dispatchAndCollect(options, dispatch, receipts, policy) {
  const bounded = { ...options, mission: withRemainingCost(options.mission, options.routing, remainingCost(policy, receipts)) };
  try { const result = await dispatch(bounded); if (result.receipt) receipts.push(result.receipt); return result; }
  catch (error) { if (error.executionReceipt) receipts.push(error.executionReceipt); throw error; }
}
async function dispatchAndRecord(options, goalId, missionId, root, dependencies, dispatch) {
  const goal = (await readOrchestratorState(root)).goals.find(item => item.goal_id === goalId);
  if (options.routing && goal?.consumption_policy) assertRouteBudget(options.routing, remainingUnits(goal));
  const bounded = { ...options, mission: withRemainingCost(options.mission, options.routing, remainingCost(goal?.consumption_policy, goal?.execution_receipts ?? [])) };
  try { const result = await dispatch(bounded); if (result.receipt) await recordReceipt(goalId, missionId, result.receipt, root, dependencies); return result; }
  catch (error) { if (error.executionReceipt) await recordReceipt(goalId, missionId, error.executionReceipt, root, dependencies); throw error; }
}
async function recordReceipt(goalId, missionId, receipt, root, dependencies) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const state = await readOrchestratorState(root);
    try { await transactOrchestrator({ operation_id: `${receipt.receipt_id}-record`, expected_revision: state.revision, action: 'receipt.record', payload: { goal_id: goalId, mission_id: missionId, receipt } }, root, dependencies); return; }
    catch (error) { if (!/revision conflict/iu.test(error.message) || attempt === 4) throw error; }
  }
}
function assertGoalAuditDocumentation(report, evidence) {
  if (evidence.status !== 'SATISFIED') return;
  if (!report.documentation_source_ids?.length) throw categorized('DOCUMENTATION_CITATION_REQUIRED', 'goal audit must cite current documentation evidence');
  const ledger = new Set(evidence.sources.map(source => source.source_id));
  if (report.documentation_source_ids.some(source => !ledger.has(source))) throw categorized('DOCUMENTATION_LEDGER_MISMATCH', 'goal audit cited documentation outside the current ledger');
}
function routeBlockedCause(route) { return route?.rejected.some(candidate => candidate.causes.includes('budget-exhausted')) ? 'BUDGET_EXHAUSTED' : 'CAPABILITY_UNAVAILABLE'; }
function assertRouteBudget(route, remaining) { if (!route.selected || remaining < route.selected.normalized_units) throw categorized('BUDGET_EXHAUSTED', 'remaining normalized units cannot fund the selected dispatch'); }
export function remainingCost(policy, receipts) {
  if (policy?.max_cost_usd === null || policy?.max_cost_usd === undefined) return null;
  const chargeable = receipts.filter(receipt => receipt.adapter === 'claude');
  if (chargeable.some(receipt => !Number.isFinite(receipt.cost_usd))) return 0;
  return Math.max(0, policy.max_cost_usd - chargeable.reduce((sum, receipt) => sum + receipt.cost_usd, 0));
}
function withRemainingCost(mission, route, remaining) {
  if (route?.selected?.adapter !== 'claude' || remaining === null) return mission;
  if (remaining <= 0) throw categorized('BUDGET_EXHAUSTED', 'remaining USD budget cannot fund another Claude dispatch');
  const field = mission.consumption_policy ? 'consumption_policy' : 'consumption';
  return { ...mission, [field]: { ...mission[field], max_cost_usd: remaining } };
}
function consumeKnownCost(remaining, receipt) {
  if (remaining === null || receipt.adapter !== 'claude') return remaining;
  return Number.isFinite(receipt.cost_usd) ? Math.max(0, remaining - receipt.cost_usd) : 0;
}
