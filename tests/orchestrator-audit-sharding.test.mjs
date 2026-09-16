import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateAuditFindings, partitionAuditTargets } from '../scripts/orchestrator-audit-sharding.mjs';

test('large repetitive audits partition deterministically without overlap', () => {
  const targets = [
    { path: 'api/a.mjs', component: 'api', risk: 'high', context_bytes: 60 },
    { path: 'api/b.mjs', component: 'api', risk: 'normal', context_bytes: 40 },
    { path: 'ui/a.mjs', component: 'ui', risk: 'low', context_bytes: 70 },
    { path: 'ui/b.mjs', component: 'ui', risk: 'normal', context_bytes: 30 },
  ];
  const shards = partitionAuditTargets(targets, 100);
  assert.deepEqual(shards.flatMap(shard => shard.targets.map(target => target.path)).sort(), targets.map(target => target.path).sort());
  assert.ok(shards.every(shard => shard.context_bytes <= 100));
  assert.deepEqual(partitionAuditTargets([...targets].reverse(), 100), shards);
});

test('audit synthesis deduplicates findings deterministically and keeps higher risk', () => {
  const duplicate = { rule_id: 'scope', path: 'api/a.mjs', line: 2, message: 'Unexpected write', risk: 'normal' };
  const findings = deduplicateAuditFindings([duplicate, { ...duplicate, risk: 'high' }, { rule_id: 'docs', path: 'ui/a.mjs', message: 'Missing evidence', risk: 'normal' }]);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].risk, 'high');
});

test('an indivisible target larger than model context is rejected before dispatch', () => {
  assert.throws(() => partitionAuditTargets([{ path: 'huge.mjs', context_bytes: 101 }], 100), /exceeds shard context/u);
});
