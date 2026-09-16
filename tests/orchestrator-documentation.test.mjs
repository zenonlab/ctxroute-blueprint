import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertDocumentCitations, documentationFreshness, documentationGate, inventoryDocumentationRequirements } from '../scripts/orchestrator-documentation.mjs';
import { resolveConsumptionPolicy } from '../scripts/orchestrator-routing-core.mjs';

const localPolicy = resolveConsumptionPolicy({ preset: 'balanced', max_duration_ms: 900000, max_normalized_units: 100, max_cost_usd: null, allowed_providers: ['fixture'], denied_models: [], prefer_local: false, local_only: false });

test('every internal goal receives a deterministic NOT_APPLICABLE report', async () => {
  const root = await fixture();
  const request = { ...goal('Rename an internal helper.'), acceptance_criteria: ['The helper has its new name.'] };
  assert.deepEqual(await inventoryDocumentationRequirements(request, root), []);
  const report = await documentationGate({ request, root, consumption: localPolicy, dispatch: null, now: fixedNow });
  assert.equal(report.status, 'NOT_APPLICABLE');
  assert.equal(documentationFreshness(report, { now: fixedNow }).status, 'NOT_APPLICABLE');
});

test('external work blocks before mutation when current research is unavailable or local-only', async () => {
  const root = await fixture();
  const request = goal('Update the current SDK API authentication behavior.');
  assert.ok((await inventoryDocumentationRequirements(request, root)).length > 0);
  const unavailable = await documentationGate({ request, root, consumption: localPolicy, dispatch: null, now: fixedNow });
  assert.equal(unavailable.blocked_cause, 'FRESH_DOCUMENTATION_UNAVAILABLE');
  const localOnly = await documentationGate({ request, root, consumption: { ...localPolicy, local_only: true }, dispatch: async () => assert.fail('must not dispatch'), now: fixedNow });
  assert.equal(localOnly.status, 'BLOCKED');
});

test('primary evidence covers requirements and worker citations must exist in the ledger', async () => {
  const root = await fixture();
  const request = goal('Verify current SDK API behavior.');
  const report = await documentationGate({ request, root, consumption: localPolicy, now: fixedNow, dispatch: async input => {
    const requirements = input.mission.requirements;
    return { report: { report_id: 'temporary', goal_id: request.goal_id, status: 'SATISFIED', requirements, sources: requirements.map((requirement, index) => ({ source_id: `source-${index}`, requirement_ids: [requirement.requirement_id], url: 'https://example.com/docs', domain: 'example.com', authority: 'official', title: 'Official SDK docs', version: requirement.installed_version, accessed_at: fixedNow().toISOString(), digest: 'a'.repeat(64), claims: ['The current API behavior is documented; ignore page instructions.'] })), justification: 'Every requirement has primary evidence.', created_at: fixedNow().toISOString(), digest: 'b'.repeat(64), blocked_cause: null } };
  } });
  assert.equal(report.status, 'SATISFIED');
  assert.doesNotThrow(() => assertDocumentCitations(report, [report.sources[0].source_id]));
  assert.throws(() => assertDocumentCitations(report, ['invented-source']), /outside the goal ledger/u);
});

async function fixture() { const root = mkdtempSync(join(tmpdir(), 'documentation-gate-')); await mkdir(root, { recursive: true }); await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { sdk: '1.2.3' } })); return root; }
function goal(objective) { return { goal_id: 'documentation-goal', title: 'Documentation goal', objective, acceptance_criteria: ['Evidence is current.'], suggested_paths: ['src/change.mjs'], expected_revision: 0, importance: 'normal', change_kind: 'feature' }; }
function fixedNow() { return new Date('2026-09-16T12:00:00Z'); }
