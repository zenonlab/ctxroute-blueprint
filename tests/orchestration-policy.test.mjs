import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptHostDecision } from '../.codex/hooks/host-policy-adapter.mjs';
import { assertWorkerGitCommand, classifyGitCommand } from '../scripts/git-command-policy.mjs';
import { MODE_DESCRIPTORS, OPERATING_MODES, WORKFLOWS, decisionCanResolve, resolveExecutionPolicy } from '../scripts/orchestration-policy-core.mjs';
import { readOrchestratorState, transactOrchestrator } from '../scripts/orchestrator-core.mjs';

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

test('a human decision survives a fresh service call and resumes from its checkpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orchestration-decision-'));
  mkdirSync(join(root, '.project'), { recursive: true });
  writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  let state = (await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Durable decision', requested_mode: 'SWARM', workflow: 'STANDARD', capabilities: ['git'] } }, root)).state;
  const goal = state.goals[0];
  const request = { decision_id: 'decision-one', goal_id: goal.goal_id, policy_digest: goal.policy_digest, category: 'technology', prompt: 'Choose an allowed technology.', allowed_alternatives: ['accept-node', 'reject'], status: 'PENDING', created_at: '2026-09-17T12:00:00Z' };
  const checkpoint = { checkpoint_id: 'checkpoint-one', goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_receipt_ids: [], artifact_refs: ['docs/orchestration.md'], next_stage: 'work', created_at: '2026-09-17T12:00:00Z' };
  state = (await transactOrchestrator({ operation_id: 'decision-request', expected_revision: state.revision, action: 'decision.request', payload: { request, checkpoint } }, root)).state;
  assert.equal(state.goals[0].status, 'WAITING_FOR_USER_DECISION');
  const reloaded = await readOrchestratorState(root);
  const receipt = { receipt_id: 'receipt-one', decision_id: request.decision_id, policy_digest: goal.policy_digest, selection: 'accept-node', resolved_via: 'cli', resolved_at: '2026-09-17T12:01:00Z', subject: 'local-user-unverified' };
  state = (await transactOrchestrator({ operation_id: 'decision-resolve', expected_revision: reloaded.revision, action: 'decision.resolve', payload: { receipt } }, root)).state;
  assert.equal(state.goals[0].status, 'ACTIVE');
  assert.equal(state.goals[0].stage, 'work');
  assert.equal(state.decision_receipts[0].subject, 'local-user-unverified');
});
