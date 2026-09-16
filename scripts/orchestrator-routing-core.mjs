import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

const LEVEL_RANK = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 });
const MODEL_LEVEL = Object.freeze({ small: 1, balanced: 2, advanced: 3, critical: 4 });
const CONTEXT_RANK = Object.freeze({ small: 0, medium: 1, large: 2, xlarge: 3 });
const COST_RANK = Object.freeze({ free: 0, low: 1, medium: 2, high: 3, unknown: 4 });
const PHASES = new Set(['research', 'planning', 'work', 'skillCreation', 'skillAudit', 'repair', 'goalAudit', 'conflictAnalysis', 'synthesis']);

export function assessTask(request, facts = {}) {
  const importance = request.importance ?? 'normal';
  const changeKind = request.change_kind ?? 'feature';
  const signals = new Set(facts.risk_signals ?? []);
  if (facts.external_dependency) signals.add('external-dependency');
  if (facts.file_count > 1 || facts.component_count > 1) signals.add('cross-component');
  let floor = 1;
  const reasons = ['Bounded non-deterministic work requires at least L1.'];
  if (facts.deterministic === true) { floor = 0; reasons.splice(0, 1, 'The action is fully deterministic.'); }
  if (changeKind === 'bugfix' && facts.reproducibility !== 'reproduced') { floor = Math.max(floor, 2); reasons.push('An unreproduced bug requires L2.'); }
  if ((facts.file_count ?? 0) > 1) { floor = Math.max(floor, 2); reasons.push('Multi-file scope requires L2.'); }
  if (['public-api'].some(signal => signals.has(signal))) { floor = Math.max(floor, 2); reasons.push('A public contract requires L2 and independent audit.'); }
  if (['authentication', 'permissions', 'secrets', 'concurrency'].some(signal => signals.has(signal)) || ['security', 'migration'].includes(changeKind)) { floor = Math.max(floor, 3); reasons.push('Security, concurrency, or migration risk requires L3.'); }
  if (importance === 'high') { floor = Math.max(floor, 3); reasons.push('High importance requires an L3 final audit.'); }
  if (importance === 'critical' || changeKind === 'incident' || signals.has('irreversible')) { floor = 4; reasons.push('Critical, incident, or irreversible work requires L4.'); }
  const contextClass = facts.context_class ?? ((facts.context_bytes ?? 0) > 500_000 ? 'xlarge' : (facts.context_bytes ?? 0) > 150_000 ? 'large' : (facts.context_bytes ?? 0) > 30_000 ? 'medium' : 'small');
  const assessment = {
    assessment_id: `${request.goal_id ?? facts.mission_id ?? 'task'}-assessment`, importance, change_kind: changeKind,
    minimum_level: `L${floor}`, context_class: contextClass, risk_signals: [...signals].sort(),
    reproducibility: facts.reproducibility ?? (changeKind === 'bugfix' ? 'not-reproduced' : 'not-applicable'),
    validation_strength: facts.validation_strength ?? 'moderate', rollback: facts.rollback ?? 'bounded',
    ambiguity: facts.ambiguity ?? 'medium', failure_count: facts.failure_count ?? 0, reasons: [...new Set(reasons)],
  };
  assertOrchestratorContract('task-assessment', assessment);
  return assessment;
}

export function resolveConsumptionPolicy(input = {}, defaults = {}) {
  const preset = input.preset ?? defaults.preset ?? 'balanced';
  const policy = {
    preset,
    max_duration_ms: input.max_duration_ms ?? defaults.max_duration_ms ?? 900_000,
    max_normalized_units: input.max_normalized_units ?? defaults.max_normalized_units ?? 100,
    max_cost_usd: input.max_cost_usd ?? defaults.max_cost_usd ?? null,
    allowed_providers: input.allowed_providers ?? defaults.allowed_providers ?? ['codex', 'claude', 'gemini'],
    denied_models: input.denied_models ?? defaults.denied_models ?? [],
    prefer_local: input.prefer_local ?? defaults.prefer_local ?? false,
    local_only: input.local_only ?? defaults.local_only ?? false,
  };
  assertOrchestratorContract('consumption-policy', policy);
  return policy;
}

