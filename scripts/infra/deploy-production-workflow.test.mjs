import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(new URL('../../.github/workflows/deploy-production.yml', import.meta.url));

test('production deployment seals the D1 migration before the Worker', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const migration = workflow.indexOf('--operation d1-migrate:PUBLIC_DB');
  const worker = workflow.indexOf('--operation worker-deploy');
  assert.ok(migration >= 0 && migration < worker);
  assert.match(workflow, /d1-migrate:d1:tobirink-public/u);
  assert.match(workflow, /worker-deploy:worker:tobirink-public-api/u);
  assert.match(workflow, /--allow d1:tobirink-public/u);
  assert.match(workflow, /--allow worker:tobirink-public-api/u);
});
