import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginOrchestratorTransaction, currentSwarmMode, readOrchestratorState, transactOrchestrator,
  validateAuditReport, validateWorkerReport,
} from '../scripts/orchestrator-core.mjs';
import { bootstrapOrchestrator } from '../scripts/orchestrator-bootstrap.mjs';
import { prepareMission, reconcileWorktrees, rollbackMission, submitWorkerReport } from '../scripts/orchestrator-service.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('V2 state is created atomically and mode reports its source', async () => {
  const root = fixture();
  assert.deepEqual(await currentSwarmMode(root, {}), { mode: 'SWARM_ON', mode_source: 'default' });
  assert.deepEqual(await currentSwarmMode(root, { CTXROUTE_SWARM_MODE: 'SWARM_OFF' }), { mode: 'SWARM_OFF', mode_source: 'environment' });
  await bootstrapOrchestrator(root);
  const state = await readOrchestratorState(root);
  assert.equal(state.schemaVersion, 2);
  assert.equal(existsSync(join(root, '.ctxroute/orchestrator/state.json')), true);
});

test('transactions persist PENDING before completion and replay the full canonical payload', async () => {
  const root = fixture();
  const command = goalCommand();
  const pending = await beginOrchestratorTransaction(command, root);
  assert.equal(pending.receipt.status, 'PENDING');
  assert.equal(pending.state.revision, 1);
  const completed = await transactOrchestrator(command, root);
  assert.equal(completed.receipt.status, 'COMPLETED');
  assert.equal(completed.state.revision, 2);
  assert.equal((await transactOrchestrator(command, root)).replayed, true);
  await assert.rejects(() => transactOrchestrator({ ...command, payload: { goal_id: 'goal-two', title: 'Ship' } }, root), /different payload/u);
  await assert.rejects(() => transactOrchestrator({ ...command, payload: { ...command.payload, extra: 'hidden' } }, root), /contract/u);
  await assert.rejects(() => transactOrchestrator({ ...command, operation_id: 'secret-op', expected_revision: 2, payload: { ...command.payload, title: 'token=unsafe' } }, root), /secret-like/u);
});

test('known V1 state resets without touching worktrees, while corrupt and unknown states fail closed', async () => {
  const root = fixture();
  const statePath = join(root, '.ctxroute/orchestrator/state.json');
  mkdirSync(join(root, '.ctxroute/orchestrator'), { recursive: true });
  mkdirSync(join(root, '.ctxroute/worktrees/legacy'), { recursive: true });
  mkdirSync(join(root, '.ctxroute/recovery'), { recursive: true });
  mkdirSync(join(root, '.ctxroute/reports'), { recursive: true });
  writeFileSync(join(root, '.ctxroute/worktrees/legacy/evidence.txt'), 'preserve');
  writeFileSync(join(root, '.ctxroute/recovery/proof.patch'), 'proof');
  writeFileSync(join(root, '.ctxroute/reports/report.json'), 'report');
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, revision: 3, mode: 'SWARM_ON', goals: [], skills: [], audits: [], transactions: [] }));
  writeFileSync(`${statePath}.lock`, JSON.stringify({ token: 'legacy-dead', pid: 999999, created_at: '2020-01-01T00:00:00.000Z' }));
  writeFileSync(`${statePath}.999999.deadbeef.tmp`, 'partial');
  await assert.rejects(() => readOrchestratorState(root), /requires bootstrap/u);
  const reset = await bootstrapOrchestrator(root, { processAlive: () => false });
  assert.equal(reset.changed, true);
  assert.equal((await readOrchestratorState(root)).schemaVersion, 2);
  assert.equal((await readOrchestratorState(root)).migration_receipt.from_revision, 3);
  assert.equal(readFileSync(join(root, '.ctxroute/worktrees/legacy/evidence.txt'), 'utf8'), 'preserve');
  assert.equal(readFileSync(join(root, '.ctxroute/recovery/proof.patch'), 'utf8'), 'proof');
  assert.equal(readFileSync(join(root, '.ctxroute/reports/report.json'), 'utf8'), 'report');
  assert.equal(existsSync(`${statePath}.lock`), false);
  writeFileSync(statePath, '{bad');
  await assert.rejects(() => bootstrapOrchestrator(root), /corrupt JSON/u);
  assert.equal(readFileSync(statePath, 'utf8'), '{bad');
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 99 }));
  await assert.rejects(() => bootstrapOrchestrator(root), /unsupported schemaVersion 99/u);
  assert.equal(JSON.parse(readFileSync(statePath)).schemaVersion, 99);
});

