import { currentSwarmMode } from '../../scripts/orchestrator-core.mjs';

try {
  const { mode } = await currentSwarmMode();
  if (mode === 'SWARM_ON') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'SWARM_ON: synthesize a bounded operational objective and acceptance criteria for every mutating request, then call orchestrator_run_goal. Do not persist the raw prompt or conversation history. SWARM_OFF and an explicit execution: direct are the only bypasses.' } }));
} catch (error) {
  process.stdout.write(JSON.stringify({ systemMessage: `Goal routing failed open: ${error.message}` }));
}
