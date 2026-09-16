import { currentSwarmMode } from '../../scripts/orchestrator-core.mjs';

let input = {};
try { input = JSON.parse(await stdin()); } catch { process.exit(0); }
const tool = String(input.tool_name ?? '');
if (!/^(?:apply_patch|Edit|Write|exec_command|Bash|Shell)$/u.test(tool)) process.exit(0);
try {
  const { mode } = await currentSwarmMode();
  const command = String(input.tool_input?.cmd ?? input.tool_input?.command ?? '');
  const orchestrated = process.env.CTXROUTE_MISSION_ID || /orchestrator(?::run-goal|_run_goal)|orchestrator-cli\.mjs\s+(?:run-goal|orchestrator_run_goal)/u.test(command);
  const direct = input.tool_input?.execution === 'direct';
  if (mode === 'SWARM_ON' && !orchestrated && !direct) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: 'SWARM_ON mutation has no active goal or mission. Route the bounded objective through orchestrator_run_goal; use execution: direct or SWARM_OFF only as an explicit bypass.' }));
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ systemMessage: `Goal ownership check failed open: ${error.message}` }));
}

async function stdin() { let value = ''; process.stdin.setEncoding('utf8'); for await (const chunk of process.stdin) value += chunk; return value || '{}'; }
