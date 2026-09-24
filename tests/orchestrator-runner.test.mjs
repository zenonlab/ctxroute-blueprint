import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOrchestratorState, transactOrchestrator } from '../scripts/orchestrator-core.mjs';
import { prepareMission, readCoordination } from '../scripts/orchestrator-service.mjs';
import { runGoalMissions, runMissionAdapter } from '../scripts/orchestrator-runner.mjs';
import { verifyWorkerRoots } from '../scripts/orchestrator-worker-roots.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const report = { mission_id: 'mission-one', status: 'READY_FOR_VALIDATION', files_touched: [], validation_results: [{ id: 'syntax', status: 'PASSED', exit_code: 0, duration_ms: 1, timed_out: false, cause: null, diagnostic: null }], summary: 'Ready' };
const view = { mission_id: 'mission-one', primary_root: '/tmp/primary', policy_digest: 'a'.repeat(64), policy_snapshot: '.ctxroute/orchestrator/policies/goal-one.json', workflow: 'STANDARD', stage: 'work', strategy: 'single-worker', access: 'write', file_scope: ['src/'], acceptance: ['Ready'], validations: [], response_format: 'worker-report' };
const limits = { subprocessTimeoutMs: 500, reportBytes: 65536 };

function fakeExecutable(name, source) {
  const directory = mkdtempSync(join(tmpdir(), 'worker-adapter-'));
  const executable = join(directory, name);
  writeFileSync(executable, `#!/usr/bin/env node\n${source}\n`);
  chmodSync(executable, 0o755);
  return { directory, environment: { ...process.env, PATH: `${directory}:${process.env.PATH}` } };
}

for (const adapter of ['codex', 'claude', 'opencode']) {
  test(`${adapter} uses its CLI and returns a validated report`, async () => {
    const body = adapter === 'codex' ? JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(report) } }) : adapter === 'opencode' ? JSON.stringify({ type: 'text', part: { text: JSON.stringify(report) } }) : JSON.stringify(report);
    const fake = fakeExecutable(adapter, `process.stdout.write(${JSON.stringify(body)});`);
    const result = await runMissionAdapter(adapter, view, fake.directory, limits, fake.environment);
    assert.deepEqual(result, report);
  });
}

test('invalid report, timeout, and absent executable fail with bounded causes', async () => {
  const invalid = fakeExecutable('claude', 'process.stdout.write("not JSON")');
  await assert.rejects(() => runMissionAdapter('claude', view, invalid.directory, limits, invalid.environment), error => error.causeCode === 'INVALID_WORKER_REPORT');
  const stalled = fakeExecutable('claude', 'setTimeout(() => {}, 2000)');
  await assert.rejects(() => runMissionAdapter('claude', view, stalled.directory, { ...limits, subprocessTimeoutMs: 50 }, stalled.environment), error => error.causeCode === 'WORKER_TIMEOUT');
  const missing = mkdtempSync(join(tmpdir(), 'worker-missing-'));
  await assert.rejects(() => runMissionAdapter('opencode', view, missing, limits, { PATH: missing }), error => error.causeCode === 'WORKER_CLI_MISSING');
});

