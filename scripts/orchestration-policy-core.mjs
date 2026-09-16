import { createHash } from 'node:crypto';

export const OPERATING_MODES = Object.freeze(['SWARM', 'AUTO', 'SOLO', 'GUARDED', 'DIRECT']);
export const WORKFLOWS = Object.freeze(['STANDARD', 'RESEARCH', 'AUDIT', 'SECURITY', 'MIGRATION', 'INCIDENT', 'EXPERIMENT', 'RECOVERY']);
export const STAGE_STRATEGIES = Object.freeze(['deterministic', 'primary', 'single-worker', 'parallel-workers', 'independent-auditor', 'human-decision']);
export const RESOLUTION_STATUSES = Object.freeze(['RESOLVED', 'WAITING_FOR_USER_DECISION', 'WAITING_FOR_CAPABILITY', 'BLOCKED', 'POLICY_UNSATISFIABLE']);

const stages = Object.freeze({
  STANDARD: [['inventory', 'deterministic'], ['planning', 'primary'], ['work', 'parallel-workers'], ['validation', 'deterministic'], ['audit', 'independent-auditor'], ['integration', 'deterministic']],
  RESEARCH: [['inventory', 'deterministic'], ['research', 'parallel-workers'], ['decision', 'primary']],
  AUDIT: [['inventory', 'deterministic'], ['audit', 'independent-auditor']],
  SECURITY: [['inventory', 'deterministic'], ['research', 'parallel-workers'], ['planning', 'primary'], ['work', 'single-worker'], ['validation', 'deterministic'], ['audit', 'independent-auditor'], ['integration', 'deterministic']],
  MIGRATION: [['inventory', 'deterministic'], ['planning', 'primary'], ['work', 'parallel-workers'], ['validation', 'deterministic'], ['integration', 'deterministic'], ['recovery', 'deterministic']],
  INCIDENT: [['inventory', 'deterministic'], ['research', 'parallel-workers'], ['decision', 'primary'], ['work', 'single-worker'], ['validation', 'deterministic'], ['integration', 'deterministic']],
  EXPERIMENT: [['inventory', 'deterministic'], ['planning', 'primary'], ['work', 'single-worker'], ['validation', 'deterministic'], ['promotion', 'human-decision']],
  RECOVERY: [['inventory', 'deterministic'], ['recovery', 'single-worker'], ['decision', 'human-decision'], ['validation', 'deterministic']],
});

export const MODE_DESCRIPTORS = Object.freeze({
  SWARM: descriptor('SWARM', true, true, 8, 'worktree'),
  AUTO: descriptor('AUTO', true, true, 8, 'adaptive'),
  SOLO: descriptor('SOLO', true, false, 1, 'worktree'),
  GUARDED: descriptor('GUARDED', true, false, 1, 'checkout'),
  DIRECT: descriptor('DIRECT', false, false, 1, 'checkout'),
});

export const WORKFLOW_DESCRIPTORS = Object.freeze(Object.fromEntries(WORKFLOWS.map(name => [name, Object.freeze({
  workflow: name,
  read_only: name === 'RESEARCH' || name === 'AUDIT',
  terminal_status: name === 'EXPERIMENT' ? 'READY_FOR_PROMOTION' : 'COMPLETED',
  stages: Object.freeze(stages[name].map(([stage, strategy]) => Object.freeze({ stage, strategy }))),
})])));

export function canonicalMode(value) {
  if (value === 'SWARM_ON') return 'SWARM';
  if (value === 'SWARM_OFF') return 'DIRECT';
  return OPERATING_MODES.includes(value) ? value : null;
}

