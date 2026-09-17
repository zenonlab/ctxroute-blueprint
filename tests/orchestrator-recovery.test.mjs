import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureOrchestratorState, readOrchestratorState, transactOrchestrator } from '../scripts/orchestrator-core.mjs';
import { emitDecisionEvent } from '../scripts/orchestrator-telemetry.mjs';
import { commitMission, prepareMission, submitWorkerReport } from '../scripts/orchestrator-service.mjs';
import { bootstrapOrchestrator } from '../scripts/orchestrator-bootstrap.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('a crash after physical worktree creation leaves PENDING intent and replay converges', async () => {
  const root = fixture();
  const goal = await createGoalAtWork(root);
  let crashed = false;
  const fault = point => {
    if (point === 'afterWorktreeCreate' && !crashed) { crashed = true; const error = new Error('simulated process crash'); error.simulatedCrash = true; throw error; }
  };
  await assert.rejects(() => prepareMission(missionCommand(goal.state.revision), root, {}, { fault }), /simulated process crash/u);
  let state = await readOrchestratorState(root);
  assert.equal(state.transactions.at(-1).status, 'PENDING');
  assert.equal(state.goals[0].missions[0].status, 'PREPARING');
  const replay = await prepareMission(missionCommand(goal.state.revision), root, {}, { fault });
  assert.equal(replay.state.transactions.at(-1).status, 'COMPLETED');
  assert.equal(replay.state.goals[0].missions[0].status, 'ASSIGNED');
});

test('low disk blocks allocation after durable intent and before Git effect', async () => {
  const root = fixture();
  const goal = await createGoalAtWork(root);
  await assert.rejects(() => prepareMission(missionCommand(goal.state.revision), root, {}, { statfs: async () => ({ bavail: 1, bsize: 1 }) }), /free space/u);
  const state = await readOrchestratorState(root);
  assert.equal(state.transactions.at(-1).status, 'BLOCKED');
  assert.equal(state.transactions.at(-1).cause, 'INSUFFICIENT_SPACE');
  assert.equal(state.goals[0].missions[0].status, 'BLOCKED');
});

test('telemetry failure never corrupts authoritative state', async () => {
  const root = fixture(false);
  const result = await transactOrchestrator(goalCommand(), root, { emitTelemetry: async () => { throw new Error('disk unavailable'); } });
  assert.equal(result.state.goals[0].goal_id, 'goal-one');
  assert.equal((await readOrchestratorState(root)).revision, 2);
});

test('decision telemetry rotates by bytes and stores only its closed event contract', async () => {
  const root = fixture(false);
  const config = { telemetryPath: '.ctxroute/orchestrator/events.jsonl', telemetryBytes: 700 };
  const base = { event_type: 'TRANSACTION', revision_before: 0, revision_after: 1, entity_type: 'transaction', result: 'SUCCESS' };
  await emitDecisionEvent(root, config, { ...base, sequence: 1, operation_id: 'operation-one' }, { id: () => 'one', now: () => new Date('2026-09-06T10:00:00.000Z') });
  await emitDecisionEvent(root, config, { ...base, sequence: 2, operation_id: 'operation-two' }, { id: () => 'two', now: () => new Date('2026-09-06T10:00:01.000Z') });
  const eventPath = join(root, '.ctxroute/orchestrator/events.jsonl');
  assert.ok(statSync(eventPath).mode & 0o600);
  const combined = `${readFileSync(`${eventPath}.1`, 'utf8')}${readFileSync(eventPath, 'utf8')}`;
  assert.doesNotMatch(combined, /environment|stdout|conversation|prompt/u);
  assert.match(combined, /"sequence":1/u);
  assert.match(combined, /"sequence":2/u);
  assert.doesNotMatch(combined, /schemaVersion/u);
  assert.match(combined, /"policy_id":"orchestrator"/u);
});

test('bootstrap is idempotent and resumes a real SIGKILL after durable state intent', { skip: process.platform === 'win32' }, async () => {
  const root = fixture(false);
  await ensureOrchestratorState(root);
  const modulePath = join(repositoryRoot, 'scripts/orchestrator-core.mjs');
  const source = `import { transactOrchestrator } from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; const command=JSON.parse(process.argv[1]); await transactOrchestrator(command, process.argv[2], { fault(point) { if (point === 'afterStateRename') process.kill(process.pid, 'SIGKILL'); } });`;
  const killed = await runNode(['--input-type=module', '-e', source, JSON.stringify(goalCommand()), root]);
  assert.equal(killed.signal, 'SIGKILL');
  const first = await bootstrapOrchestrator(root);
  assert.equal(first.changed, true);
  assert.equal((await readOrchestratorState(root)).goals[0].goal_id, 'goal-one');
  const before = readFileSync(join(root, '.ctxroute/orchestrator/state.json'), 'utf8');
  const second = await bootstrapOrchestrator(root);
  assert.equal(second.changed, false);
  assert.equal(readFileSync(join(root, '.ctxroute/orchestrator/state.json'), 'utf8'), before);
});

