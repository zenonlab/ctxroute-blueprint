import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCoordination } from '../../scripts/orchestrator-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export async function missionContext(missionId = process.env.CTXROUTE_MISSION_ID, projectRoot = root) {
  if (!missionId) return null;
  try {
    const view = await readCoordination(projectRoot, { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: missionId, CTXROUTE_SESSION_ID: process.env.CTXROUTE_SESSION_ID });
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `Worker MissionView (no global history):\n${JSON.stringify(view, null, 2)}` } };
  } catch (error) {
    return { systemMessage: `Mission ${String(missionId).slice(0, 128)} is unavailable (${error.causeCode ?? 'MISSION_VIEW_INVALID'}); continuing without injected context.` };
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  missionContext().then(output => { if (output) process.stdout.write(JSON.stringify(output)); }).catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Mission injection failed open: ${error.message}` })));
}
