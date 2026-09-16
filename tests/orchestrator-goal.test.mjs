import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { remainingCost, runGoal, validateGoalPlan } from '../scripts/orchestrator-goal.mjs';
import { orchestratorModelEvaluations, orchestratorUsage } from '../scripts/orchestrator-routing-service.mjs';
import { probedModelStatus } from '../scripts/orchestrator-models.mjs';
import { buildWorkerCommand, classifyProviderFailure, dispatchWorker, extractUsage, providerAdapter, workerRuntimeHealth } from '../scripts/orchestrator-worker.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('goal runner plans, launches a real fixture process, integrates, audits, and completes', async () => {
  const root = fixture();
  const result = await runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(result.goal.status, 'COMPLETED');
  assert.equal(result.goal.missions[0].status, 'COMPLETED');
  assert.equal(result.goal.missions[0].integration_status, 'INTEGRATED');
  assert.equal(result.goal.missions[0].worktree_allocation.status, 'REMOVED');
  assert.equal(existsSync(join(root, result.goal.missions[0].worktree_allocation.path)), false);
  assert.equal(existsSync(join(root, 'src/result.mjs')), true);
  assert.match(readFileSync(join(root, 'src/result.mjs'), 'utf8'), /orchestrated/u);
  assert.ok(existsSync(join(root, '.ctxroute/reports/goal-one-plan.json')));
  assert.ok(existsSync(join(root, '.ctxroute/reports/goal-one-acceptance.json')));
  assert.deepEqual(result.goal.execution_receipts.map(receipt => receipt.phase), ['planning', 'work', 'goalAudit']);
  const usage = await orchestratorUsage('goal-one', root);
  assert.equal(usage.normalized_units_used, 3);
  assert.equal(usage.cost_status, 'unknown');
  const evaluations = await orchestratorModelEvaluations(root);
  assert.deepEqual(evaluations.map(item => item.phase).sort(), ['goalAudit', 'planning', 'work']);
  assert.ok(evaluations.every(item => item.confidence === 'insufficient-samples' && item.promotion_eligible === false));
  assert.doesNotMatch(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), /src\/result/u);
});

test('independent fixture missions execute through separate worker processes and integrate serially', async () => {
  const root = fixture();
  const goal = request();
  goal.acceptance_criteria.push('Second file is integrated.');
  goal.suggested_paths.push('src/second.mjs');
  const result = await runGoal(goal, root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_SCENARIO: 'parallel' });
  assert.equal(result.goal.status, 'COMPLETED', result.error);
  assert.equal(result.goal.missions.filter(item => item.status === 'COMPLETED').length, 2);
  assert.equal(existsSync(join(root, 'src/second.mjs')), true);
});

test('external adaptive goals refresh official evidence before each volatile dispatch', async () => {
  const root = fixture();
  const goal = request();
  goal.objective = 'Update the module for the current external SDK API.';
  const result = await runGoal(goal, root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(result.goal.status, 'COMPLETED', result.error);
  assert.equal(result.goal.documentation_evidence.status, 'SATISFIED');
  assert.equal(result.goal.missions[0].documentation_freshness.status, 'CURRENT');
  assert.equal(result.goal.missions[0].documentation_freshness.dispatch_id, 'goal-one-mission-1-work');
});

test('external workers and final audits must cite the current documentation ledger', async () => {
  const root = fixture();
  const goal = request();
  goal.objective = 'Update the module for the current external SDK API.';
  const result = await runGoal(goal, root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_OMIT_CITATIONS: '1' });
  assert.equal(result.goal.status, 'BLOCKED');
  assert.equal(result.goal.blocked_cause, 'DOCUMENTATION_CITATION_REQUIRED');
});