test('V1 reset refuses live, malformed, and symlinked state evidence without deletion', async () => {
  const root = fixture();
  const directory = join(root, '.ctxroute/orchestrator');
  const statePath = join(directory, 'state.json');
  const v1 = JSON.stringify({ schemaVersion: 1, revision: 3, mode: 'SWARM_ON', goals: [], skills: [], audits: [], transactions: [] });
  mkdirSync(directory, { recursive: true }); writeFileSync(statePath, v1);
  writeFileSync(`${statePath}.lock`, JSON.stringify({ token: 'live', pid: process.pid, created_at: new Date().toISOString() }));
  await assert.rejects(() => bootstrapOrchestrator(root), /owner is alive/u);
  assert.equal(readFileSync(statePath, 'utf8'), v1);
  writeFileSync(`${statePath}.lock`, 'unrecognized');
  await assert.rejects(() => bootstrapOrchestrator(root), /not recognized/u);
  assert.equal(readFileSync(statePath, 'utf8'), v1);
  const target = join(directory, 'actual-v1.json'); writeFileSync(target, v1);
  unlinkSync(`${statePath}.lock`); unlinkSync(statePath); symlinkSync(target, statePath);
  await assert.rejects(() => bootstrapOrchestrator(root), /regular file/u);
  assert.equal(readFileSync(target, 'utf8'), v1);
});

test('stale dead locks recover but a live lock times out', async () => {
  const root = fixture();
  await bootstrapOrchestrator(root);
  const lock = join(root, '.ctxroute/orchestrator/state.json.lock');
  writeFileSync(lock, JSON.stringify({ token: 'stale', pid: 999999, created_at: '2020-01-01T00:00:00.000Z' }));
  const recovered = await transactOrchestrator(goalCommand(), root, { processAlive: () => false });
  assert.equal(recovered.receipt.status, 'COMPLETED');
  writeFileSync(lock, JSON.stringify({ token: 'live', pid: process.pid, created_at: new Date().toISOString() }));
  let clock = Date.now();
  await assert.rejects(() => transactOrchestrator({ operation_id: 'second', expected_revision: 2, action: 'goal.create', payload: { goal_id: 'goal-two', title: 'Two' } }, root, { processAlive: () => true, now: () => new Date(clock += 1000), wait: async () => {} }), /lock timeout/u);
});

test('environment SWARM_OFF and explicit direct execution create no mission or worktree', async () => {
  const root = fixture(true);
  const goal = await transactOrchestrator(goalCommand(), root);
  const environmentResult = await prepareMission(missionCommand(goal.state.revision), root, { CTXROUTE_SWARM_MODE: 'SWARM_OFF' });
  assert.equal(environmentResult.bypassed, true);
  assert.equal(environmentResult.mode_source, 'environment');
  const direct = missionCommand(environmentResult.state.revision, 'direct-two');
  direct.payload.mission.mission_id = 'mission-two'; direct.payload.mission.execution = 'direct';
  const directResult = await prepareMission(direct, root, {});
  assert.equal(directResult.reason, 'EXPLICIT_DIRECT');
  assert.equal(directResult.state.goals[0].missions.length, 0);
});

