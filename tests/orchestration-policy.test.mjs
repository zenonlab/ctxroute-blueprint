import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptHostDecision } from '../.codex/hooks/host-policy-adapter.mjs';
import { assertWorkerGitCommand, classifyGitCommand } from '../scripts/git-command-policy.mjs';
import { MODE_DESCRIPTORS, OPERATING_MODES, WORKFLOWS, decisionCanResolve, policyDigest, resolveExecutionPolicy } from '../scripts/orchestration-policy-core.mjs';
import { readOrchestratorState, transactOrchestrator } from '../scripts/orchestrator-core.mjs';
import { writePolicySnapshot } from '../scripts/orchestrator-policy-snapshot.mjs';
import { resolvedPolicyDecision } from '../.codex/hooks/resolved-policy.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('every mode and workflow resolves deterministically with monotone restrictions', () => {
  for (const requested_mode of OPERATING_MODES) for (const workflow of WORKFLOWS) {
    const input = { requested_mode, workflow, capabilities: ['git'], file_scopes: ['src/', 'tests/'] };
    const first = resolveExecutionPolicy(input);
    assert.deepEqual(resolveExecutionPolicy(structuredClone(input)), first);
    assert.equal(first.resolution_status, 'RESOLVED');
    assert.equal(first.repository_mutation_serialized, true);
    const restricted = resolveExecutionPolicy({ ...input, constraints: [{ permissions: ['read'], write_allowed: false, parallel_limit: 1 }] });
    assert.equal(restricted.write_allowed, false);
    assert.ok(restricted.parallel_limit <= first.parallel_limit);
    assert.deepEqual(restricted.permissions, ['read']);
    if (['RESEARCH', 'AUDIT'].includes(workflow)) assert.ok(restricted.stages.every(stage => stage.access === 'read-only'));
  }
});

test('resolver distinguishes decisions, capabilities, and contradictions', () => {
  assert.equal(resolveExecutionPolicy({ requested_mode: 'SWARM', capabilities: [], workflow: 'STANDARD' }).resolution_status, 'WAITING_FOR_CAPABILITY');
  assert.equal(resolveExecutionPolicy({ requested_mode: 'SWARM', capabilities: ['git'], workflow: 'STANDARD', user_decision_required: true, user_alternatives: ['SOLO'] }).resolution_status, 'WAITING_FOR_USER_DECISION');
  assert.equal(resolveExecutionPolicy({ requested_mode: 'SWARM', capabilities: ['git'], workflow: 'AUDIT', require_write: true }).resolution_status, 'POLICY_UNSATISFIABLE');
  assert.equal(resolveExecutionPolicy({ requested_mode: 'SWARM', capabilities: ['git'], parallel_git_mutations: true }).resolution_status, 'POLICY_UNSATISFIABLE');
});

test('decision receipts select only a declared alternative at the frozen digest', () => {
  const request = { decision_id: 'decision-one', policy_digest: 'a'.repeat(64), allowed_alternatives: ['promote', 'reject'] };
  assert.equal(decisionCanResolve(request, { decision_id: 'decision-one', policy_digest: request.policy_digest, selection: 'promote' }), true);
  assert.equal(decisionCanResolve(request, { decision_id: 'decision-one', policy_digest: 'b'.repeat(64), selection: 'promote' }), false);
  assert.equal(decisionCanResolve({ ...request, allowed_alternatives: ['disable-isolation'] }, { decision_id: 'decision-one', policy_digest: request.policy_digest, selection: 'disable-isolation' }), false);
});

test('workers receive a deterministic read-only Git allowlist', () => {
  for (const command of ['add', 'commit', 'branch', 'switch', 'checkout', 'merge', 'rebase', 'reset', 'tag', 'update-ref', 'worktree', 'fetch', 'pull', 'push', 'gc', 'repack']) {
    assert.equal(classifyGitCommand(['git', command]).allowed_for_worker, false, command);
    assert.throws(() => assertWorkerGitCommand(['git', command]), /forbidden/u);
  }
  for (const command of ['status', 'diff', 'log', 'show', 'rev-parse']) assert.equal(classifyGitCommand(['git', command]).allowed_for_worker, true, command);
  assert.equal(classifyGitCommand('git status && git commit -m hidden').allowed_for_worker, false);
});

