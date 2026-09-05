import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { progressNext, readProgress } from '../../scripts/progress-core.mjs';

const MAX_CONTEXT_LENGTH = 600;

export async function progressContext(root = process.cwd(), event = 'SessionStart') {
  const progress = await readProgress(root);
  const active = progress.goals.filter(goal => goal.status !== 'DONE' && goal.steps.some(step => step.status === 'TODO' || step.status === 'IN_PROGRESS')).slice(0, 1);
  if (!active.length) return null;
  const goals = active.map(goal => {
    const state = progressNext(progress, goal.id);
    const next = state.next[0] ?? state.blocked[0];
    return next ? `${goal.id} (${goal.executionMode}): ${next.stepId} — ${next.title} [${next.status}]` : `${goal.id} (${goal.executionMode})`;
  });
  const additionalContext = [
    'Progress is advisory memory, never a permission gate. Continue already-authorized work without asking for another go.',
    ...goals,
    'Use progress-worker without asking only for 2+ genuinely independent claimable milestones; otherwise work directly. Inspect MCP/CLI only when more detail or a mutation is useful.',
  ].join('\n').slice(0, MAX_CONTEXT_LENGTH);
  return { hookSpecificOutput: { hookEventName: event, additionalContext } };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const result = await progressContext(process.cwd(), process.argv[2]);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch (error) {
    const safe = String(error.message).replace(/[\r\n]+/gu, ' ').slice(0, 240);
    process.stdout.write(JSON.stringify({ systemMessage: `Progress context failed open: ${safe}` }));
  }
}
