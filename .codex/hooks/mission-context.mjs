import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOrchestratorState } from '../../scripts/orchestrator-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function missionContext(missionId = process.env.CTXROUTE_MISSION_ID, projectRoot = root) {
  if (!missionId) return null;
  const state = await readOrchestratorState(projectRoot);
  const mission = state.goals.flatMap(goal => goal.missions).find(item => item.mission_id === missionId);
  if (!mission) return { systemMessage: `Mission ${String(missionId).slice(0, 128)} is not registered; continuing without injected context.` };
  const contract = {
    mission_id: mission.mission_id,
    file_scope: mission.file_scope,
    skill_id: mission.skill_id,
    skill_version: mission.skill_version,
    acceptance: mission.acceptance,
    validation_commands: mission.validation_commands,
    response_format: mission.response_format,
  };
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Worker mission contract (no global history):\n${JSON.stringify(contract, null, 2)}` } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  missionContext().then(output => { if (output) process.stdout.write(JSON.stringify(output)); }).catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Mission injection failed open: ${error.message}` })));
}
