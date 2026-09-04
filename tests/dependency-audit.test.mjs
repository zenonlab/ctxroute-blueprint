import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAuditResult } from '../scripts/dependency-audit.mjs';

test('dependency audit distinguishes findings from registry failures', () => {
  const clean = classifyAuditResult({ status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 1, moderate: 2, high: 0, critical: 0, total: 3 } } }) });
  assert.equal(clean.ok, true);
  assert.equal(clean.infrastructureFailure, false);
  const vulnerable = classifyAuditResult({ status: 1, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 2, critical: 1 } } }) });
  assert.equal(vulnerable.ok, false);
  assert.equal(vulnerable.blocking, 3);
  assert.equal(vulnerable.infrastructureFailure, false);
  assert.deepEqual(classifyAuditResult({ timedOut: true, stdout: '' }), { ok: false, infrastructureFailure: true, message: 'npm audit timed out' });
  assert.equal(classifyAuditResult({ status: 1, stdout: '{"error":{"summary":"registry unavailable"}}' }).infrastructureFailure, true);
});
