import { readFile } from 'node:fs/promises';
import { bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { commitMission, contextQuery, explainExecution, integrateMission, listOperatingModes, mutateCoordination, pendingDecisions, prepareMission, promoteExperiment, purgeWorktree, readCoordination, reconcileWorktrees, resolveDecision, rollbackMission, setOperatingMode, submitWorkerReport } from './orchestrator-service.mjs';
import { runGoalMissions } from './orchestrator-runner.mjs';

const [command, argument] = process.argv.slice(2);
try {
  let result;
  if (command === 'doctor') {
    result = await bootstrapOrchestrator();
    if (result.status === 'BLOCKED') process.exitCode = 2;
  }
  else if (command === 'read') { await bootstrapOrchestrator(); result = await readCoordination(); }
  else if (command === 'modes') result = listOperatingModes();
  else if (command === 'pending-decisions') { await bootstrapOrchestrator(); result = await pendingDecisions(); }
  else if (command === 'run') {
    const args = process.argv.slice(3);
    const goalIndex = args.indexOf('--goal-id');
    const adapterIndex = args.indexOf('--adapter');
    if (goalIndex < 0 || !args[goalIndex + 1]) throw new Error('run requires --goal-id <id>');
    result = await runGoalMissions(args[goalIndex + 1], adapterIndex < 0 ? 'codex' : args[adapterIndex + 1]);
  }
  else {
    if (!argument) throw new Error(`${command ?? 'command'} requires a JSON input file`);
    const input = JSON.parse(await readFile(argument, 'utf8'));
    if (command === 'mutate') result = await mutateCoordination(input);
    else if (command === 'set-mode') result = await setOperatingMode(input, process.cwd(), { ...process.env, CTXROUTE_CONTROL_CHANNEL: 'cli' });
    else if (command === 'explain-execution') result = await explainExecution(input);
    else if (command === 'resolve-decision') result = await resolveDecision({ ...input, receipt: { ...input.receipt, resolved_via: 'cli' } });
    else if (command === 'promote-experiment') result = await promoteExperiment(input);
    else if (command === 'prepare-mission') result = await prepareMission(input);
    else if (command === 'submit-report') result = await submitWorkerReport(input);
    else if (command === 'commit-mission') result = await commitMission(input);
    else if (command === 'integrate-mission') result = await integrateMission(input);
    else if (command === 'reconcile-worktrees') result = await reconcileWorktrees(input);
    else if (command === 'rollback-mission') result = await rollbackMission(input);
    else if (command === 'purge-worktree') result = await purgeWorktree(input);
    else if (command === 'context') result = await contextQuery(input);
    else throw new Error('usage: doctor | read | run --goal-id <id> [--adapter codex|claude|opencode] | modes | pending-decisions | mutate | set-mode | explain-execution | resolve-decision | promote-experiment | prepare-mission | submit-report | commit-mission | integrate-mission | reconcile-worktrees | rollback-mission | purge-worktree | context <input.json>');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
