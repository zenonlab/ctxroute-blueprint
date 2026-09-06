import { readFile } from 'node:fs/promises';
import { contextQuery, mutateCoordination, prepareMission, readCoordination, submitWorkerReport } from './orchestrator-service.mjs';

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
    else if (command === 'context') result = await contextQuery(input);
    else throw new Error('usage: read | mutate <transaction.json> | prepare-mission <transaction.json> | submit-report <transaction.json> | context <query.json>');
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
}
