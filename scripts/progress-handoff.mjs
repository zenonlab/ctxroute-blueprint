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

export function selectProgressGoal(progress) {
  const unfinished = progress?.goals?.filter(goal => goal.status !== 'DONE') ?? [];
  return unfinished.find(goal => goal.steps.some(step => step.status === 'TODO' || step.status === 'IN_PROGRESS'))
    ?? unfinished.find(isExternallyBlocked)
    ?? unfinished[0];
}