test('normalized budgets include planning and reserve every bounded work attempt', async () => {
  const root = fixture();
  const goal = request();
  goal.consumption = { preset: 'balanced', max_duration_ms: 900000, max_normalized_units: 2, max_cost_usd: null, allowed_providers: ['fixture'], denied_models: [], prefer_local: false, local_only: false };
  const result = await runGoal(goal, root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(result.goal.status, 'BLOCKED');
  assert.equal(result.goal.blocked_cause, 'BUDGET_EXHAUSTED');
  assert.deepEqual(result.goal.execution_receipts.map(receipt => receipt.phase), ['planning']);
  assert.equal(existsSync(join(root, 'src/result.mjs')), false);
});

test('USD budgets subtract reported Claude spend and fail closed on unknown Claude cost', () => {
  const policy = { max_cost_usd: 5 };
  assert.equal(remainingCost(policy, [{ adapter: 'claude', cost_usd: 1.25 }, { adapter: 'codex', cost_usd: null }]), 3.75);
  assert.equal(remainingCost(policy, [{ adapter: 'claude', cost_usd: null }]), 0);
  assert.equal(remainingCost({ max_cost_usd: null }, []), null);
});

test('large goal audits execute non-overlapping shards followed by synthesis', async () => {
  const root = fixture();
  const configPath = join(root, '.project/orchestrator-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.modelRouting.profiles.goalAudit.max_context_bytes = 1024;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const goal = request();
  goal.acceptance_criteria.push('Second file is integrated.');
  goal.suggested_paths.push('src/second.mjs');
  const result = await runGoal(goal, root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_SCENARIO: 'audit-shards' });
  assert.equal(result.goal.status, 'COMPLETED', result.error);
  assert.ok(existsSync(join(root, '.ctxroute/reports/goal-one-acceptance-initial-audit-shard-1.json')));
  assert.ok(existsSync(join(root, '.ctxroute/reports/goal-one-acceptance-initial-audit-shard-2.json')));
  assert.ok(existsSync(join(root, '.ctxroute/reports/goal-one-acceptance-initial-synthesis.json')));
});

test('local-only external goals and critical goals without an independent auditor fail closed', async () => {
  const localRoot = fixture();
  const external = request();
  external.objective = 'Use the current external API.';
  external.consumption = { preset: 'balanced', max_duration_ms: 900000, max_normalized_units: 100, max_cost_usd: null, allowed_providers: ['fixture'], denied_models: [], prefer_local: false, local_only: true };
  const blockedDocumentation = await runGoal(external, localRoot, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(blockedDocumentation.goal.status, 'BLOCKED');
  assert.equal(blockedDocumentation.goal.blocked_cause, 'FRESH_DOCUMENTATION_UNAVAILABLE');
  assert.equal(blockedDocumentation.goal.missions.length, 0);

  const criticalRoot = fixture();
  const critical = request();
  critical.importance = 'critical';
  const blockedAudit = await runGoal(critical, criticalRoot, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(blockedAudit.goal.status, 'BLOCKED');
  assert.equal(blockedAudit.goal.blocked_cause, 'INDEPENDENT_AUDITOR_UNAVAILABLE');
});

test('a fixture crash after mutation blocks the mission and preserves its dirty worktree', async () => {
  const root = fixture();
  const result = await runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_SCENARIO: 'crash-after-change' });
  assert.equal(result.goal.status, 'BLOCKED');
  assert.equal(result.goal.missions[0].status, 'BLOCKED');
  assert.ok(result.goal.execution_receipts.some(receipt => receipt.phase === 'work' && receipt.outcome === 'failed'));
  assert.equal(existsSync(join(root, result.goal.missions[0].worktree_allocation.path, 'src/result.mjs')), true);
});

test('a missing skill preserves the original mission and completes the creator-audit-register-resume saga', async () => {
  const root = fixture();
  const result = await runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_MISSING_SKILL: 'new-domain-skill' });
  assert.equal(result.goal.status, 'COMPLETED', result.error);
  const original = result.goal.missions.find(item => item.mission_id === 'goal-one-mission-1');
  const creator = result.goal.missions.find(item => item.mission_id === 'goal-one-mission-1-skill');
  assert.equal(original.skill_id, 'new-domain-skill');
  assert.equal(original.status, 'COMPLETED');
  assert.equal(creator.status, 'COMPLETED');
  assert.equal(existsSync(join(root, '.agents/skills/new-domain-skill/SKILL.md')), true);
  assert.ok(result.state.skills.some(item => item.skill_id === 'new-domain-skill'));
  assert.ok(result.state.audits.some(item => item.decision === 'accept'));
});

