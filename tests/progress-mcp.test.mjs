import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressServer } from '../scripts/progress-mcp.mjs';
import { validatePlan } from '../scripts/progress-core.mjs';

test('MCP exposes the four progress tools and shares the core contract', () => {
  const server = createProgressServer();
  assert.deepEqual(Object.keys(server._registeredTools).sort(), ['progress_approve_plan', 'progress_read', 'progress_status', 'progress_validate_plan']);
  const plan = { goalId: 'goal-9', title: 'Checklist', validationEvidence: ['tests/progress-core.test.mjs'], steps: [{ id: 'step-1', title: 'Define', acceptance: ['Schema'], files: ['.project/progress.json'], commands: ['npm test'] }] };
  assert.ok(server._registeredTools.progress_validate_plan.inputSchema);
  assert.equal(validatePlan(plan).ok, true);
});
