import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, validateGovernancePolicy } from '../scripts/agent-governance.mjs';

test('governance policy is complete and non-overlapping', () => {
  assert.deepEqual(validateGovernancePolicy(), []);
  assert.equal(decide('context.scope').decision, 'ALWAYS');
  assert.equal(decide('routing.change').requiresApproval, true);
  assert.equal(decide('routing.change').allowed, false);
  assert.equal(decide('routing.change', { approved: true }).allowed, true);
  assert.equal(decide('secret.exfiltration').decision, 'NEVER');
  assert.equal(decide('unknown.action').decision, 'ASK');
});
