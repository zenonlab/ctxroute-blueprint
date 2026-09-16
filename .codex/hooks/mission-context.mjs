import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOrchestratorState } from '../../scripts/orchestrator-core.mjs';
import { loadProjectConfig } from '../../.githooks/project-policy.mjs';
import { loadAdrs } from './decision-memory.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function missionContext(missionId = process.env.CTXROUTE_MISSION_ID, projectRoot = root, event = 'SessionStart') {
  const routing = routingContext(projectRoot, event);
  if (!missionId) return routing;
  const state = await readOrchestratorState(projectRoot);
  const mission = state.goals.flatMap(goal => goal.missions).find(item => item.mission_id === missionId);
  if (!mission) return {
    ...routing,
    systemMessage: `Mission ${String(missionId).slice(0, 128)} is not registered; continuing without injected mission context.`,
  };
  const contract = {
    goal_id: foundGoal(state, mission.mission_id)?.goal_id,
    goal_title: foundGoal(state, mission.mission_id)?.title,
    mission_id: mission.mission_id,
    file_scope: mission.file_scope,
    skill_id: mission.skill_id,
    skill_version: mission.skill_version,
    acceptance: mission.acceptance,
    validations: mission.validations,
    response_format: mission.response_format,
    objective: mission.objective,
    dependencies: mission.dependencies,
    acceptance_criteria: mission.acceptance_criteria,
    skill_path: mission.skill_path,
  };
  const routingText = routing.hookSpecificOutput?.additionalContext ?? 'Canonical change routing is unavailable; inspect .project/project-config.json before mutation.';
  const output = {
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: `${routingText}\n\nWorker mission contract (no global history):\n${JSON.stringify(contract, null, 2)}`,
    },
  };
  if (routing.systemMessage) output.systemMessage = routing.systemMessage;
  return output;
}

function foundGoal(state, missionId) {
  return state.goals.find(goal => goal.missions.some(item => item.mission_id === missionId));
}

export function routingContext(projectRoot = root, event = 'SessionStart') {
  const { config, failures } = loadProjectConfig(projectRoot);
  if (failures.length || !config) {
    return { systemMessage: `Session file routing unavailable: ${failures.join(', ') || 'configuration missing'}.` };
  }
  const decisions = loadAdrs(projectRoot);
  const activeDecisions = decisions.filter(adr => !adr.errors.length && !adr.metadata['superseded-by']);
  const invalidDecisions = decisions.filter(adr => adr.errors.length);
  const lines = [
    'Canonical change routing (retain for this session):',
    `- source: ${list(config.directories?.source)}`,
    `- tests: ${list(config.directories?.tests)}`,
    `- generated: ${list(config.directories?.generated)}`,
    `- documentation: ${list(config.documentation?.roots)}`,
    `- architecture: ${list([...(config.architecture?.documents ?? []), ...(config.architecture?.internalDocuments ?? [])])}`,
    `- contracts: ${list(config.contracts?.patterns, 4)}`,
    `- decisions: ${activeDecisions.length} active scoped ADR(s), resolved against exact targets at PreToolUse${invalidDecisions.length ? `; ${invalidDecisions.length} invalid` : ''}`,
    'Declare intended files before mutation; in SWARM_ON route mutating work through orchestrator_run_goal unless execution is explicitly direct. PreToolUse handles prerequisites, PostToolUse audits the completed cumulative diff, and Stop/Git validate the whole change.',
  ];
  return { hookSpecificOutput: { hookEventName: event, additionalContext: lines.join('\n') } };
}

function list(values = [], maximum = 6) {
  if (!values.length) return '(none declared)';
  const shown = values.slice(0, maximum).join(', ');
  return values.length > maximum ? `${shown} (+${values.length - maximum})` : shown;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  missionContext(undefined, root, process.argv[2] ?? 'SessionStart').then(output => { if (output) process.stdout.write(JSON.stringify(output)); }).catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Mission injection failed open: ${error.message}` })));
}