export function policyDigest(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function resolveExecutionPolicy(input = {}) {
  const requestedMode = canonicalMode(input.requested_mode ?? input.mode ?? 'SWARM');
  const workflow = WORKFLOWS.includes(input.workflow) ? input.workflow : 'STANDARD';
  if (!requestedMode) return unsatisfiable('UNKNOWN_MODE', input.requested_mode ?? input.mode, workflow);
  const mode = requestedMode === 'AUTO' ? chooseAutoMode(input, workflow) : requestedMode;
  const modeDescriptor = MODE_DESCRIPTORS[mode];
  const workflowDescriptor = WORKFLOW_DESCRIPTORS[workflow];
  const layers = [modeDescriptor, workflowDescriptor, ...(input.constraints ?? [])];
  const permissions = intersectSets(layers.map(item => item.permissions).filter(Boolean));
  const requirements = unionSets(layers.map(item => item.requirements).filter(Boolean));
  const riskFloor = Math.max(0, ...layers.map(item => Number(item.risk_floor ?? 0)));
  const modelFloor = Math.max(0, ...layers.map(item => Number(item.model_floor ?? 0)));
  const parallelLimit = Math.min(...layers.map(item => Number(item.parallel_limit ?? Number.POSITIVE_INFINITY)));
  const writeAllowed = !workflowDescriptor.read_only && layers.every(item => item.write_allowed !== false);
  const capabilities = new Set(input.capabilities ?? []);
  const missing = requirements.filter(item => !capabilities.has(item));
  const stagesResolved = workflowDescriptor.stages.map(item => ({
    ...item,
    strategy: restrictStrategy(item.strategy, { mode, parallelLimit, workflow }),
    access: writeAllowed && ['work', 'integration', 'recovery', 'promotion'].includes(item.stage) ? 'write' : 'read-only',
  }));
  const contradictions = [];
  if (workflowDescriptor.read_only && input.require_write) contradictions.push('READ_ONLY_WORKFLOW_REQUIRES_WRITE');
  if (!writeAllowed && input.require_write) contradictions.push('WRITE_PERMISSION_UNSATISFIABLE');
  if (Number.isFinite(parallelLimit) && parallelLimit < 1) contradictions.push('PARALLEL_LIMIT_BELOW_ONE');
  if (input.parallel_writers > 1 && (!input.disjoint_write_scopes_proven || workflowDescriptor.read_only)) contradictions.push('PARALLEL_WRITERS_NOT_PROVEN_DISJOINT');
  if (input.parallel_git_mutations) contradictions.push('PARALLEL_GIT_MUTATION_FORBIDDEN');
  if (contradictions.length) return finish('POLICY_UNSATISFIABLE', { requested_mode: requestedMode, mode, workflow, causes: contradictions, stages: stagesResolved });
  const alternatives = [...new Set(input.user_alternatives ?? [])].filter(item => OPERATING_MODES.includes(canonicalMode(item)));
  if (input.user_decision_required && alternatives.length) return finish('WAITING_FOR_USER_DECISION', { requested_mode: requestedMode, mode, workflow, alternatives, causes: ['USER_DECISION_REQUIRED'], stages: stagesResolved });
  if (missing.length) return finish('WAITING_FOR_CAPABILITY', { requested_mode: requestedMode, mode, workflow, missing_capabilities: missing, causes: ['CAPABILITY_MISSING'], stages: stagesResolved });
  return finish('RESOLVED', {
    requested_mode: requestedMode, mode, workflow, permissions, requirements, risk_floor: riskFloor,
    model_floor: modelFloor, parallel_limit: Number.isFinite(parallelLimit) ? parallelLimit : 1,
    write_allowed: writeAllowed, repository_mutation_serialized: true, stages: stagesResolved,
    reinforcements: explainReinforcements(mode, workflowDescriptor),
  });
}

export function explainExecutionPolicy(input = {}) {
  const policy = resolveExecutionPolicy(input);
  return { ...policy, explanation: policy.reinforcements ?? policy.causes ?? [] };
}

export function decisionCanResolve(request, receipt) {
  if (!request || !receipt || request.decision_id !== receipt.decision_id || request.policy_digest !== receipt.policy_digest) return false;
  if (!request.allowed_alternatives?.includes(receipt.selection)) return false;
  return !['disable-security-floor', 'disable-isolation', 'skip-critical-audit'].includes(receipt.selection);
}

function descriptor(mode, durable, parallel, parallelLimit, isolation) {
  return Object.freeze({ mode, durable, parallel, parallel_limit: parallelLimit, isolation, write_allowed: true, permissions: ['read', 'write'], requirements: durable ? ['git'] : [] });
}
function chooseAutoMode(input, workflow) {
  if (WORKFLOW_DESCRIPTORS[workflow].read_only && !input.require_isolation) return 'GUARDED';
  if (input.require_isolation || input.file_scopes?.length > 1) return input.allow_parallel === false ? 'SOLO' : 'SWARM';
  return 'GUARDED';
}
function restrictStrategy(strategy, { mode, parallelLimit, workflow }) {
  if (strategy !== 'parallel-workers') return strategy;
  if (parallelLimit <= 1 || ['SOLO', 'GUARDED', 'DIRECT'].includes(mode)) return mode === 'DIRECT' || mode === 'GUARDED' ? 'primary' : 'single-worker';
  if (workflow === 'AUDIT') return 'independent-auditor';
  return strategy;
}
function explainReinforcements(mode, workflow) {
  const result = ['All shared Git mutations use the repository mutation lock.'];
  if (workflow.read_only) result.push('The workflow is mechanically read-only.');
  if (['SWARM', 'SOLO'].includes(mode)) result.push('Work executes in an isolated worktree.');
  if (workflow.workflow === 'EXPERIMENT') result.push('Integration is forbidden until an explicit promotion receipt exists.');
  return result;
}
function finish(status, policy) { const base = { resolution_status: status, ...policy }; return Object.freeze({ ...base, policy_digest: policyDigest(base) }); }
function unsatisfiable(cause, value, workflow) { return finish('POLICY_UNSATISFIABLE', { requested_mode: value ?? null, mode: null, workflow, causes: [cause], stages: [] }); }
function unionSets(values) { return [...new Set(values.flat())].sort(); }
function intersectSets(values) { if (!values.length) return []; return [...new Set(values[0])].filter(item => values.every(value => value.includes(item))).sort(); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && value === Object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; return JSON.stringify(value); }