test('skill audit repair reruns skill-creator in the same worktree before acceptance', async () => {
  const root = fixture();
  const result = await runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_MISSING_SKILL: 'repairable-skill', CTXROUTE_FIXTURE_SCENARIO: 'repair-once' });
  assert.equal(result.goal.status, 'COMPLETED', result.error);
  assert.match(readFileSync(join(root, '.agents/skills/repairable-skill/SKILL.md'), 'utf8'), /repair-pass/u);
  assert.ok(result.state.audits.some(item => item.decision === 'repair'));
  assert.ok(result.state.audits.some(item => item.decision === 'accept'));
});

test('goal plan semantics reject overlap, cycles, and coverage gaps before durable state', () => {
  const goal = request();
  const mission = plannedMission('one', 'src/');
  const overlapping = { goal_id: goal.goal_id, missions: [mission, plannedMission('two', 'src/nested/')], criterion_coverage: [{ criterion_id: 'criterion-1', mission_ids: ['one'] }] };
  assert.throws(() => validateGoalPlan(overlapping, goal), /overlapping/u);
  const cycle = { goal_id: goal.goal_id, missions: [{ ...mission, dependencies: ['two'] }, { ...plannedMission('two', 'other/'), dependencies: ['one'] }], criterion_coverage: [{ criterion_id: 'criterion-1', mission_ids: ['one'] }] };
  assert.throws(() => validateGoalPlan(cycle, goal), /cycle/u);
  assert.throws(() => validateGoalPlan({ goal_id: goal.goal_id, missions: [mission], criterion_coverage: [{ criterion_id: 'criterion-2', mission_ids: ['one'] }] }, goal), /cover/u);
});

test('Codex and Claude commands are closed, ephemeral, sandboxed, and non-bypassing', () => {
  const schema = join(repositoryRoot, '.project/schemas/orchestrator/worker-report.schema.json');
  const codex = buildWorkerCommand('codex', 'work', repositoryRoot, schema, 'bounded prompt', repositoryRoot);
  assert.equal(codex.executable, 'codex');
  assert.deepEqual(codex.args.slice(0, 6), ['exec', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '--ephemeral']);
  assert.ok(codex.args.includes('--output-schema'));
  assert.ok(!codex.args.some(item => /dangerously|bypass/u.test(item)));
  const claude = buildWorkerCommand('claude', 'audit', repositoryRoot, schema, 'bounded prompt', repositoryRoot);
  assert.equal(claude.executable, 'claude');
  assert.ok(claude.args.includes('dontAsk'));
  assert.ok(claude.args.includes('--no-session-persistence'));
  assert.ok(!claude.args.some(item => /bypassPermissions|dangerously/u.test(item)));
});

test('adaptive adapter commands carry model, effort and budgets without permission bypasses', () => {
  const schema = join(repositoryRoot, '.project/schemas/orchestrator/worker-report.schema.json');
  const route = { phase: 'work', selected: { adapter: 'codex', model_id: 'model-one', provider_family: 'openai', normalized_units: 2 }, effort: 'high' };
  const codex = buildWorkerCommand('codex', 'research', repositoryRoot, schema, 'bounded prompt', repositoryRoot, route);
  assert.ok(codex.args.includes('model-one'));
  assert.ok(codex.args.includes('model_reasoning_effort="high"'));
  assert.ok(codex.args.includes('--search'));
  const claude = buildWorkerCommand('claude', 'work', repositoryRoot, schema, 'bounded prompt', repositoryRoot, { ...route, selected: { ...route.selected, adapter: 'claude' } }, { max_cost_usd: 2, fallback_model: 'fallback-one' });
  assert.ok(claude.args.includes('--max-budget-usd'));
  assert.ok(claude.args.includes('--fallback-model'));
  const gemini = buildWorkerCommand('gemini', 'work', repositoryRoot, schema, 'bounded prompt', repositoryRoot, { ...route, selected: { ...route.selected, adapter: 'gemini' } });
  assert.ok(gemini.args.includes('--output-format'));
  assert.ok(gemini.args.includes('--sandbox'));
  assert.ok(gemini.args.includes('auto_edit'));
  assert.ok(!gemini.args.some(item => /yolo/iu.test(item)));
  assert.throws(() => providerAdapter('/tmp/arbitrary'), /unsupported/u);
});

