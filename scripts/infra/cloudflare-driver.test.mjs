import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createCloudflareDriver, loadCloudflareConfig } from './cloudflare-driver.mjs';

const config = {
  worker: 'public-api',
  d1: [{ binding: 'CATALOGUE_DB', name: 'public-catalogue' }],
  r2: [{ binding: 'COVERS', name: 'public-covers' }],
};

test('the driver derives operation targets from configuration', () => {
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async () => '' });
  assert.deepEqual(driver.listOperations(), [
    { name: 'worker-deploy', kind: 'worker-deploy', target: 'worker:public-api' },
    { name: 'd1-migrate:CATALOGUE_DB', kind: 'd1-migrate', target: 'd1:public-catalogue' },
  ]);
});

test('inspect uses read-only Wrangler commands and returns normalized resources', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[0] === 'whoami') return '{"accounts":[{"id":"account-1"}]}';
    if (args[0] === 'deployments') return '{"versions":[]}';
    if (args[0] === 'd1') return 'No migrations to apply';
    return '{"name":"public-covers"}';
  };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run });
  const state = await driver.inspect('account-1');
  assert.equal(state.accountId, 'account-1');
  assert.deepEqual(state.migrations, [{ binding: 'CATALOGUE_DB', name: 'public-catalogue', output: 'No migrations to apply' }]);
  assert.deepEqual(calls, [
    ['whoami', '--account', 'account-1', '--json'],
    ['deployments', 'status', '--name', 'public-api', '--json'],
    ['d1', 'migrations', 'list', 'CATALOGUE_DB', '--remote'],
    ['r2', 'bucket', 'info', 'public-covers', '--json'],
  ]);
  assert.equal(calls.some(args => args.includes('apply') || args[0] === 'deploy'), false);
});

test('preview is dry-run and apply owns the only mutating Wrangler translations', async () => {
  const calls = [];
  const run = async args => { calls.push(args); return args.includes('--dry-run') ? 'bundle preview' : 'applied'; };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run });
  const actions = driver.resolveOperations(['worker-deploy', 'd1-migrate:CATALOGUE_DB']);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview, {
    worker: 'bundle preview',
    actions: [
      { kind: 'worker-deploy', target: 'worker:public-api' },
      { kind: 'd1-migrate', target: 'd1:public-catalogue' },
    ],
  });
  assert.deepEqual(calls, [['deploy', '--dry-run']]);
  calls.length = 0;
  await driver.apply(preview.actions);
  assert.deepEqual(calls, [
    ['d1', 'migrations', 'apply', 'CATALOGUE_DB', '--remote'],
    ['deploy'],
  ]);
});

test('unknown operations and actions fail before invoking Wrangler', async () => {
  const calls = [];
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async args => { calls.push(args); return ''; } });
  assert.throws(() => driver.resolveOperations(['r2-delete']), /unsupported-operation/u);
  await assert.rejects(() => driver.apply([{ kind: 'worker-deploy', target: 'worker:other' }]), /unsupported-action/u);
  assert.deepEqual(calls, []);
});

test('the checked-in Wrangler config is the single resource source', async () => {
  const path = fileURLToPath(new URL('../../apps/worker/wrangler.jsonc', import.meta.url));
  assert.deepEqual(await loadCloudflareConfig(path), {
    worker: 'tobirink-public-api',
    d1: [{ binding: 'COLLECTIVE_DB', name: 'tobirink-public' }],
    r2: [
      { binding: 'COVER_BUCKET', name: 'tobirink-covers' },
      { binding: 'RELEASE_SNAPSHOTS', name: 'tobirink-public-releases' },
    ],
  });
});
