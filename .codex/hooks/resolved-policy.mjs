import { resolve } from 'node:path';
import { loadOrchestratorConfig, readOrchestratorState, safeRelativePath } from '../../scripts/orchestrator-core.mjs';
import { loadPolicySnapshot } from '../../scripts/orchestrator-policy-snapshot.mjs';
import { assertBindingEnvironment, executionBindingForMission } from '../../scripts/orchestrator-execution-binding.mjs';
import { extractPaths } from './path-extraction.mjs';
import { verifyWorkerRoots } from '../../scripts/orchestrator-worker-roots.mjs';

export async function resolvedPolicyDecision(input, root = process.cwd(), environment = process.env) {
  const stateRoot = environment.CTXROUTE_AGENT_ROLE === 'worker' ? environment.CTXROUTE_PRIMARY_ROOT ?? root : root;
  let parsed;
  try { parsed = input === String(input) ? JSON.parse(input || '{}') : input; }
  catch { return { decision: block(null, environment, 'HOOK_INPUT_INVALID', 'mutation input must be valid JSON'), policy: null, source: 'unverified', diagnostic: 'invalid hook input' }; }
  if (!isMutationTool(parsed?.tool_name)) return { decision: null, policy: null, source: 'not-required', diagnostic: null };
  let config;
  try { config = await loadOrchestratorConfig(stateRoot); }
  catch (error) { return { decision: block(null, environment, 'POLICY_CONFIG_INVALID', 'mutation policy must come from validated configuration'), policy: null, source: 'unverified', diagnostic: error.message }; }
  let binding = null;
  let boundMission = null;
  const missionId = environment.CTXROUTE_MISSION_ID;
  if (environment.CTXROUTE_AGENT_ROLE === 'worker' || missionId) {
    if (!missionId) return { decision: block(null, environment, 'EXECUTION_BINDING_MISSING', 'worker mutations require a durable mission binding'), policy: null, source: 'unverified', diagnostic: 'missing mission id' };
    try {
      const state = await readOrchestratorState(stateRoot);
      const resolvedBinding = executionBindingForMission(state, missionId, config, parsed?.session_id);
      binding = resolvedBinding.binding;
      boundMission = resolvedBinding.mission;
      if (environment.CTXROUTE_PRIMARY_ROOT || environment.CTXROUTE_WORKTREE) {
        if (!environment.CTXROUTE_PRIMARY_ROOT || !environment.CTXROUTE_WORKTREE || resolve(root) !== resolve(environment.CTXROUTE_WORKTREE) || resolve(stateRoot, boundMission.worktree_allocation.path) !== resolve(root)) throw new Error('worker worktree does not match durable mission');
        await verifyWorkerRoots(stateRoot, root);
      }
      assertBindingEnvironment(binding, environment);
    } catch (error) {
      return { decision: block(null, environment, error.causeCode ?? 'EXECUTION_BINDING_INVALID', 'worker mutations require a current, consistent durable binding'), policy: null, source: 'unverified', diagnostic: error.message };
    }
  }
  if (boundMission) {
    const adrPaths = extractPaths(parsed?.tool_input ?? {}).filter(path => /^docs\/decisions\/ADR-(?!0000-).+\.md$/u.test(path));
    const outsideAdrAuthority = adrPaths.filter(path => !boundMission.file_scope.some(scope => path === scope.replace(/\/$/u, '') || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)));
    if (outsideAdrAuthority.length) return { decision: block(null, binding, 'ADR_WORKER_AUTHORITY_REQUIRED', 'workers may edit ADRs only when their mission file scope explicitly includes them'), policy: null, source: 'unverified', diagnostic: outsideAdrAuthority.join(', ') };
    const outsideScope = extractPaths(parsed?.tool_input ?? {}).filter(path => !boundMission.file_scope.some(scope => path === scope.replace(/\/$/u, '') || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)));
    if (outsideScope.length) return { decision: block(null, binding, 'WORKER_SCOPE_VIOLATION', 'workers may edit only their assigned file scope'), policy: null, source: 'unverified', diagnostic: outsideScope.join(', ') };
  }
  const requested = binding?.policy_snapshot ?? environment.CTXROUTE_POLICY_SNAPSHOT ?? config.policySnapshotPath;
  if (!safeRelativePath(requested) || (requested !== config.policySnapshotPath && !requested.startsWith(`${config.policySnapshotRoot}/`))) {
    return { decision: block(null, environment, 'POLICY_SNAPSHOT_PATH_UNSAFE', 'policy snapshots must remain under the orchestrator policy root'), policy: null, source: 'unverified', diagnostic: 'unsafe policy snapshot path' };
  }
  const loaded = await loadPolicySnapshot({ path: resolve(stateRoot, requested), config, mutation: true });
  const policy = loaded.policy;
  if (!policy) return { ...loaded, decision: block(null, environment, 'POLICY_UNVERIFIED', 'mutations require a verified resolved execution policy') };
  const expectedDigest = binding?.policy_digest ?? environment.CTXROUTE_POLICY_DIGEST;
  if (expectedDigest && expectedDigest !== policy.policy_digest) return { ...loaded, decision: block(policy, binding ?? environment, 'POLICY_DIGEST_MISMATCH', 'mission and snapshot policy digests must match') };
  const stageName = binding?.stage ?? environment.CTXROUTE_STAGE;
  const stage = stageName ? policy.stages.find(item => item.stage === stageName) : null;
  if (stageName && !stage) return { ...loaded, decision: block(policy, binding ?? environment, 'POLICY_STAGE_UNKNOWN', 'the bound stage must exist in the frozen policy') };
  if (policy.resolution_status !== 'RESOLVED') return { ...loaded, decision: block(policy, environment, policy.resolution_status, 'mutations require a resolved execution policy') };
  if (!policy.write_allowed || binding?.access === 'read-only' || stage?.access === 'read-only') return { ...loaded, decision: block(policy, binding ?? environment, 'POLICY_READ_ONLY', 'read-only workflow or stage forbids repository mutation') };
  return { ...loaded, binding, decision: null };
}

function isMutationTool(name) {
  return /^(?:apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell)$/iu.test(String(name ?? ''));
}

function block(policy, context, cause, invariant) {
  return {
    kind: 'block',
    mode: policy?.mode ?? context?.CTXROUTE_MODE ?? 'SWARM',
    workflow: context?.workflow ?? policy?.workflow ?? context?.CTXROUTE_WORKFLOW ?? 'STANDARD',
    stage: context?.stage ?? context?.CTXROUTE_STAGE ?? policy?.stages?.[0]?.stage ?? 'inventory',
    policy_digest: context?.policy_digest ?? policy?.policy_digest ?? context?.CTXROUTE_POLICY_DIGEST ?? 'NO_DIGEST',
    cause,
    invariant,
    recovery: 'orchestrator_explain_execution or npm run orchestrator:doctor',
  };
}
