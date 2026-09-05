import { readFile } from 'node:fs/promises';
import { readProgress, validatePlan, approvePlan, progressStatus, progressNext, updateProgressStep, setProgressMode } from './progress-core.mjs';
const [command, file, arg] = process.argv.slice(2);
try {
  const current = await readProgress();
  if (command === 'read') console.log(JSON.stringify(current, null, 2));
  else if (command === 'status') console.log(JSON.stringify(progressStatus(current), null, 2));
  else if (command === 'next') { const goalId = file ?? current.goals.find(goal => goal.status !== 'DONE')?.id; if (!goalId) throw new Error('usage: next <goal-id>'); console.log(JSON.stringify(progressNext(current, goalId), null, 2)); }
  else if (command === 'update') console.log(JSON.stringify({ ok: true, progress: await updateProgressStep(JSON.parse(await readFile(file, 'utf8'))) }, null, 2));
  else if (command === 'mode') console.log(JSON.stringify({ ok: true, progress: await setProgressMode(file, arg, arg === 'autonomous' ? true : true) }, null, 2));
  else if (command === 'validate-plan') { const result = validatePlan(JSON.parse(await readFile(file, 'utf8')), current); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }
  else if (command === 'approve-plan') console.log(JSON.stringify({ ok: true, progress: await approvePlan(JSON.parse(await readFile(file, 'utf8'))) }, null, 2));
  else throw new Error('usage: read | status | next <goal-id> | update <update.json> | mode <goal-id> <collaborative|autonomous> | validate-plan <plan.json> | approve-plan <plan.json>');
} catch (error) { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; }
