export function hasNextStepHandoff(message, steps) {
  if (typeof message !== 'string' || !message.trim() || !Array.isArray(steps) || steps.length === 0) return false;
  const normalized = message.toLocaleLowerCase('fr');
  return steps.every(step => normalized.includes(step.stepId.toLocaleLowerCase('fr')) || normalized.includes(step.title.toLocaleLowerCase('fr')));
}

export function hasAutonomousOffer(message) {
  return typeof message === 'string' && /mode\s+(?:automatique|autonome)|autonomous\s+mode/iu.test(message);
}

export function isExternallyBlocked(goal) {
  const remaining = goal?.steps?.filter(step => step.status !== 'DONE') ?? [];
  return remaining.length > 0 && remaining.every(step => step.status === 'BLOCKED');
}
