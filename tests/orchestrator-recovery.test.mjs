import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureOrchestratorState, readOrchestratorState, transactOrchestrator } from '../scripts/orchestrator-core.mjs';
import { emitDecisionEvent } from '../scripts/orchestrator-telemetry.mjs';
import { prepareMission } from '../scripts/orchestrator-service.mjs';
import { bootstrapOrchestrator } from '../scripts/orchestrator-bootstrap.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('a crash after physical worktree creation leaves PENDING intent and replay converges', async () => {
  const root = fixture();
  const goal = await transactOrchestrator(goalCommand(), root);
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
  const goal = await transactOrchestrator(goalCommand(), root);
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
  assert.match(combined, /"schemaVersion":2/u);
  assert.match(combined, /"policy_id":"orchestrator-v2"/u);
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
  const goal = await transactOrchestrator(goalCommand(), root);
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
  let state = (await transactOrchestrator(goalCommand(), root)).state;
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
function missionCommand(revision) { return { operation_id: 'mission-prepare-one', expected_revision: revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: 'mission-one', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: ['src/', 'lib/'], acceptance: ['Converges after crash'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30_000 }], execution: 'coordinated' } } }; }
function fixture(gitRepository = true) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-recovery-'));
  mkdirSync(join(root, '.project'), { recursive: true }); writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  mkdirSync(join(root, '.agents/skills/blueprint-audit'), { recursive: true }); writeFileSync(join(root, '.agents/skills/blueprint-audit/SKILL.md'), '---\nname: blueprint-audit\n---\n');
  if (gitRepository) { mkdirSync(join(root, 'src')); mkdirSync(join(root, 'lib')); writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n'); git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'chore: fixture']); }
  return root;
}
function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); }
function runCli(root, input) { return new Promise(resolveRun => { const child = spawn(process.execPath, [join(repositoryRoot, 'scripts/orchestrator-cli.mjs'), 'mutate', input], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('close', code => resolveRun({ code, stdout, stderr })); }); }
function runNode(args, cwd) { return new Promise(resolveRun => { const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = ''; let stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.on('close', (code, signal) => resolveRun({ code, signal, stdout, stderr })); }); }