test('coordinated mission is isolated and completes only after orchestrator validation replay', async () => {
  const root = fixture(true);
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  const prepareCommand = missionCommand(state.revision);
  prepareCommand.payload.mission.validations.push({ id: 'syntax-again', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30_000 });
  const prepared = await prepareMission(prepareCommand, root);
  let mission = prepared.state.goals[0].missions[0];
  assert.equal(mission.status, 'ASSIGNED');
  assert.equal(mission.response_format, 'worker-report-v2');
  const overlap = missionCommand(prepared.state.revision, 'mission-overlap');
  overlap.payload.mission.mission_id = 'mission-overlap';
  overlap.payload.mission.file_scope = ['SRC/', 'other/'];
  await assert.rejects(() => prepareMission(overlap, root), /overlaps an active worker/u);
  state = (await transactOrchestrator({ operation_id: 'start-one', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'RUNNING' } }, root)).state;
  writeFileSync(join(root, mission.worktree_allocation.path, 'src/change.mjs'), 'export const changed = true;\n');
  const report = workerReport(['src/change.mjs']);
  const result = await submitWorkerReport({ operation_id: 'report-one', expected_revision: state.revision, action: 'report.submit', payload: { goal_id: 'goal-one', report } }, root);
  mission = result.state.goals[0].missions[0];
  assert.equal(mission.status, 'COMPLETED');
  assert.equal(mission.validation_receipt.status, 'PASSED');
  const events = readFileSync(join(root, '.ctxroute/orchestrator/events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.operation_id === 'report-one' && event.event_type === 'VALIDATION').length, 2);
  assert.ok(events.some(event => event.operation_id === 'report-one' && event.transition === 'RUNNING->COMPLETED'));
  assert.deepEqual(validateWorkerReport(report), []);
});

test('worker claims cannot hide a failing orchestrator validation or an out-of-scope diff', async () => {
  const root = fixture(true);
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  const command = missionCommand(state.revision);
  command.payload.mission.validations[0].args = ['--check', 'src/broken.mjs'];
  let prepared = await prepareMission(command, root);
  state = (await transactOrchestrator({ operation_id: 'start-one', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'RUNNING' } }, root)).state;
  const worktree = prepared.state.goals[0].missions[0].worktree_allocation.path;
  writeFileSync(join(root, worktree, 'src/broken.mjs'), 'export const = ;\n');
  const blocked = await submitWorkerReport({ operation_id: 'report-one', expected_revision: state.revision, action: 'report.submit', payload: { goal_id: 'goal-one', report: workerReport(['src/broken.mjs']) } }, root);
  assert.equal(blocked.state.goals[0].missions[0].status, 'BLOCKED');
  assert.equal(blocked.state.goals[0].missions[0].validation_receipt.status, 'FAILED');
});

test('reconciliation preserves dirty terminal worktrees and removes only clean terminal worktrees', async () => {
  const root = fixture(true);
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  let prepared = await prepareMission(missionCommand(state.revision), root);
  state = (await transactOrchestrator({ operation_id: 'cancel-one', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'CANCELLED' } }, root)).state;
  const worktree = prepared.state.goals[0].missions[0].worktree_allocation.path;
  writeFileSync(join(root, worktree, 'dirty.txt'), 'evidence');
  let command = { operation_id: 'reconcile-one', expected_revision: state.revision, action: 'worktree.reconcile', payload: { repair: true } };
  let reconciled = await reconcileWorktrees(command, root);
  assert.equal(existsSync(join(root, worktree)), true);
  assert.ok(reconciled.state.worktree_operations.some(item => item.classification === 'TERMINAL_DIRTY'));
});