test('provider failures and Gemini metrics remain categorical and bounded', () => {
  assert.equal(classifyProviderFailure('401 authentication required'), 'PROVIDER_AUTH');
  assert.equal(classifyProviderFailure('quota exceeded'), 'PROVIDER_QUOTA');
  assert.equal(classifyProviderFailure('unknown model'), 'PROVIDER_MODEL_UNKNOWN');
  const usage = extractUsage('gemini', JSON.stringify({ stats: { models: { one: { tokens: { prompt: 3, candidates: 2, total: 5 } } }, tools: { totalCalls: 1 } } }));
  assert.deepEqual(usage, { input_tokens: 3, output_tokens: 2, total_tokens: 5, tool_calls: 1, cost_usd: null });
});

test('worker health exposes availability without executable paths', async () => {
  const health = await workerRuntimeHealth(repositoryRoot, { PATH: process.env.PATH, CTXROUTE_WORKER_RUNTIME: 'fixture' });
  assert.equal(health.selected, 'fixture');
  assert.equal(health.available, true);
  assert.equal(JSON.stringify(health).includes('/Users/'), false);
});

test('an executable probe never promotes an unverified model', () => {
  assert.equal(probedModelStatus('unverified', true), 'unverified');
  assert.equal(probedModelStatus('degraded', true), 'degraded');
  assert.equal(probedModelStatus('available', false), 'unavailable');
});

test('fixture planner crash and invalid JSON leave no durable goal', async () => {
  for (const scenario of ['crash', 'invalid-json']) {
    const root = fixture();
    await assert.rejects(() => runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_SCENARIO: scenario }), /worker exited|JSON/u);
    assert.equal(existsSync(join(root, '.ctxroute/orchestrator/state.json')), false);
  }
});

test('fixture timeout is bounded and leaves no durable goal', async () => {
  const root = fixture({ workerTimeoutMs: 1000 });
  await assert.rejects(() => runGoal(request(), root, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'fixture', CTXROUTE_FIXTURE_SCENARIO: 'timeout' }), /timeout/u);
  assert.equal(existsSync(join(root, '.ctxroute/orchestrator/state.json')), false);
});

test('optional authenticated Codex smoke', { skip: process.env.CTXROUTE_RUN_CODEX_SMOKE !== '1' }, async () => {
  const result = await dispatchWorker({ dispatch_id: 'codex-smoke', phase: 'plan', mission: request(), skill_path: '.agents/skills/goal-planner/SKILL.md', output_contract: 'goal-plan', worktree: '.' }, repositoryRoot, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'codex' });
  assert.equal(result.report.goal_id, 'goal-one');
});

test('optional authenticated Claude smoke', { skip: process.env.CTXROUTE_RUN_CLAUDE_SMOKE !== '1' }, async () => {
  const result = await dispatchWorker({ dispatch_id: 'claude-smoke', phase: 'plan', mission: request(), skill_path: '.agents/skills/goal-planner/SKILL.md', output_contract: 'goal-plan', worktree: '.' }, repositoryRoot, { ...process.env, CTXROUTE_WORKER_RUNTIME: 'claude' });
  assert.equal(result.report.goal_id, 'goal-one');
});

function request() { return { goal_id: 'goal-one', title: 'Integrate a bounded change', objective: 'Create one valid module through the autonomous local chain.', acceptance_criteria: ['The module exists on the main checkout.'], suggested_paths: ['src/result.mjs'], expected_revision: 0 }; }
function plannedMission(id, scope) { return { mission_id: id, skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', skill_path: '.agents/skills/blueprint-audit/SKILL.md', objective: 'Change scoped files.', dependencies: [], acceptance_criteria: ['criterion-1'], file_scope: [scope], acceptance: ['Change is integrated.'], validations: [{ id: 'check', executable: 'git', args: ['diff', '--check'], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' }; }
function fixture(limitOverrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-goal-'));
  mkdirSync(join(root, '.project'), { recursive: true });
  const config = JSON.parse(readFileSync(join(repositoryRoot, '.project/orchestrator-config.json'), 'utf8'));
  Object.assign(config.limits, limitOverrides);
  writeFileSync(join(root, '.project/orchestrator-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  for (const skill of ['blueprint-audit', 'goal-auditor', 'goal-planner', 'skill-creator']) {
    mkdirSync(join(root, '.agents/skills', skill), { recursive: true });
    writeFileSync(join(root, '.agents/skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: Fixture ${skill}.\n---\n`);
  }
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n');
  git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'chore: fixture']);
  return root;
}
function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); }
