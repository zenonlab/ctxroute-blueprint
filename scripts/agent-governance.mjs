import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const policyPath = join(dirname(fileURLToPath(import.meta.url)), 'agent-governance.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const decisionNames = ['ASK', 'NEVER', 'ALWAYS'];

export function decide(action, { approved = false } = {}) {
  const decision = decisionNames.find(name => policy.decisions[name].includes(action)) ?? 'ASK';
  return { action, decision, allowed: decision === 'ALWAYS' || (decision === 'ASK' && approved), requiresApproval: decision === 'ASK' };
}

export function validateGovernancePolicy(value = policy) {
  const failures = [];
  if (value.version !== 1) failures.push('version must equal 1');
  for (const name of decisionNames) if (!Array.isArray(value.decisions?.[name])) failures.push(`decisions.${name} must be an array`);
  const seen = new Map();
  for (const name of decisionNames) for (const action of value.decisions?.[name] ?? []) {
    if (seen.has(action)) failures.push(`action ${action} is assigned to both ${seen.get(action)} and ${name}`);
    seen.set(action, name);
  }
  for (const name of ['memory', 'mcpA2a', 'controlLoop', 'infrastructure']) if (value.boundaries?.[name] !== String(value.boundaries?.[name]) || !value.boundaries[name].trim()) failures.push(`boundaries.${name} must be documented`);
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const action = process.argv[2];
  if (!action) { console.error(JSON.stringify({ ok: false, error: 'action is required' })); process.exit(2); }
  const result = decide(action, { approved: process.argv.includes('--approved') });
  console.log(JSON.stringify({ ok: validateGovernancePolicy().length === 0 && result.allowed, ...result }));
  process.exitCode = result.allowed ? 0 : result.decision === 'NEVER' ? 2 : 1;
}
