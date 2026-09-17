import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { canonicalMode, hasValidPolicyDigest } from './orchestration-policy-core.mjs';

export function executionBindingForMission(state, missionId, config, sessionId = null) {
  const located = state.goals.flatMap(goal => goal.missions.map(mission => ({ goal, mission })))
    .find(item => item.mission.mission_id === missionId);
  if (!located?.mission.worktree_allocation?.path) throw categorized('EXECUTION_BINDING_MISSING', 'worker role requires an assigned mission');
  const { goal, mission } = located;
  if (!goal.resolved_policy || !hasValidPolicyDigest(goal.resolved_policy) || goal.policy_digest !== goal.resolved_policy.policy_digest) {
    throw categorized('EXECUTION_BINDING_POLICY_INVALID', 'goal policy is missing, stale, or invalid');
  }
  const stage = goal.resolved_policy.stages[goal.stage_index];
  if (!stage || stage.stage !== goal.stage || stage.strategy !== goal.strategy) {
    throw categorized('EXECUTION_BINDING_STAGE_INVALID', 'goal stage is absent from its frozen policy');
  }
  if (mission.policy_digest !== goal.policy_digest || mission.stage !== goal.stage || mission.strategy !== stage.strategy || mission.access !== stage.access) {
    throw categorized('EXECUTION_BINDING_CONTRADICTORY', 'mission execution fields contradict durable goal state');
  }
  const binding = {
    goal_id: goal.goal_id,
    mission_id: mission.mission_id,
    policy_snapshot: `${config.policySnapshotRoot}/${goal.goal_id}.json`.replaceAll('\\', '/'),
    policy_digest: goal.policy_digest,
    workflow: goal.workflow,
    stage: stage.stage,
    strategy: stage.strategy,
    access: stage.access,
    revision: state.revision,
  };
  if (sessionId) binding.session_id = String(sessionId).slice(0, 128);
  assertOrchestratorContract('execution-binding', binding);
  return { binding, goal, mission, requestedMode: goal.requested_mode ?? canonicalMode(state.mode), resolvedMode: goal.resolved_mode ?? canonicalMode(state.mode) };
}

export function assertBindingEnvironment(binding, environment = {}) {
  const checks = [
    ['CTXROUTE_POLICY_SNAPSHOT', 'policy_snapshot'],
    ['CTXROUTE_POLICY_DIGEST', 'policy_digest'],
    ['CTXROUTE_WORKFLOW', 'workflow'],
    ['CTXROUTE_STAGE', 'stage'],
    ['CTXROUTE_STRATEGY', 'strategy'],
    ['CTXROUTE_ACCESS', 'access'],
  ];
  for (const [environmentName, field] of checks) {
    if (environment[environmentName] !== undefined && environment[environmentName] !== binding[field]) {
      throw categorized('EXECUTION_BINDING_ENVIRONMENT_MISMATCH', `${environmentName} contradicts durable execution binding`);
    }
  }
  if (environment.CTXROUTE_BINDING_REVISION !== undefined && Number(environment.CTXROUTE_BINDING_REVISION) !== binding.revision) {
    throw categorized('EXECUTION_BINDING_STALE', 'binding revision contradicts durable orchestrator state');
  }
  return binding;
}

function categorized(code, message) { const error = new Error(message); error.causeCode = code; return error; }
