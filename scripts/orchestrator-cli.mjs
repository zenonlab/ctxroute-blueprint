import { readFile } from 'node:fs/promises';
import { bootstrapOrchestrator } from './orchestrator-bootstrap.mjs';
import { contextQuery, mutateCoordination, prepareMission, purgeWorktree, readCoordination, reconcileWorktrees, rollbackMission, submitWorkerReport } from './orchestrator-service.mjs';
import { runGoal } from './orchestrator-goal.mjs';
import { explainOrchestratorRoute, orchestratorModelEvaluations, orchestratorModels, orchestratorUsage, refreshOrchestratorDocumentation } from './orchestrator-routing-service.mjs';

const [command, argument] = process.argv.slice(2);
try {
  let result;
  if (command === 'doctor') {
    result = await bootstrapOrchestrator();
    if (result.status === 'BLOCKED') process.exitCode = 2;
  }
  else if (command === 'read') { await bootstrapOrchestrator(); result = await readCoordination(); }
  else if (command === 'models') result = await orchestratorModels();
  else if (command === 'model-evaluations') result = await orchestratorModelEvaluations();
  else {
    if (!argument) throw new Error(`${command ?? 'command'} requires a JSON input file`);
    const input = JSON.parse(await readFile(argument, 'utf8'));
    if (command === 'mutate') result = await mutateCoordination(input);
    else if (command === 'run-goal' || command === 'orchestrator_run_goal') result = await runGoal(input);
    else if (command === 'prepare-mission') result = await prepareMission(input);
    else if (command === 'submit-report') result = await submitWorkerReport(input);
    else if (command === 'reconcile-worktrees') result = await reconcileWorktrees(input);
    else if (command === 'rollback-mission') result = await rollbackMission(input);
    else if (command === 'purge-worktree') result = await purgeWorktree(input);
    else if (command === 'context') result = await contextQuery(input);
    else if (command === 'explain-route') result = await explainOrchestratorRoute(input);
    else if (command === 'usage') result = await orchestratorUsage(input.goal_id);
    else if (command === 'refresh-documentation') result = await refreshOrchestratorDocumentation(input);
    else throw new Error('usage: doctor | read | mutate | run-goal | prepare-mission | submit-report | reconcile-worktrees | rollback-mission | purge-worktree | context | models | explain-route | usage | refresh-documentation | model-evaluations <input.json>');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