test('parallel isolated missions validate and commit without duplicate launches', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-goal-'));
  mkdirSync(join(root, '.project'));
  mkdirSync(join(root, '.agents/skills/blueprint-audit'), { recursive: true });
  writeFileSync(join(root, '.agents/skills/blueprint-audit/SKILL.md'), '---\nname: blueprint-audit\n---\n');
  writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n');
  writeFileSync(join(root, 'lib/.keep'), '');
  const git = args => execFileSync('git', args, { cwd: root });
  git(['init', '-q']); git(['config', 'user.email', 'fixture@example.invalid']); git(['config', 'user.name', 'Fixture']); git(['add', '.']); git(['commit', '-qm', 'fixture']);
  let state = (await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { goal_id: 'goal-one', title: 'Parallel work' } }, root)).state;
  for (const [completedStage, nextStage] of [['inventory', 'planning'], ['planning', 'work']]) {
    const goal = state.goals[0];
    state = (await transactOrchestrator({ operation_id: `stage-${nextStage}`, expected_revision: state.revision, action: 'goal.stage.advance', payload: { goal_id: 'goal-one', checkpoint: { checkpoint_id: `checkpoint-${nextStage}`, goal_id: 'goal-one', policy_digest: goal.policy_digest, completed_stage: completedStage, completed_receipt_ids: [], artifact_refs: [], next_stage: nextStage, created_at: '2026-09-24T12:00:00Z' } } }, root)).state;
  }
  for (const [missionId, scope] of [['mission-one', 'src/'], ['mission-two', 'lib/']]) {
    state = (await prepareMission({ operation_id: `prepare-${missionId}`, expected_revision: state.revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: missionId, skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: [scope], acceptance: ['Valid file'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', `${scope}change.mjs`], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' } } }, root)).state;
  }
  let launched = 0;
  await verifyWorkerRoots(root, join(root, state.goals[0].missions[0].worktree_allocation.path));
  const boundWorktree = join(root, state.goals[0].missions[0].worktree_allocation.path);
  assert.equal((await readCoordination(root, { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: 'mission-one', CTXROUTE_WORKTREE: boundWorktree })).mission_id, 'mission-one');
  await assert.rejects(() => readCoordination(root, { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: 'mission-two', CTXROUTE_WORKTREE: boundWorktree }), /contradicts/u);
  const result = await runGoalMissions('goal-one', 'claude', root, { launch: async (_executable, _args, options) => {
    launched += 1;
    const missionId = options.env.CTXROUTE_MISSION_ID;
    const scope = missionId === 'mission-one' ? 'src' : 'lib';
    writeFileSync(join(options.cwd, scope, 'change.mjs'), 'export const change = true;\n');
    return JSON.stringify({ ...report, mission_id: missionId, files_touched: [`${scope}/change.mjs`] });
  } });
  assert.deepEqual(result.selected.sort(), ['mission-one', 'mission-two']);
  assert.equal(launched, 2, JSON.stringify(result));
  assert.deepEqual(result.results.map(item => item.status).sort(), ['COMPLETED', 'COMPLETED'], JSON.stringify(result));
  const finished = await readOrchestratorState(root);
  assert.ok(finished.goals[0].missions.every(mission => mission.orchestrator_commit && mission.attempt.status === 'SUCCEEDED'));
  assert.deepEqual((await runGoalMissions('goal-one', 'claude', root, { launch: () => { throw new Error('duplicate'); } })).selected, []);
  const prepared = await prepareMission({ operation_id: 'prepare-mission-three', expected_revision: (await readOrchestratorState(root)).revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: 'mission-three', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: ['src/'], acceptance: ['Valid file'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' } } }, root);
  assert.equal(prepared.state.goals[0].missions.length, 3);
  const denied = await runGoalMissions('goal-one', 'claude', root, { launch: async (_executable, _args, options) => {
    writeFileSync(join(options.cwd, 'lib/foreign.mjs'), 'export const foreign = true;\n');
    return JSON.stringify({ ...report, mission_id: 'mission-three', files_touched: ['lib/foreign.mjs'] });
  } });
  assert.equal(denied.results[0].status, 'BLOCKED');
  assert.equal((await readOrchestratorState(root)).goals[0].missions[2].attempt.status, 'BLOCKED');
  assert.equal(readFileSync(join(root, '.ctxroute/worktrees/mission-three/lib/foreign.mjs'), 'utf8'), 'export const foreign = true;\n');
  state = (await prepareMission({ operation_id: 'prepare-mission-four', expected_revision: (await readOrchestratorState(root)).revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: { mission_id: 'mission-four', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '1.0.0', file_scope: ['lib/'], acceptance: ['Valid file'], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'lib/change.mjs'], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' } } }, root)).state;
  await transactOrchestrator({ operation_id: 'start-interrupted', expected_revision: state.revision, action: 'mission.attempt.start', payload: { goal_id: 'goal-one', mission_id: 'mission-four', attempt_id: 'attempt-interrupted', adapter: 'claude', supervisor_pid: 999999, started_at: '2026-09-24T12:00:00Z' } }, root);
  const recovered = await runGoalMissions('goal-one', 'claude', root, { launch: () => { throw new Error('duplicate'); } });
  assert.deepEqual(recovered.selected, []);
  assert.equal((await readOrchestratorState(root)).goals[0].missions[3].attempt.cause, 'SUPERVISOR_INTERRUPTED');
});
