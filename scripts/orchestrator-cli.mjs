import { readFile } from 'node:fs/promises';
import { contextQuery, mutateCoordination, prepareMission, purgeWorktree, readCoordination, reconcileWorktrees, rollbackMission, submitWorkerReport } from './orchestrator-service.mjs';

const [command, argument] = process.argv.slice(2);
try {
  let result;
  if (command === 'read') result = await readCoordination();
  else {
    if (!argument) throw new Error(`${command ?? 'command'} requires a JSON input file`);
    const input = JSON.parse(await readFile(argument, 'utf8'));
    if (command === 'mutate') result = await mutateCoordination(input);
    else if (command === 'prepare-mission') result = await prepareMission(input);
    else if (command === 'submit-report') result = await submitWorkerReport(input);
    else if (command === 'reconcile-worktrees') result = await reconcileWorktrees(input);
    else if (command === 'rollback-mission') result = await rollbackMission(input);
    else if (command === 'purge-worktree') result = await purgeWorktree(input);
    else if (command === 'context') result = await contextQuery(input);
    else throw new Error('usage: read | mutate | prepare-mission | submit-report | reconcile-worktrees | rollback-mission | purge-worktree | context <input.json>');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
