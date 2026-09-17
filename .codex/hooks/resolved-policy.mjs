import { resolve } from 'node:path';
import { loadOrchestratorConfig, safeRelativePath } from '../../scripts/orchestrator-core.mjs';
import { loadPolicySnapshot } from '../../scripts/orchestrator-policy-snapshot.mjs';

export async function resolvedPolicyDecision(input, root = process.cwd(), environment = process.env) {
  let parsed;
  try { parsed = input === String(input) ? JSON.parse(input || '{}') : input; }
  catch { return { decision: block(null, environment, 'HOOK_INPUT_INVALID', 'mutation input must be valid JSON'), policy: null, source: 'unverified', diagnostic: 'invalid hook input' }; }
  if (!isMutationTool(parsed?.tool_name)) return { decision: null, policy: null, source: 'not-required', diagnostic: null };
  let config;
  try { config = await loadOrchestratorConfig(root); }
  catch (error) { return { decision: block(null, environment, 'POLICY_CONFIG_INVALID', 'mutation policy must come from validated configuration'), policy: null, source: 'unverified', diagnostic: error.message }; }
  const requested = environment.CTXROUTE_POLICY_SNAPSHOT ?? config.policySnapshotPath;
  if (!safeRelativePath(requested) || (requested !== config.policySnapshotPath && !requested.startsWith(`${config.policySnapshotRoot}/`))) {
    return { decision: block(null, environment, 'POLICY_SNAPSHOT_PATH_UNSAFE', 'policy snapshots must remain under the orchestrator policy root'), policy: null, source: 'unverified', diagnostic: 'unsafe policy snapshot path' };
  }
  const loaded = await loadPolicySnapshot({ path: resolve(root, requested), config, mutation: true });
  const policy = loaded.policy;
  if (!policy) return { ...loaded, decision: block(null, environment, 'POLICY_UNVERIFIED', 'mutations require a verified resolved execution policy') };
  if (environment.CTXROUTE_POLICY_DIGEST && environment.CTXROUTE_POLICY_DIGEST !== policy.policy_digest) return { ...loaded, decision: block(policy, environment, 'POLICY_DIGEST_MISMATCH', 'mission and snapshot policy digests must match') };
  const stageName = environment.CTXROUTE_STAGE;
  const stage = stageName ? policy.stages.find(item => item.stage === stageName) : null;
  if (policy.resolution_status !== 'RESOLVED') return { ...loaded, decision: block(policy, environment, policy.resolution_status, 'mutations require a resolved execution policy') };
  if (!policy.write_allowed || stage?.access === 'read-only') return { ...loaded, decision: block(policy, environment, 'POLICY_READ_ONLY', 'read-only workflow or stage forbids repository mutation') };
  return { ...loaded, decision: null };
}

function isMutationTool(name) {
  return /^(?:apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell)$/iu.test(String(name ?? ''));
}

function block(policy, environment, cause, invariant) {
  return {
    kind: 'block',
    mode: policy?.mode ?? environment.CTXROUTE_MODE ?? 'SWARM',
    workflow: policy?.workflow ?? environment.CTXROUTE_WORKFLOW ?? 'STANDARD',
    stage: environment.CTXROUTE_STAGE ?? policy?.stages?.[0]?.stage ?? 'inventory',
    policy_digest: policy?.policy_digest ?? environment.CTXROUTE_POLICY_DIGEST ?? 'NO_DIGEST',
    cause,
    invariant,
    recovery: 'orchestrator_explain_execution or npm run orchestrator:doctor',
  };
}
