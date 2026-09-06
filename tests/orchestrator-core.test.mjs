import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentSwarmMode, readOrchestratorState, transactOrchestrator, validateAuditReport, validateWorkerReport } from '../scripts/orchestrator-core.mjs';
import { prepareMission, submitWorkerReport } from '../scripts/orchestrator-service.mjs';
import { reconcileManagedWorktrees, rollbackMissionWorktree } from '../scripts/worktree-manager.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('SWARM_ON is default and SWARM_OFF is a direct environment choice', async () => {
  const root = fixture();
  assert.equal(await currentSwarmMode(root, {}), 'SWARM_ON');
  assert.equal(await currentSwarmMode(root, { CTXROUTE_SWARM_MODE: 'SWARM_OFF' }), 'SWARM_OFF');
  assert.equal(existsSync(join(root, '.ctxroute/orchestrator/state.json')), false);
  const cli = execFileSync(process.execPath, [new URL('../scripts/orchestrator-cli.mjs', import.meta.url).pathname, 'read'], { cwd: root, encoding: 'utf8' });
  assert.match(cli, /"mode": "SWARM_ON"/u);
});

test('goal transactions are atomic, revisioned, idempotent, and conflict-aware', async () => {
  const root = fixture();
  const command = { operation_id: 'goal-create-one', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Ship one goal' } };
  const first = await transactOrchestrator(command, root);
  assert.equal(first.state.revision, 1);
  assert.equal((await transactOrchestrator(command, root)).replayed, true);
  await assert.rejects(() => transactOrchestrator({ ...command, payload: { id: 'goal-one', title: 'Different' } }, root), /different payload/u);
  await assert.rejects(() => transactOrchestrator({ operation_id: 'stale', expected_revision: 0, action: 'goal.update', payload: { goal_id: 'goal-one', title: 'Stale' } }, root), /revision conflict/u);
  writeFileSync(join(root, '.ctxroute/orchestrator/state.json.orphan.tmp'), 'partial');
  assert.equal((await readOrchestratorState(root)).goals[0].title, 'Ship one goal');
});

test('SWARM_OFF prepares no ticket or worktree', async () => {
  const root = fixture();
  await transactOrchestrator({ operation_id: 'mode-off', expected_revision: 0, action: 'mode.set', payload: { mode: 'SWARM_OFF' } }, root);
  const result = await prepareMission(missionCommand(1), root);
  assert.equal(result.bypassed, true);
  assert.equal(existsSync(join(root, '.ctxroute/worktrees/mission-one')), false);
});

test('SWARM_ON bypasses the swarm for a single-scope mission', async () => {
  const root = fixture(true);
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Simple goal' } }, root);
  const command = missionCommand(1);
  command.payload.mission.file_scope = ['src/'];
  const result = await prepareMission(command, root);
  assert.equal(result.bypassed, true);
  assert.equal(existsSync(join(root, '.ctxroute/worktrees/mission-one')), false);
});

test('SWARM_ON isolates a mission, verifies its diff, and records a complete report', async () => {
  const root = fixture(true);
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Parallel goal' } }, root);
  const prepared = await prepareMission(missionCommand(1), root);
  const mission = prepared.state.goals[0].missions[0];
  assert.ok(mission.worktree.startsWith('.ctxroute/worktrees/'));
  assert.equal((await prepareMission(missionCommand(1), root)).replayed, true);
  writeFileSync(join(root, mission.worktree, 'src/change.mjs'), 'export const changed = true;\n');
  const report = {
    mission_id: 'mission-one', skill_id: 'blueprint-audit', skill_version: '1.0.0', files_touched: ['src/change.mjs'],
    commands: [{ command: 'node --check src/change.mjs', exit_code: 0 }], summary: 'Implemented scoped change.', material_evidence: ['src/change.mjs'], blockers: [],
  };
  const completed = await submitWorkerReport({ operation_id: 'report-one', expected_revision: 2, action: 'mission.report', payload: { mission_id: 'mission-one', report } }, root);
  assert.equal(completed.state.goals[0].missions[0].status, 'COMPLETED');
  assert.deepEqual(validateWorkerReport(report), []);
  const rollback = rollbackMissionWorktree(mission.worktree, root, true);
  assert.equal(rollback.force, true);
});

test('reconciliation removes completed mission worktrees and preserves active ones', async () => {
  const root = fixture(true);
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Reconcile worktrees' } }, root);
  const prepared = await prepareMission(missionCommand(1), root);
  const mission = prepared.state.goals[0].missions[0];
  const reconciledActive = await reconcileManagedWorktrees(root);
  assert.deepEqual(reconciledActive.removed, []);
  await transactOrchestrator({ operation_id: 'mission-cancel', expected_revision: 2, action: 'mission.transition', payload: { mission_id: mission.mission_id, status: 'CANCELLED' } }, root);
  const reconciled = await reconcileManagedWorktrees(root);
  assert.deepEqual(reconciled.removed, [mission.worktree]);
  assert.equal(existsSync(join(root, mission.worktree)), false);
});

test('report and audit contracts reject secrets and support orchestrator-only goal adjustment', async () => {
  const root = fixture();
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Audit me' } }, root);
  const audit = { sessions_examined: ['session.jsonl'], signals_detected: ['validation missing'], subject: { type: 'goal', id: 'goal-one' }, decision: 'repair', patch_applied: 'commit abc', validations: ['npm test'], rollback: 'revert abc' };
  assert.deepEqual(validateAuditReport(audit), []);
  const result = await transactOrchestrator({ operation_id: 'audit-one', expected_revision: 1, action: 'audit.apply', payload: { report: audit, goal_adjustment: { goal_id: 'goal-one', title: 'Audited goal' } } }, root);
  assert.equal(result.state.goals[0].title, 'Audited goal');
  assert.match(validateAuditReport({ ...audit, decision: 'token=unsafe' }).join(' '), /secret-like/u);
});

test('worker role cannot mutate goals or prepare another mission', async () => {
  const root = fixture();
  const workerEnvironment = { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: 'mission-one' };
  const { mutateCoordination, prepareMission: prepareAsRole } = await import('../scripts/orchestrator-service.mjs');
  await assert.rejects(() => mutateCoordination({ operation_id: 'forbidden', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Forbidden' } }, root, workerEnvironment), /workers cannot mutate/u);
  await assert.rejects(() => prepareAsRole(missionCommand(0), root, workerEnvironment), /workers cannot mutate/u);
});

test('a missing skill routes the mission to skill-creator and can be registered only transactionally', async () => {
  const root = fixture(true);
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Unknown category' } }, root);
  const command = missionCommand(1);
  command.payload.mission.skill_id = 'new-category';
  const prepared = await prepareMission(command, root);
  const mission = prepared.state.goals[0].missions[0];
  assert.equal(mission.skill_id, 'skill-creator');
  assert.equal(mission.requested_skill_id, 'new-category');
  assert.deepEqual(mission.file_scope, ['.agents/skills/new-category/']);
  const registered = await transactOrchestrator({ operation_id: 'register-skill', expected_revision: 2, action: 'skill.register', payload: { skill_id: 'new-category', version: '1.0.0', path: '.agents/skills/new-category/SKILL.md' } }, root);
  assert.equal(registered.state.skills[0].skill_id, 'new-category');
  rollbackMissionWorktree(mission.worktree, root, true);
});

test('concurrent missions receive distinct worktrees and overlapping write scopes are rejected', async () => {
  const root = fixture(true);
  await transactOrchestrator({ operation_id: 'goal-create', expected_revision: 0, action: 'goal.create', payload: { id: 'goal-one', title: 'Concurrent work' } }, root);
  const first = await prepareMission(missionCommand(1), root);
  const overlapping = missionCommand(2);
  overlapping.operation_id = 'mission-overlap';
  overlapping.payload.mission.mission_id = 'mission-overlap';
  await assert.rejects(() => prepareMission(overlapping, root), /overlaps an active worker/u);
  const second = missionCommand(2);
  second.operation_id = 'mission-two';
  second.payload.mission.mission_id = 'mission-two';
  second.payload.mission.file_scope = ['tests/', 'docs/'];
  const prepared = await prepareMission(second, root);
  const missions = prepared.state.goals[0].missions;
  assert.notEqual(missions[0].worktree, missions[1].worktree);
  rollbackMissionWorktree(first.state.goals[0].missions[0].worktree, root, true);
  rollbackMissionWorktree(missions[1].worktree, root, true);
});

function missionCommand(revision) {
  return {
    operation_id: 'mission-prepare-one', expected_revision: revision, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: {
      mission_id: 'mission-one', skill_id: 'blueprint-audit', skill_version: '1.0.0', file_scope: ['src/', 'lib/'], acceptance: ['Scoped file is valid'], validation_commands: ['node --check src/change.mjs'], response_format: 'worker-report-v1',
    } },
  };
}

function fixture(gitRepository = false) {
  const root = mkdtempSync(join(tmpdir(), 'orchestrator-core-'));
  mkdirSync(join(root, '.project'), { recursive: true });
  writeFileSync(join(root, '.project/orchestrator-config.json'), readFileSync(join(repositoryRoot, '.project/orchestrator-config.json')));
  for (const skill of ['blueprint-audit', 'skill-creator']) {
    mkdirSync(join(root, '.agents/skills', skill), { recursive: true });
    writeFileSync(join(root, '.agents/skills', skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: Fixture skill for orchestration tests.\n---\n`);
  }
  if (gitRepository) {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/base.mjs'), 'export const base = true;\n');
    git(root, ['init', '-q']); git(root, ['config', 'user.email', 'fixture@example.invalid']); git(root, ['config', 'user.name', 'Fixture']); git(root, ['add', '.']); git(root, ['commit', '-qm', 'chore: fixture']);
  }
  return root;
}

function git(root, args) { execFileSync('git', args, { cwd: root, stdio: 'pipe' }); }