test('bootstrap resumes a real SIGKILL after physical worktree allocation', { skip: process.platform === 'win32' }, async () => {
  const root = fixture(true);
  const goal = await createGoalAtWork(root);
  const modulePath = join(repositoryRoot, 'scripts/orchestrator-service.mjs');
  const source = `import { prepareMission } from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; const command=JSON.parse(process.argv[1]); await prepareMission(command, process.argv[2], {}, { fault(point) { if (point === 'afterWorktreeCreate') process.kill(process.pid, 'SIGKILL'); } });`;
  const killed = await runNode(['--input-type=module', '-e', source, JSON.stringify(missionCommand(goal.state.revision)), root]);
  assert.equal(killed.signal, 'SIGKILL');
  const report = await bootstrapOrchestrator(root);
  assert.notEqual(report.status, 'BLOCKED');
  const mission = (await readOrchestratorState(root)).goals[0].missions[0];
  assert.equal(mission.status, 'ASSIGNED');
  assert.equal(existsSync(join(root, mission.worktree_allocation.path)), true);
});

test('bootstrap resumes a real SIGKILL after a planned clean reconciliation removal', { skip: process.platform === 'win32' }, async () => {
  const root = fixture(true);
  let state = (await createGoalAtWork(root)).state;
  const prepared = await prepareMission(missionCommand(state.revision), root);
  state = (await transactOrchestrator({ operation_id: 'cancel-before-reconcile', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'CANCELLED' } }, root)).state;
  const command = { operation_id: 'reconcile-after-kill', expected_revision: state.revision, action: 'worktree.reconcile', payload: { repair: true } };
  const modulePath = join(repositoryRoot, 'scripts/orchestrator-service.mjs');
  const source = `import { reconcileWorktrees } from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; const command=JSON.parse(process.argv[1]); await reconcileWorktrees(command, process.argv[2], {}, { fault(point) { if (point === 'afterWorktreeRemove') process.kill(process.pid, 'SIGKILL'); } });`;
  const killed = await runNode(['--input-type=module', '-e', source, JSON.stringify(command), root]);
  assert.equal(killed.signal, 'SIGKILL');
  await bootstrapOrchestrator(root);
  state = await readOrchestratorState(root);
  assert.equal(state.transactions.find(item => item.operation_id === command.operation_id).status, 'COMPLETED');
  assert.equal(state.goals[0].missions[0].worktree_allocation.status, 'REMOVED');
});