export function routeTask({ decision_id, phase, assessment, catalog, consumption, profile = {}, planner_minimum = null, mission_override = {}, skill_policy = {}, prior_provider_family = null, remaining_units = null }) {
  if (!PHASES.has(phase)) throw new TypeError(`Unknown routing phase: ${phase}`);
  assertOrchestratorContract('task-assessment', assessment);
  assertOrchestratorContract('consumption-policy', consumption);
  catalog.forEach(model => assertOrchestratorContract('model-descriptor', model));
  const cascade = [];
  let floor = LEVEL_RANK[assessment.minimum_level];
  cascade.push({ source: 'safety-floor', effect: `minimum ${assessment.minimum_level}` });
  if (planner_minimum) { floor = Math.max(floor, rankLevel(planner_minimum)); cascade.push({ source: 'goal-constraint', effect: `minimum ${planner_minimum}` }); }
  if (mission_override.minimum_level) { floor = Math.max(floor, rankLevel(mission_override.minimum_level)); cascade.push({ source: 'mission-override', effect: `minimum ${mission_override.minimum_level}` }); }
  if (skill_policy.minimum_level) { floor = Math.max(floor, rankLevel(skill_policy.minimum_level)); cascade.push({ source: 'skill-policy', effect: `minimum ${skill_policy.minimum_level}` }); }
  const phaseFloor = phaseMinimum(phase, assessment, consumption.preset, profile);
  floor = Math.max(floor, phaseFloor); cascade.push({ source: 'phase-profile', effect: `minimum L${phaseFloor}` });
  cascade.push({ source: 'user-preset', effect: consumption.preset });
  cascade.push({ source: 'project-policy', effect: profile.name ?? 'default-profile' });
  cascade.push({ source: 'framework-default', effect: 'smallest-qualified-model' });
  const accessMode = phase === 'work' || phase === 'repair' || phase === 'skillCreation' ? 'workspace-write' : 'read-only';
  const required = new Set(['structured-output']);
  if (['work', 'repair', 'skillCreation'].includes(phase)) required.add('code');
  if (phase === 'research') required.add('web-research');
  if (['large', 'xlarge'].includes(assessment.context_class)) required.add('long-context');
  const independenceRequired = (profile.independence === true && floor >= 3) || ((assessment.importance === 'critical' || consumption.preset === 'quality') && ['goalAudit', 'synthesis'].includes(phase)) || (floor >= 3 && phase === 'skillAudit');
  const requestedEffort = effortFor(floor, profile.effort);
  const rejected = [];
  const candidates = [];
  for (const model of catalog) {
    const causes = [];
    if (model.status !== 'available') causes.push(`status-${model.status}`);
    if (!consumption.allowed_providers.includes(model.adapter)) causes.push('provider-denied');
    if (consumption.denied_models.includes(model.model_id)) causes.push('model-denied');
    if (MODEL_LEVEL[model.level] < floor) causes.push('level-insufficient');
    if (CONTEXT_RANK[model.context_class] < CONTEXT_RANK[assessment.context_class]) causes.push('context-insufficient');
    if (![...required].every(capability => model.capabilities.includes(capability))) causes.push('capability-missing');
    if (!model.access_modes.includes(accessMode)) causes.push('sandbox-inadequate');
    if (!model.efforts.includes(requestedEffort)) causes.push('effort-unsupported');
    if (independenceRequired && prior_provider_family && model.provider_family === prior_provider_family) causes.push('independence-required');
    if (remaining_units !== null && remaining_units < normalizedUnits(model)) causes.push('budget-exhausted');
    if (causes.length) rejected.push({ adapter: model.adapter, model_id: model.model_id, causes: [...new Set(causes)].sort() });
    else candidates.push(model);
  }
  candidates.sort(candidateComparator(consumption.preset));
  const selectedModel = floor === 0 ? null : candidates[0] ?? null;
  const level = `L${floor}`;
  const decision = {
    decision_id, phase, level,
    selected: selectedModel ? { adapter: selectedModel.adapter, model_id: selectedModel.model_id, provider_family: selectedModel.provider_family, normalized_units: normalizedUnits(selectedModel) } : null,
    effort: floor === 0 ? 'none' : requestedEffort, access_mode: accessMode, required_capabilities: [...required].sort(), cascade, rejected,
    independence_required: independenceRequired,
    reason: floor === 0 ? 'Deterministic execution requires no model.' : selectedModel ? `Selected the smallest qualified ${selectedModel.level} model.` : 'No qualified model satisfies the closed constraints.',
  };
  assertOrchestratorContract('routing-decision', decision);
  return decision;
}

export function explainRoute(input) { return routeTask(input); }
export function nextLevel(level) { return level === 'L1' ? 'L2' : level === 'L2' ? 'L3' : level === 'L3' ? 'L4' : level; }
export function normalizedUnits(model) { return ({ free: 1, low: 2, medium: 4, high: 8, unknown: 8 })[model.cost_class]; }

function rankLevel(level) { if (!(level in LEVEL_RANK)) throw new TypeError(`Invalid routing level: ${level}`); return LEVEL_RANK[level]; }
function phaseMinimum(phase, assessment, preset, profile) {
  let floor = profile.minimum_level ? rankLevel(profile.minimum_level) : 1;
  if (phase === 'skillCreation') floor = Math.max(floor, 2);
  if (phase === 'goalAudit') floor = Math.max(floor, assessment.importance === 'critical' ? 4 : assessment.importance === 'high' ? 3 : 2);
  if (phase === 'conflictAnalysis') floor = Math.max(floor, 2);
  if (preset === 'quality' && phase === 'planning') floor = Math.max(floor, 2);
  return floor;
}
function effortFor(floor, configured) { if (configured) return configured; return floor <= 1 ? 'low' : floor === 2 ? 'medium' : floor === 3 ? 'high' : 'xhigh'; }
function candidateComparator(preset) { return (left, right) => MODEL_LEVEL[left.level] - MODEL_LEVEL[right.level] || (preset === 'quality' ? right.evaluation_score - left.evaluation_score : COST_RANK[left.cost_class] - COST_RANK[right.cost_class]) || right.evaluation_score - left.evaluation_score || left.adapter.localeCompare(right.adapter) || left.model_id.localeCompare(right.model_id); }
