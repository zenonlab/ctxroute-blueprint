import { existsSync } from 'node:fs';
import { readOrchestratorState, transactOrchestrator } from './orchestrator-core.mjs';
import { inspectMissionChanges, prepareMissionWorktree, rollbackMissionWorktree } from './worktree-manager.mjs';
import { queryCtxroute } from './ctxroute-query.mjs';

export async function readCoordination(root = process.cwd(), environment = process.env) {
  const state = await readOrchestratorState(root);
  if (environment.CTXROUTE_AGENT_ROLE !== 'worker') return state;
  const missionId = environment.CTXROUTE_MISSION_ID;
  const mission = state.goals.flatMap(goal => goal.missions).find(item => item.mission_id === missionId);
  if (!mission) throw new Error('worker role requires a registered CTXROUTE_MISSION_ID');
  return { mission_id: mission.mission_id, file_scope: mission.file_scope, skill_id: mission.skill_id, skill_version: mission.skill_version, acceptance: mission.acceptance, validation_commands: mission.validation_commands, response_format: mission.response_format, worktree: mission.worktree };
}

export async function mutateCoordination(command, root = process.cwd(), environment = process.env) {
  assertOrchestratorRole(environment);
  return transactOrchestrator(command, root);
}

export async function prepareMission(command, root = process.cwd(), environment = process.env) {
  assertOrchestratorRole(environment);
  const state = await readOrchestratorState(root);
  if (state.mode === 'SWARM_OFF') return { bypassed: true, mode: state.mode, reason: 'Primary agent executes directly; no mission or worktree created.' };
  const requestedMission = command.payload?.mission;
  if (!requestedMission) throw new Error('mission.prepare requires payload.mission');
  const mission = routeMissingSkill(requestedMission, root);
  if (state.mode === 'SWARM_ON' && !mission.requested_skill_id && mission.file_scope.length < 2) {
    return { bypassed: true, mode: state.mode, reason: 'Single-scope mission is executed directly; swarm worktrees require at least two disjoint scopes.', mission };
  }
  if (state.transactions.some(item => item.operation_id === command.operation_id)) {
    const existing = state.goals.flatMap(goal => goal.missions).find(item => item.mission_id === mission.mission_id);
    if (!existing || !sameRequestedMission(existing, mission)) throw new Error(`operation_id reused with different payload: ${command.operation_id}`);
    return { replayed: true, state };
  }
  let created;
  if (mission.worktree === undefined || mission.worktree === null) created = await prepareMissionWorktree(mission.mission_id, root);
  const prepared = { ...command, payload: { ...command.payload, mission: { ...mission, worktree: mission.worktree ?? created.path, base_revision: mission.base_revision ?? created.base } } };
  try { return await transactOrchestrator(prepared, root); }
  catch (error) {
    if (created) rollbackMissionWorktree(created.path, root, true);
    throw error;
  }
}

export async function submitWorkerReport(command, root = process.cwd(), environment = process.env) {
  const state = await readOrchestratorState(root);
  if (state.transactions.some(item => item.operation_id === command.operation_id)) return transactOrchestrator(command, root);
  const missionId = command.payload?.mission_id;
  if (environment.CTXROUTE_AGENT_ROLE === 'worker' && environment.CTXROUTE_MISSION_ID !== missionId) throw new Error('worker may submit only its assigned mission report');
  const mission = state.goals.flatMap(goal => goal.missions).find(item => item.mission_id === missionId);
  if (!mission) throw new Error(`unknown mission: ${missionId}`);
  if (mission.worktree) {
    const inspection = inspectMissionChanges(mission.worktree, mission.file_scope, root, mission.base_revision);
    if (!inspection.ok) throw new Error(`worktree changed files outside mission scope: ${inspection.outsideScope.join(', ')}`);
    const reported = [...(command.payload?.report?.files_touched ?? [])].sort();
    if (JSON.stringify(reported) !== JSON.stringify(inspection.files)) throw new Error('worker report files_touched does not match the worktree diff');
  }
  return transactOrchestrator(command, root);
}

export async function contextQuery(input, root = process.cwd()) {
  return queryCtxroute(input, root);
}

function routeMissingSkill(mission, root) {
  if (!/^[a-z][a-z0-9-]{0,127}$/u.test(String(mission.skill_id))) throw new Error('mission skill_id must be a safe identifier');
  if (existsSync(`${root}/.agents/skills/${mission.skill_id}/SKILL.md`)) return mission;
  if (!existsSync(`${root}/.agents/skills/skill-creator/SKILL.md`)) throw new Error(`selected skill is missing and skill-creator is unavailable: ${mission.skill_id}`);
  return {
    ...mission,
    requested_skill_id: mission.skill_id,
    skill_id: 'skill-creator',
    skill_version: '1.0.0',
    file_scope: [`.agents/skills/${mission.skill_id}/`],
    acceptance: [`Create and validate the missing ${mission.skill_id} skill`, 'Obtain blueprint-audit review'],
    validation_commands: ['node scripts/validate-blueprint-skills.mjs', 'npm run blueprint:review'],
  };
}

function sameRequestedMission(existing, requested) {
  const fields = ['mission_id', 'skill_id', 'skill_version', 'file_scope', 'acceptance', 'validation_commands', 'response_format', 'requested_skill_id'];
  return fields.every(field => JSON.stringify(existing[field]) === JSON.stringify(requested[field]));
}

function assertOrchestratorRole(environment) {
  if (environment.CTXROUTE_AGENT_ROLE === 'worker') throw new Error('workers cannot mutate global orchestrator state');
}