test('two Node processes serialize mutations and one observes a real revision conflict', async () => {
  const root = fixture(false);
  await ensureOrchestratorState(root);
  const firstPath = join(root, 'first.json');
  const secondPath = join(root, 'second.json');
  writeFileSync(firstPath, JSON.stringify(goalCommand()));
  writeFileSync(secondPath, JSON.stringify({ operation_id: 'goal-create-two', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-two', title: 'Second' } }));
  const [first, second] = await Promise.all([runCli(root, firstPath), runCli(root, secondPath)]);
  assert.deepEqual([first.code, second.code].sort(), [0, 1]);
  assert.match(`${first.stderr}${second.stderr}`, /revision conflict/u);
  assert.equal((await readOrchestratorState(root)).goals.length, 1);
});

test('reconciliation serializes against every shared Git effect in separate processes', async t => {
  await t.test('allocation', async () => {
    const root = fixture(true);
    const state = (await createGoalAtWork(root)).state;
    await assertSerializedRace(root, 'prepare-mission', missionCommand(state.revision), state.revision, 'allocation');
  });

  await t.test('commit', async () => {
    const { root, state } = await completedMissionFixture();
    const command = { operation_id: 'commit-race', expected_revision: state.revision, action: 'mission.commit', payload: { goal_id: 'goal-one', mission_id: 'mission-one', message: 'test: serialize commit race' } };
    await assertSerializedRace(root, 'commit-mission', command, state.revision, 'commit');
  });

  await t.test('integration', async () => {
    const prepared = await completedMissionFixture();
    const committed = await commitMission({ operation_id: 'commit-before-integration-race', expected_revision: prepared.state.revision, action: 'mission.commit', payload: { goal_id: 'goal-one', mission_id: 'mission-one', message: 'test: prepare integration race' } }, prepared.root);
    let state = committed.state;
    state = await advanceGoal(state, prepared.root, [['work', 'validation'], ['validation', 'audit'], ['audit', 'integration']], 'integration-race');
    const commitOid = state.goals[0].missions[0].orchestrator_commit;
    const command = { operation_id: 'integrate-race', expected_revision: state.revision, action: 'mission.integrate', payload: { goal_id: 'goal-one', mission_id: 'mission-one', commit_oid: commitOid } };
    await assertSerializedRace(prepared.root, 'integrate-mission', command, state.revision, 'integration');
  });

  await t.test('rollback', async () => {
    const root = fixture(true);
    const goal = await createGoalAtWork(root);
    const prepared = await prepareMission(missionCommand(goal.state.revision), root);
    const command = { operation_id: 'rollback-race', expected_revision: prepared.state.revision, action: 'mission.rollback', payload: { goal_id: 'goal-one', mission_id: 'mission-one', reason: 'serialize rollback race' } };
    await assertSerializedRace(root, 'rollback-mission', command, prepared.state.revision, 'rollback');
  });

  await t.test('purge', async () => {
    const root = fixture(true);
    const goal = await createGoalAtWork(root);
    let state = (await prepareMission(missionCommand(goal.state.revision), root)).state;
    const policyDigest = state.goals[0].policy_digest;
    const checkpoint = { checkpoint_id: 'purge-checkpoint', goal_id: 'goal-one', policy_digest: policyDigest, completed_stage: 'work', completed_receipt_ids: [], artifact_refs: [], next_stage: 'validation', created_at: '2026-09-17T12:20:00Z' };
    const request = { decision_id: 'purge-decision', goal_id: 'goal-one', checkpoint_id: checkpoint.checkpoint_id, policy_digest: policyDigest, category: 'cleanup', prompt: 'Purge the worktree?', allowed_alternatives: ['purge', 'reject'], status: 'PENDING', created_at: '2026-09-17T12:20:00Z' };
    state = (await transactOrchestrator({ operation_id: 'purge-request', expected_revision: state.revision, action: 'decision.request', payload: { request, checkpoint } }, root)).state;
    const receipt = { receipt_id: 'purge-receipt', decision_id: request.decision_id, policy_digest: policyDigest, selection: 'purge', resolved_via: 'cli', resolved_at: '2026-09-17T12:21:00Z', subject: 'local-user-unverified' };
    state = (await transactOrchestrator({ operation_id: 'purge-resolve', expected_revision: state.revision, action: 'decision.resolve', payload: { receipt } }, root)).state;
    const command = { operation_id: 'purge-race', expected_revision: state.revision, action: 'worktree.purge', payload: { goal_id: 'goal-one', mission_id: 'mission-one', decision_receipt_id: receipt.receipt_id, confirmation: 'mission-one', reason: 'serialize purge race' } };
    await assertSerializedRace(root, 'purge-worktree', command, state.revision, 'purge');
  });
});

test('doctor returns exit 2 for intervention and preserves an unknown symlink', async () => {
  const root = fixture(true);
  await ensureOrchestratorState(root);
  mkdirSync(join(root, '.ctxroute/worktrees'), { recursive: true });
  const link = join(root, '.ctxroute/worktrees/unknown-link');
  symlinkSync(join(root, 'src'), link);
  const result = await runNode([join(repositoryRoot, 'scripts/orchestrator-cli.mjs'), 'doctor'], root);
  assert.equal(result.code, 2);
  assert.match(result.stdout, /"status": "BLOCKED"/u);
  assert.equal(existsSync(link), true);
});

function goalCommand() { return { operation_id: 'goal-create-one', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Recovery goal' } }; }
async function createGoalAtWork(root) {
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  for (const [index, completed_stage, next_stage] of [[1, 'inventory', 'planning'], [2, 'planning', 'work']]) {
    const goal = state.goals[0];
    state = (await transactOrchestrator({
      operation_id: `stage-${index}`,
      expected_revision: state.revision,
      action: 'goal.stage.advance',
      payload: { goal_id: goal.goal_id, checkpoint: { checkpoint_id: `checkpoint-${index}`, goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage, completed_receipt_ids: [], artifact_refs: [], next_stage, created_at: `2026-09-17T12:0${index}:00Z` } },
    }, root)).state;
  }
  return { state };
}
function missionCommand(revision) { return { operation_id: 'mission-prepare-one', expected_revision: revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: 'mission-one', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: ['src/', 'lib/'], acceptance: ['Converges after crash'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30_000 }], execution: 'coordinated' } } }; }
async function completedMissionFixture() {
  const root = fixture(true);
  const goal = await createGoalAtWork(root);
  const prepared = await prepareMission(missionCommand(goal.state.revision), root);
  let state = (await transactOrchestrator({ operation_id: 'start-for-race', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'RUNNING' } }, root)).state;
  const worktree = state.goals[0].missions[0].worktree_allocation.path;
  writeFileSync(join(root, worktree, 'src/change.mjs'), 'export const race = true;\n');
  const report = { mission_id: 'mission-one', status: 'READY_FOR_VALIDATION', files_touched: ['src/change.mjs'], validation_results: [{ id: 'syntax', status: 'PASSED', exit_code: 0, duration_ms: 1, timed_out: false, cause: null, diagnostic: null }], summary: 'Ready for serialized effect.' };
  state = (await submitWorkerReport({ operation_id: 'report-for-race', expected_revision: state.revision, action: 'report.submit', payload: { goal_id: 'goal-one', report } }, root)).state;
  return { root, state };
}
async function advanceGoal(state, root, transitions, prefix) {
  for (const [index, [completed_stage, next_stage]] of transitions.entries()) {
    const goal = state.goals[0];
    state = (await transactOrchestrator({ operation_id: `${prefix}-${index}`, expected_revision: state.revision, action: 'goal.stage.advance', payload: { goal_id: goal.goal_id, checkpoint: { checkpoint_id: `${prefix}-checkpoint-${index}`, goal_id: goal.goal_id, policy_digest: goal.policy_digest, completed_stage, completed_receipt_ids: [], artifact_refs: [], next_stage, created_at: `2026-09-17T12:1${index}:00Z` } } }, root)).state;
  }
  return state;
}
async function assertSerializedRace(root, effectCommand, effect, revision, label) {
  const reconciliation = { operation_id: `reconcile-${label}-race`, expected_revision: revision, action: 'worktree.reconcile', payload: { repair: true } };
  const effectProcess = runLockedEffect(root, effectCommand, effect);
  await effectProcess.locked;
  const [effectResult, reconciliationResult] = await Promise.all([effectProcess.result, runCliCommand(root, 'reconcile-worktrees', reconciliation, `${label}-reconcile.json`)]);
  assert.equal(effectResult.code, 0, effectResult.stderr);
  assert.equal(reconciliationResult.code, 1, reconciliationResult.stderr);
  assert.match(reconciliationResult.stderr, /revision conflict/u);
  const state = await readOrchestratorState(root);
  assert.equal(state.transactions.some(transaction => transaction.status === 'PENDING'), false);
}
function fixture(gitRepository = true) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-recovery-'));
  mkdirSync(join(root, '.project'), { recursive: true }); writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  mkdirSync(join(root, '.agents/skills/blueprint-audit'), { recursive: true }); writeFileSync(join(root, '.agents/skills/blueprint-audit/SKILL.md'), '---\nname: blueprint-audit\n---\n');
  if (gitRepository) { mkdirSync(join(root, 'src')); mkdirSync(join(root, 'lib')); writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n'); git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'chore: fixture']); }
  return root;
}
function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); }
function runCli(root, input) { return new Promise(resolveRun => { const child = spawn(process.execPath, [join(repositoryRoot, 'scripts/orchestrator-cli.mjs'), 'mutate', input], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('close', code => resolveRun({ code, stdout, stderr })); }); }
function runCliCommand(root, command, payload, filename) { const directory = join(root, '.ctxroute/test-inputs'); mkdirSync(directory, { recursive: true }); const input = join(directory, filename); writeFileSync(input, JSON.stringify(payload)); return new Promise(resolveRun => { const child = spawn(process.execPath, [join(repositoryRoot, 'scripts/orchestrator-cli.mjs'), command, input], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('close', code => resolveRun({ code, stdout, stderr })); }); }
function runLockedEffect(root, command, payload) {
  const exportNames = { 'prepare-mission': 'prepareMission', 'commit-mission': 'commitMission', 'integrate-mission': 'integrateMission', 'rollback-mission': 'rollbackMission', 'purge-worktree': 'purgeWorktree' };
  const serviceUrl = new URL('../scripts/orchestrator-service.mjs', import.meta.url).href;
  const coreUrl = new URL('../scripts/orchestrator-core.mjs', import.meta.url).href;
  const source = `import * as service from ${JSON.stringify(serviceUrl)}; import { repositoryMutationLock } from ${JSON.stringify(coreUrl)}; const command=JSON.parse(process.argv[1]); const root=process.argv[2]; await repositoryMutationLock(root, {}, async locked => { process.stdout.write('LOCKED\\n'); await new Promise(resolve => setTimeout(resolve, 150)); await service[process.argv[3]](command, root, process.env, locked); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, JSON.stringify(payload), root, exportNames[command]], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  let signalLocked;
  const locked = new Promise(resolveLocked => { signalLocked = resolveLocked; });
  child.stdout.on('data', chunk => { stdout += chunk; if (stdout.includes('LOCKED\n')) signalLocked(); });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = new Promise(resolveRun => { child.on('close', code => { signalLocked(); resolveRun({ code, stdout, stderr }); }); });
  return { locked, result };
}
function runNode(args, cwd) { return new Promise(resolveRun => { const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('close', (code, signal) => resolveRun({ code, signal, stdout, stderr })); }); }
