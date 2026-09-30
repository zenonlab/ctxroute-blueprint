import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../../.github/workflows/deploy-production.yml', import.meta.url));

test('production deployment seals D1 and private R2 retention before the Worker', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const migration = workflow.indexOf('--operation d1-migrate:PUBLIC_DB');
  const bucket = workflow.indexOf('--operation r2-bucket-ensure:tobirink-discovery-audit');
  const lifecycle = workflow.indexOf('--operation r2-lifecycle-set:tobirink-discovery-audit');
  const worker = workflow.indexOf('--operation worker-deploy');
  assert.ok(migration >= 0 && bucket > migration && lifecycle > bucket && worker > lifecycle);
  assert.match(workflow, /d1-migrate:d1:tobirink-public/u);
  assert.match(workflow, /r2-bucket-ensure:r2-bucket:tobirink-discovery-audit/u);
  assert.match(workflow, /r2-lifecycle-set:r2-lifecycle:tobirink-discovery-audit\/provider-audit\/v1\/7d/u);
  assert.match(workflow, /worker-deploy:worker:tobirink-public-api/u);
  assert.match(workflow, /--allow d1:tobirink-public/u);
  assert.match(workflow, /--allow r2-bucket:tobirink-discovery-audit/u);
  assert.match(workflow, /--allow r2-lifecycle:tobirink-discovery-audit\/provider-audit\/v1\/7d/u);
  assert.match(workflow, /--allow worker:tobirink-public-api/u);
});