test('reconciliation removes clean terminal worktrees but preserves clean revision divergence', async () => {
  const root = fixture(true);
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  let prepared = await prepareMission(missionCommand(state.revision), root);
  const worktree = prepared.state.goals[0].missions[0].worktree_allocation.path;
  state = (await transactOrchestrator({ operation_id: 'cancel-clean', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-one', status: 'CANCELLED' } }, root)).state;
  let reconciled = await reconcileWorktrees({ operation_id: 'reconcile-clean', expected_revision: state.revision, action: 'worktree.reconcile', payload: { repair: true } }, root);
  assert.equal(existsSync(join(root, worktree)), false);
  assert.ok(reconciled.state.worktree_operations.some(item => item.classification === 'TERMINAL_CLEAN'));

  const second = missionCommand(reconciled.state.revision, 'prepare-diverged');
  second.payload.mission.mission_id = 'mission-diverged';
  prepared = await prepareMission(second, root);
  const diverged = prepared.state.goals[0].missions.find(item => item.mission_id === 'mission-diverged').worktree_allocation.path;
  writeFileSync(join(root, diverged, 'src/committed.mjs'), 'export const committed = true;\n');
  git(join(root, diverged), ['add', '.']); git(join(root, diverged), ['commit', '-qm', 'test: preserve divergence']);
  state = (await transactOrchestrator({ operation_id: 'cancel-diverged', expected_revision: prepared.state.revision, action: 'mission.transition', payload: { goal_id: 'goal-one', mission_id: 'mission-diverged', status: 'CANCELLED' } }, root)).state;
  reconciled = await reconcileWorktrees({ operation_id: 'reconcile-diverged', expected_revision: state.revision, action: 'worktree.reconcile', payload: { repair: true } }, root);
  assert.equal(existsSync(join(root, diverged)), true);
  assert.ok(reconciled.state.worktree_operations.some(item => item.mission_id === 'mission-diverged' && item.classification === 'NEEDS_ATTENTION'));
});

test('reconciliation never removes a worktree with an index lock', async () => {
  const root = fixture(true);
  const goal = await transactOrchestrator(goalCommand(), root);
  const prepared = await prepareMission(missionCommand(goal.state.revision), root);
  const worktree = prepared.state.goals[0].missions[0].worktree_allocation.path;
  const gitDirectory = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], { cwd: join(root, worktree), encoding: 'utf8' }).trim();
  writeFileSync(join(gitDirectory, 'index.lock'), 'live lock evidence');
  const result = await reconcileWorktrees({ operation_id: 'reconcile-index-lock', expected_revision: prepared.state.revision, action: 'worktree.reconcile', payload: { repair: true } }, root);
  assert.equal(existsSync(join(root, worktree)), true);
  assert.ok(result.state.worktree_operations.some(item => item.mission_id === 'mission-one' && item.classification === 'NEEDS_ATTENTION'));
});

test('rollback captures a bounded recovery proof before force removal', async () => {
  const root = fixture(true);
  let state = (await transactOrchestrator(goalCommand(), root)).state;
  const prepared = await prepareMission(missionCommand(state.revision), root);
  const mission = prepared.state.goals[0].missions[0];
  writeFileSync(join(root, mission.worktree_allocation.path, 'src/change.mjs'), 'export const proof = true;\n');
  const rolled = await rollbackMission({ operation_id: 'rollback-one', expected_revision: prepared.state.revision, action: 'mission.rollback', payload: { goal_id: 'goal-one', mission_id: 'mission-one', reason: 'operator requested rollback' } }, root);
  const allocation = rolled.state.goals[0].missions[0].worktree_allocation;
  assert.equal(allocation.status, 'ROLLED_BACK');
  assert.equal(existsSync(join(root, allocation.recovery_proof)), true);
  assert.equal(existsSync(join(root, allocation.path)), false);
});

test('worker authority and symlinked worktrees fail closed', async () => {
  const root = fixture(true);
  const worker = { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: 'mission-one' };
  const { mutateCoordination } = await import('../scripts/orchestrator-service.mjs');
  await assert.rejects(() => mutateCoordination(goalCommand(), root, worker), /workers cannot mutate/u);
  mkdirSync(join(root, '.ctxroute/worktrees'), { recursive: true });
  symlinkSync(join(root, 'src'), join(root, '.ctxroute/worktrees/mission-one'));
  const state = (await transactOrchestrator(goalCommand(), root)).state;
  await assert.rejects(() => prepareMission(missionCommand(state.revision), root), /symlink|SYMLINK|already exists/u);
});

test('formal report and audit contracts reject unknown fields and conversational content', () => {
  assert.deepEqual(validateWorkerReport(workerReport([])), []);
  assert.match(validateWorkerReport({ ...workerReport([]), conversation_history: [] }).join(' '), /contract/u);
  const audit = { schemaVersion: 2, audit_id: 'audit-one', audit_type: 'blueprint-audit', subject: { type: 'blueprint', id: 'blueprint' }, signals: ['no-defect'], decision: 'accept', evidence_refs: [], proposed_action: null, applied_action: null, validations: [], rollback_ref: null };
  assert.deepEqual(validateAuditReport(audit), []);
  assert.match(validateAuditReport({ ...audit, prompt: 'private' }).join(' '), /contract/u);
});

function goalCommand() { return { operation_id: 'goal-create-one', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Ship one goal' } }; }
function missionCommand(revision, operation_id = 'mission-prepare-one') { return { operation_id, expected_revision: revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: 'mission-one', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: ['src/', 'lib/'], acceptance: ['Scoped file is valid'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30_000 }], execution: 'coordinated' } } }; }
function workerReport(files) { return { schemaVersion: 2, mission_id: 'mission-one', status: 'READY_FOR_VALIDATION', files_touched: files, validation_results: [{ id: 'syntax', status: 'PASSED', exit_code: 0, duration_ms: 1, timed_out: false, cause: null, diagnostic: null }], summary: 'Worker reports readiness; orchestrator must verify.' }; }
function fixture(gitRepository = false) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-v2-'));
  mkdirSync(join(root, '.project'), { recursive: true });
  writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  for (const skill of ['blueprint-audit', 'skill-creator']) { mkdirSync(join(root, '.agents/skills', skill), { recursive: true }); writeFileSync(join(root, '.agents/skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`); }
  if (gitRepository) { mkdirSync(join(root, 'src')); mkdirSync(join(root, 'lib')); writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n'); git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'chore: fixture']); }
  return root;
}
function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); }
