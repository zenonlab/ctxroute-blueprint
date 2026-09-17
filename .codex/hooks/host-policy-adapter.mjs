export function adaptHostDecision(host, event, decision) {
  if (!['codex', 'claude'].includes(host)) throw new TypeError(`unsupported hook host: ${host}`);
  if (decision.kind === 'failure') return { exitCode: 2, stdout: '', stderr: decision.diagnostic ?? 'Hook policy failed closed.' };
  if (decision.kind !== 'block') return { exitCode: 0, stdout: decision.output ? JSON.stringify(decision.output) : '', stderr: '' };
  const reason = formatBlockReason(decision);
  if (host === 'claude') {
    const output = event === 'Stop'
      ? { decision: 'block', reason }
      : { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } };
    return { exitCode: 0, stdout: JSON.stringify(output), stderr: '' };
  }
  return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason }), stderr: '' };
}

export function formatBlockReason(decision) {
  return [
    `${decision.mode ?? 'UNKNOWN'} + ${decision.workflow ?? 'UNKNOWN'} + ${decision.stage ?? 'UNKNOWN'} + ${decision.policy_digest ?? 'NO_DIGEST'}`,
    `cause: ${decision.cause ?? 'UNCLASSIFIED'}`,
    `invariant: ${decision.invariant ?? 'policy resolution'}`,
    `continue: ${decision.recovery ?? 'orchestrator_explain_execution'}`,
  ].join('\n');
}