test('Claude and Codex blocking adapters never mix JSON with exit 2', () => {
  const decision = { kind: 'block', mode: 'SWARM', workflow: 'STANDARD', stage: 'work', policy_digest: 'a'.repeat(64), cause: 'WORKER_GIT_MUTATION_FORBIDDEN', invariant: 'workers are read-only', recovery: 'orchestrator_explain_execution' };
  for (const host of ['claude', 'codex']) {
    const result = adaptHostDecision(host, 'PreToolUse', decision);
    assert.equal(result.exitCode, 0);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.equal(result.stderr, '');
  }
  const failure = adaptHostDecision('claude', 'PreToolUse', { kind: 'failure', diagnostic: 'broken snapshot' });
  assert.equal(failure.exitCode, 2);
  assert.equal(failure.stdout, '');
  assert.match(failure.stderr, /broken snapshot/u);
});

test('mode descriptors remain closed and canonical', () => {
  assert.deepEqual(Object.keys(MODE_DESCRIPTORS), OPERATING_MODES);
});

test('a global mode change never rewrites an active goal frozen policy', async () => {
  const root = policyFixture();
  let state = (await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Frozen policy', requested_mode: 'SWARM', workflow: 'STANDARD', capabilities: ['git'] } }, root)).state;
  const frozen = structuredClone(state.goals[0].resolved_policy);
  state = (await transactOrchestrator({ operation_id: 'mode-change', expected_revision: state.revision, action: 'operating-mode.set', payload: { mode: 'DIRECT' } }, root)).state;
  assert.equal(state.mode, 'DIRECT');
  assert.deepEqual(state.goals[0].resolved_policy, frozen);
  assert.equal(state.goals[0].policy_digest, frozen.policy_digest);
});

test('policy rebase cannot remove a frozen mechanical invariant', async () => {
  const root = policyFixture();
  let state = (await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Frozen policy', requested_mode: 'SWARM', workflow: 'STANDARD', capabilities: ['git'] } }, root)).state;
  const goal = state.goals[0];
  const checkpoint = { checkpoint_id: 'checkpoint-one', goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage: 'inventory', completed_receipt_ids: [], artifact_refs: [], next_stage: 'planning', created_at: '2026-09-17T12:00:00Z' };
  state = (await transactOrchestrator({ operation_id: 'stage-advance', expected_revision: state.revision, action: 'goal.stage.advance', payload: { goal_id: goal.goal_id, checkpoint } }, root)).state;
  const weakenedBody = { ...state.goals[0].resolved_policy };
  delete weakenedBody.policy_digest;
  const weakened = { ...weakenedBody, repository_mutation_serialized: false };
  weakened.policy_digest = policyDigest(weakened);
  await assert.rejects(() => transactOrchestrator({ operation_id: 'unsafe-rebase', expected_revision: state.revision, action: 'goal.policy.rebase', payload: { goal_id: goal.goal_id, checkpoint_id: checkpoint.checkpoint_id, expected_policy_digest: goal.policy_digest, policy: weakened } }, root), /cannot weaken repository mutation serialization/u);
});

test('hook policy uses last-valid then blocks only mutations when configuration is unverifiable', async () => {
  const root = policyFixture();
  const policy = resolveExecutionPolicy({ requested_mode: 'SWARM', workflow: 'STANDARD', capabilities: ['git'] });
  const snapshot = join(root, '.ctxroute/orchestrator/policy.json');
  await writePolicySnapshot(policy, snapshot, { id: () => 'snapshot' });
  writeFileSync(snapshot, '{corrupt');
  const fallback = await resolvedPolicyDecision({ tool_name: 'apply_patch' }, root, {});
  assert.equal(fallback.source, 'last-valid');
  assert.equal(fallback.decision, null);
  writeFileSync(join(root, '.project/orchestrator-config.json'), '{broken');
  const blocked = await resolvedPolicyDecision({ tool_name: 'apply_patch' }, root, {});
  assert.equal(blocked.decision.cause, 'POLICY_CONFIG_INVALID');
  const readOnly = await resolvedPolicyDecision({ tool_name: 'Read' }, root, {});
  assert.equal(readOnly.decision, null);
});

test('an experiment remains unintegrable until a durable promotion decision is consumed', async () => {
  const root = policyFixture();
  let state = (await transactOrchestrator({ operation_id: 'experiment-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'experiment-one', title: 'Bounded experiment', requested_mode: 'SWARM', workflow: 'EXPERIMENT', capabilities: ['git'] } }, root)).state;
  const advance = async (operation_id, completed_stage, next_stage, experiment_receipt) => {
    const goal = state.goals[0];
    const checkpoint = { checkpoint_id: `${operation_id}-checkpoint`, goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage, completed_receipt_ids: [], artifact_refs: [], next_stage, created_at: '2026-09-17T12:00:00Z' };
    const payload = { goal_id: goal.goal_id, checkpoint };
    if (experiment_receipt) payload.experiment_receipt = experiment_receipt;
    state = (await transactOrchestrator({ operation_id, expected_revision: state.revision, action: 'goal.stage.advance', payload }, root)).state;
  };
  await advance('experiment-plan', 'inventory', 'planning');
  await advance('experiment-work', 'planning', 'work');
  await advance('experiment-validation', 'work', 'validation');
  const goal = state.goals[0];
  const experimentReceipt = { receipt_id: 'experiment-receipt', goal_id: goal.goal_id, policy_digest: goal.policy_digest, worktree: '.ctxroute/worktrees/experiment-one', status: 'READY_FOR_PROMOTION', evidence_refs: [], created_at: '2026-09-17T12:01:00Z' };
  await advance('experiment-ready', 'validation', 'promotion', experimentReceipt);
  assert.equal(state.goals[0].status, 'READY_FOR_PROMOTION');
  await assert.rejects(() => transactOrchestrator({ operation_id: 'premature-promotion', expected_revision: state.revision, action: 'experiment.promote', payload: { goal_id: goal.goal_id, decision_receipt_id: 'missing' } }, root), /matching decision receipt/u);
  state = await readOrchestratorState(root);
  const checkpoint = { checkpoint_id: 'promotion-checkpoint', goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage: 'promotion', completed_receipt_ids: [experimentReceipt.receipt_id], artifact_refs: [], next_stage: 'integration', created_at: '2026-09-17T12:02:00Z' };
  const request = { decision_id: 'promotion-decision', goal_id: goal.goal_id, checkpoint_id: checkpoint.checkpoint_id, policy_digest: goal.policy_digest, category: 'promotion', prompt: 'Promote this experiment?', allowed_alternatives: ['promote', 'reject'], status: 'PENDING', created_at: '2026-09-17T12:02:00Z' };
  state = (await transactOrchestrator({ operation_id: 'promotion-request', expected_revision: state.revision, action: 'decision.request', payload: { request, checkpoint } }, root)).state;
  const receipt = { receipt_id: 'promotion-receipt', decision_id: request.decision_id, policy_digest: goal.policy_digest, selection: 'promote', resolved_via: 'cli', resolved_at: '2026-09-17T12:03:00Z', subject: 'local-user-unverified' };
  state = (await transactOrchestrator({ operation_id: 'promotion-resolve', expected_revision: state.revision, action: 'decision.resolve', payload: { receipt } }, root)).state;
  assert.equal(state.goals[0].status, 'READY_FOR_PROMOTION');
  state = (await transactOrchestrator({ operation_id: 'promotion-consume', expected_revision: state.revision, action: 'experiment.promote', payload: { goal_id: goal.goal_id, decision_receipt_id: receipt.receipt_id } }, root)).state;
  assert.equal(state.goals[0].stage, 'integration');
  assert.equal(state.goals[0].status, 'ACTIVE');
});

test('a human decision survives a fresh service call and resumes from its checkpoint', async () => {
  const root = policyFixture();
  let state = (await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Durable decision', requested_mode: 'SWARM', workflow: 'STANDARD', capabilities: ['git'] } }, root)).state;
  const goal = state.goals[0];
  const request = { decision_id: 'decision-one', goal_id: goal.goal_id, checkpoint_id: 'checkpoint-one', policy_digest: goal.policy_digest, category: 'technology', prompt: 'Choose an allowed technology.', allowed_alternatives: ['accept-node', 'reject'], status: 'PENDING', created_at: '2026-09-17T12:00:00Z' };
  const checkpoint = { checkpoint_id: 'checkpoint-one', goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage: 'inventory', completed_receipt_ids: [], artifact_refs: ['docs/orchestration.md'], next_stage: 'planning', created_at: '2026-09-17T12:00:00Z' };
  state = (await transactOrchestrator({ operation_id: 'decision-request', expected_revision: state.revision, action: 'decision.request', payload: { request, checkpoint } }, root)).state;
  assert.equal(state.goals[0].status, 'WAITING_FOR_USER_DECISION');
  const reloaded = await readOrchestratorState(root);
  const receipt = { receipt_id: 'receipt-one', decision_id: request.decision_id, policy_digest: goal.policy_digest, selection: 'accept-node', resolved_via: 'cli', resolved_at: '2026-09-17T12:01:00Z', subject: 'local-user-unverified' };
  state = (await transactOrchestrator({ operation_id: 'decision-resolve', expected_revision: reloaded.revision, action: 'decision.resolve', payload: { receipt } }, root)).state;
  assert.equal(state.goals[0].status, 'ACTIVE');
  assert.equal(state.goals[0].stage, 'planning');
  assert.equal(state.decision_receipts[0].subject, 'local-user-unverified');
});

function policyFixture() {
  const root = mkdtempSync(join(tmpdir(), 'orchestration-policy-'));
  mkdirSync(join(root, '.project'), { recursive: true });
  writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  return root;
}
