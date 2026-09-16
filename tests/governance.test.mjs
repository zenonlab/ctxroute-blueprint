import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, validateGovernancePolicy } from '../scripts/agent-governance.mjs';

test('governance policy is complete and non-overlapping', () => {
  assert.deepEqual(validateGovernancePolicy(), []);
  assert.equal(decide('context.scope').decision, 'ALWAYS');
  for (const action of ['routing.change', 'middleware.change', 'audit.emit', 'validate.before_mutate']) {
    assert.equal(decide(action).decision, 'ALWAYS');
    assert.equal(decide(action).requiresApproval, false);
    assert.equal(decide(action).allowed, true);
  }
  assert.equal(decide('routing.external_change').requiresApproval, true);
  assert.equal(decide('routing.external_change').allowed, false);
  assert.equal(decide('routing.external_change', { approved: true }).allowed, true);
  assert.equal(decide('memory.persist').requiresApproval, true);
  assert.equal(decide('secret.exfiltration').decision, 'NEVER');
  assert.equal(decide('unknown.action').decision, 'ASK');
});
