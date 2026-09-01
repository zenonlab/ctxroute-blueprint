import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRESS_TOOL_NAMES } from '../scripts/progress-mcp.mjs';
import { validatePlan } from '../scripts/progress-core.mjs';

test('MCP publishes the four progress tool names and shares the core contract', () => {
  assert.deepEqual([...PROGRESS_TOOL_NAMES].sort(), ['progress_approve_plan', 'progress_read', 'progress_status', 'progress_validate_plan']);
  const plan = { goalId: 'goal-9', title: 'Checklist', validationEvidence: ['tests/progress-core.test.mjs'], steps: [{ id: 'step-1', title: 'Define', acceptance: ['Schema'], files: ['.project/progress.json'], commands: ['npm test'] }] };
  assert.equal(validatePlan(plan).ok, true);
});
