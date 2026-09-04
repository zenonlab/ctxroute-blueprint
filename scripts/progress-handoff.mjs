export function hasNextStepHandoff(message, steps) {
  if (message !== String(message) || !message.trim() || !Array.isArray(steps) || steps.length === 0) return false;
  const normalized = message.toLocaleLowerCase('fr');
  return steps.every(step => normalized.includes(step.stepId.toLocaleLowerCase('fr')) || normalized.includes(step.title.toLocaleLowerCase('fr')));
}

export function hasAutonomousOffer(message) {
  return message === String(message) && /mode\s+(?:automatique|autonome)|autonomous\s+mode/iu.test(message);
}

export function isExternallyBlocked(goal) {
  const remaining = goal?.steps?.filter(step => step.status !== 'DONE') ?? [];
  return remaining.length > 0 && remaining.every(step => step.status === 'BLOCKED' && step.evidence?.some(item => /^external:/iu.test(item)));
}

export function isFullyBlocked(goal) {
  const remaining = goal?.steps?.filter(step => step.status !== 'DONE') ?? [];
  return remaining.length > 0 && remaining.every(step => step.status === 'BLOCKED');
}

export function selectProgressGoal(progress, message = '') {
  const unfinished = progress?.goals?.filter(goal => goal.status !== 'DONE') ?? [];
  const runnable = unfinished.filter(goal => goal.steps.some(step => step.status === 'TODO' || step.status === 'IN_PROGRESS'));
  if (runnable.length === 1) return runnable[0];
  if (runnable.length > 1) return referencedGoal(runnable, message);
  return unfinished.find(isExternallyBlocked) ?? unfinished[0];
}

function referencedGoal(goals, message) {
  if (message !== String(message) || !message.trim()) return undefined;
  const normalized = message.toLocaleLowerCase('fr');
  const stepIdCounts = new Map();
  for (const goal of goals) for (const step of goal.steps) stepIdCounts.set(step.id, (stepIdCounts.get(step.id) ?? 0) + 1);
  const matches = goals.filter(goal => {
    if (normalized.includes(goal.id.toLocaleLowerCase('fr')) || normalized.includes(goal.title.toLocaleLowerCase('fr'))) return true;
    return goal.steps.some(step => normalized.includes(step.title.toLocaleLowerCase('fr'))
      || (stepIdCounts.get(step.id) === 1 && normalized.includes(step.id.toLocaleLowerCase('fr'))));
  });
  return matches.length === 1 ? matches[0] : undefined;
}
