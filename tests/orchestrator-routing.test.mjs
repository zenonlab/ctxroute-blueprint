import assert from 'node:assert/strict';
import test from 'node:test';
import { assessTask, explainRoute, resolveConsumptionPolicy, routeTask } from '../scripts/orchestrator-routing-core.mjs';

const policy = resolveConsumptionPolicy({ preset: 'economy', max_duration_ms: 900000, max_normalized_units: 100, max_cost_usd: null, allowed_providers: ['codex', 'claude'], denied_models: [], prefer_local: false, local_only: false });
const catalog = [
  model('codex', 'small-model', 'openai', 'small', 'medium', 'low', 0.8),
  model('claude', 'balanced-model', 'anthropic', 'balanced', 'large', 'medium', 0.9),
  model('codex', 'advanced-model', 'openai', 'advanced', 'xlarge', 'high', 1),
  model('claude', 'critical-model', 'anthropic', 'critical', 'xlarge', 'high', 1),
];

test('mechanical assessment floors risk independently of economy preference', () => {
  assert.equal(assessTask({ goal_id: 'auth-goal', importance: 'normal', change_kind: 'bugfix' }, { risk_signals: ['authentication'], reproducibility: 'reproduced' }).minimum_level, 'L3');
  assert.equal(assessTask({ goal_id: 'incident-goal', importance: 'critical', change_kind: 'incident' }, {}).minimum_level, 'L4');
  assert.equal(assessTask({ goal_id: 'deterministic-goal', importance: 'low', change_kind: 'routine' }, { deterministic: true }).minimum_level, 'L0');
});

test('router chooses the smallest qualified model and explain-route is differential-identical', () => {
  const assessment = assessTask({ goal_id: 'feature-goal', importance: 'normal', change_kind: 'feature' }, { validation_strength: 'strong', context_class: 'small' });
  const input = { decision_id: 'route-one', phase: 'work', assessment, catalog, consumption: policy, profile: { minimum_level: 'L1' } };
  const decision = routeTask(input);
  assert.equal(decision.selected.model_id, 'small-model');
  assert.deepEqual(explainRoute(input), decision);
});

test('context, provider, budget and critical independence eliminate candidates before launch', () => {
  const assessment = assessTask({ goal_id: 'critical-goal', importance: 'critical', change_kind: 'incident' }, { context_class: 'xlarge' });
  const decision = routeTask({ decision_id: 'route-critical', phase: 'goalAudit', assessment, catalog, consumption: policy, profile: { minimum_level: 'L2' }, prior_provider_family: 'anthropic', remaining_units: 100 });
  assert.equal(decision.selected, null);
  assert.ok(decision.rejected.some(item => item.causes.includes('context-insufficient')));
  assert.ok(decision.rejected.some(item => item.causes.includes('independence-required')));
  const exhausted = routeTask({ decision_id: 'route-budget', phase: 'work', assessment: { ...assessment, importance: 'normal', minimum_level: 'L3' }, catalog, consumption: policy, profile: { minimum_level: 'L1' }, remaining_units: 0 });
  assert.equal(exhausted.selected, null);
  assert.ok(exhausted.rejected.every(item => item.causes.includes('budget-exhausted') || item.causes.includes('level-insufficient') || item.causes.includes('context-insufficient')));
});

function model(adapter, model_id, provider_family, level, context_class, cost_class, evaluation_score) {
  return { adapter, model_id, provider_family, level, capabilities: ['code', 'reasoning', 'long-context', 'structured-output', 'web-research'], context_class, cost_class, efforts: ['low', 'medium', 'high', 'xhigh'], access_modes: ['read-only', 'workspace-write'], status: 'available', verified_at: '2026-09-16T00:00:00Z', verification_source: 'https://example.com/official', evaluation_score };
}
