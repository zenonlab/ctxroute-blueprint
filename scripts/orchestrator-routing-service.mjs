import { dispatchWorker } from './orchestrator-worker.mjs';
import { documentationFreshness, documentationGate, inventoryDocumentationRequirements } from './orchestrator-documentation.mjs';
import { loadOrchestratorConfig, readOrchestratorState } from './orchestrator-core.mjs';
import { modelCatalog, orchestratorModels } from './orchestrator-models.mjs';
import { assessTask, explainRoute, resolveConsumptionPolicy } from './orchestrator-routing-core.mjs';

export { orchestratorModels };

export async function explainOrchestratorRoute(input, root = process.cwd(), environment = process.env) {
  const config = await loadOrchestratorConfig(root);
  const consumption = resolveConsumptionPolicy(input.consumption, { preset: config.modelRouting?.defaultPreset ?? 'balanced', allowed_providers: environment.CTXROUTE_WORKER_RUNTIME === 'fixture' ? ['fixture'] : undefined });
  const assessment = input.assessment ?? assessTask(input, input.facts ?? {});
  const catalog = await modelCatalog(root, environment);
  const phase = input.phase ?? 'work';
  const profile = config.modelRouting?.profiles?.[phase] ?? { minimum_level: 'L1' };
  return explainRoute({ decision_id: input.decision_id ?? `${input.goal_id ?? 'task'}-${phase}-route`, phase, assessment, catalog, consumption, profile, planner_minimum: input.minimum_level ?? null, prior_provider_family: input.prior_provider_family ?? null, remaining_units: input.remaining_units ?? null });
}

export async function orchestratorUsage(goalId, root = process.cwd()) {
  const state = await readOrchestratorState(root);
  const goal = state.goals.find(item => item.goal_id === goalId);
  if (!goal) throw new Error(`unknown goal: ${goalId}`);
  const receipts = goal.execution_receipts ?? goal.missions.flatMap(mission => mission.execution_receipts ?? []);
  const used = receipts.reduce((sum, receipt) => sum + receipt.normalized_units, 0);
  const tokenValues = receipts.flatMap(receipt => [receipt.input_tokens, receipt.output_tokens]).filter(Number.isFinite);
  const knownCosts = receipts.map(receipt => receipt.cost_usd).filter(Number.isFinite);
  return { goal_id: goalId, normalized_units_used: used, normalized_units_remaining: goal.consumption_policy ? Math.max(0, goal.consumption_policy.max_normalized_units - used) : null, tokens_reported: tokenValues.length ? tokenValues.reduce((sum, value) => sum + value, 0) : null, cost_usd: knownCosts.length === receipts.length ? knownCosts.reduce((sum, value) => sum + value, 0) : null, cost_status: knownCosts.length === receipts.length ? 'known' : 'unknown', receipts };
}

export async function refreshOrchestratorDocumentation(request, root = process.cwd(), environment = process.env, dependencies = {}) {
  const config = await loadOrchestratorConfig(root);
  const consumption = resolveConsumptionPolicy(request.consumption, { preset: config.modelRouting?.defaultPreset ?? 'balanced', allowed_providers: environment.CTXROUTE_WORKER_RUNTIME === 'fixture' ? ['fixture'] : undefined });
  const assessment = assessTask(request, request.facts ?? {});
  const requirements = await inventoryDocumentationRequirements(request, root);
  let routing = null;
  if (requirements.length) routing = await explainOrchestratorRoute({ ...request, assessment, phase: 'research', consumption }, root, environment);
  const dispatch = routing?.selected ? options => dispatchWorker({ ...options, routing }, root, environment, dependencies) : null;
  const report = await documentationGate({ request, root, consumption, dispatch });
  return { report, freshness: documentationFreshness(report) };
}

export async function orchestratorModelEvaluations(root = process.cwd()) {
  const state = await readOrchestratorState(root);
  const groups = [];
  for (const receipt of state.goals.flatMap(goal => goal.execution_receipts ?? [])) {
    let item = groups.find(candidate => candidate.model_id === receipt.model_id && candidate.phase === 'work');
    if (!item) { item = { model_id: receipt.model_id, phase: 'work', samples: 0, successes: 0, structured: 0, scope: 0, durations: [] }; groups.push(item); }
    item.samples += 1; item.successes += receipt.outcome === 'success' ? 1 : 0; item.structured += receipt.outcome === 'success' ? 1 : 0; item.scope += receipt.outcome === 'success' ? 1 : 0; item.durations.push(receipt.duration_ms);
  }
  return groups.map(item => ({ model_id: item.model_id, phase: item.phase, samples: item.samples, success_rate: item.successes / item.samples, structured_output_rate: item.structured / item.samples, scope_rate: item.scope / item.samples, median_duration_ms: median(item.durations), updated_at: new Date().toISOString() }));
}

function median(values) { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
