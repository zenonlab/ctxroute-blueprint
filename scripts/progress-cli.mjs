import { open } from 'node:fs/promises';
import { LIMITS, MANUAL_REASONS, archiveCompletedProgressGoals, ensureProgressView, validatePlan, approvePlan, progressStatus, progressNext, progressMutationResult, claimProgressTicket, updateProgressStep, setProgressMode } from './progress-core.mjs';
import { closeProgressDashboard } from './progress-dashboard-manager.mjs';
const [command, file, arg, reason] = process.argv.slice(2);
try {
  if (command === 'dashboard-close') console.log(JSON.stringify(await closeProgressDashboard()));
  else {
    const current = await ensureProgressView();
    if (command === 'read') console.log(JSON.stringify(current));
    else if (command === 'archive-completed') { const archived = await archiveCompletedProgressGoals(); console.log(JSON.stringify({ ok: true, archived: archived.archived, remaining: archived.remaining })); }
    else if (command === 'status') console.log(JSON.stringify(progressStatus(current)));
    else if (command === 'next') { const goalId = file ?? current.goals.find(goal => goal.status !== 'DONE')?.id; if (!goalId) throw new Error('usage: next <goal-id>'); console.log(JSON.stringify(progressNext(current, goalId))); }
    else if (command === 'claim') console.log(JSON.stringify(await claimProgressTicket(file, arg)));
    else if (command === 'update') { const input = await readBoundedJson(file); if (!input.agentId || !['BLOCKED', 'DONE'].includes(input.status) || !Array.isArray(input.evidence) || !input.evidence.length) throw new Error('agent update requires agentId, final status BLOCKED or DONE, and evidence'); console.log(JSON.stringify(progressMutationResult(await updateProgressStep(input), input.goalId, input.stepId))); }
    else if (command === 'mode') { if (arg === 'manual' && !MANUAL_REASONS.includes(reason)) throw new Error('manual mode requires reason visual-review or important-decision'); console.log(JSON.stringify(progressMutationResult(await setProgressMode(file, arg, reason), file))); }
    else if (command === 'validate-plan') { const result = validatePlan(await readBoundedJson(file), current); console.log(JSON.stringify({ ok: result.ok, errors: result.errors, warnings: result.warnings })); if (!result.ok) process.exitCode = 1; }
    else if (command === 'approve-plan') { const input = await readBoundedJson(file); console.log(JSON.stringify(progressMutationResult(await approvePlan(input), input.goalId ?? input.id))); }
    else throw new Error('usage: read | status | archive-completed | next <goal-id> | claim <agent-id> [goal-id] | update <update.json> | mode <goal-id> automatic | mode <goal-id> manual <visual-review|important-decision> | validate-plan <plan.json> | approve-plan <plan.json> | dashboard-close');
  }
} catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }

async function readBoundedJson(path) {
  const handle = await open(path, 'r');
  try {
    if ((await handle.stat()).size > LIMITS.transportBytes) throw new Error(`input exceeds ${LIMITS.transportBytes} bytes`);
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
