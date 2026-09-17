import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareDriver, validateCloudflareConfig } from './cloudflare-driver.mjs';

const config = {
  worker: 'public-api',
  d1: [{ binding: 'CATALOGUE_DB', name: 'public-catalogue' }],
  r2: [{ binding: 'COVERS', name: 'public-covers' }],
  queues: [{ name: 'public-discovery' }, { name: 'public-discovery-dlq' }],
};

test('Queue operations are derived only from checked-in configuration', () => {
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async () => '' });
  assert.deepEqual(driver.listOperations().filter(operation => operation.kind === 'queue-create'), [
    { name: 'queue-create:public-discovery', kind: 'queue-create', target: 'queue:public-discovery' },
    { name: 'queue-create:public-discovery-dlq', kind: 'queue-create', target: 'queue:public-discovery-dlq' },
  ]);
  assert.throws(() => driver.resolveOperations(['queue-create:other']), /unsupported-operation/u);
});

test('Queue deletion is limited to the explicit retired inventory', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    return 'deleted';
  };
  const driver = createCloudflareDriver({ config, retiredQueues: ['retired-jobs'], workerDirectory: '/worker', run });
  assert.deepEqual(driver.listOperations().filter(operation => operation.kind === 'queue-delete'), [
    { name: 'queue-delete:retired-jobs', kind: 'queue-delete', target: 'queue:retired-jobs' },
  ]);
  const actions = driver.resolveOperations(['queue-delete:retired-jobs']);
  assert.deepEqual(await driver.preview(actions), { actions });
  await driver.apply(actions);
  assert.deepEqual(calls, [['queues', 'delete', 'retired-jobs']]);
  assert.throws(() => driver.resolveOperations(['queue-delete:public-discovery']), /unsupported-operation/u);
  assert.throws(() => createCloudflareDriver({ config, retiredQueues: ['public-discovery'], workerDirectory: '/worker' }), /invalid-retired-queue/u);
});

test('Queue inspection is read-only and creation translation is bounded', async () => {
  const calls = [];
  const contexts = [];
  const run = async (args, context) => {
    calls.push(args);
    contexts.push(context);
    if (args[0] === 'whoami') return '{"accounts":[{"id":"account-1"}]}';
    if (args[0] === 'deployments') return '{"versions":[]}';
    if (args[0] === 'd1') return 'No migrations to apply';
    if (args[0] === 'r2') return '{"name":"public-covers"}';
    if (args[0] === 'queues' && args[1] === 'list') return 'existing-queue';
    return 'created';
  };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run });
  const state = await driver.inspect('account-1');
  assert.deepEqual(state.queues, { configured: ['public-discovery', 'public-discovery-dlq'], output: 'existing-queue' });
  assert.equal(contexts[calls.findIndex(args => args[0] === 'queues')].accountId, 'account-1');
  const actions = driver.resolveOperations(['queue-create:public-discovery-dlq', 'queue-create:public-discovery']);
  assert.deepEqual(await driver.preview(actions), { actions });
  await driver.apply(actions);
  assert.deepEqual(calls.slice(-2), [
    ['queues', 'create', 'public-discovery-dlq'],
    ['queues', 'create', 'public-discovery'],
  ]);
  await assert.rejects(() => driver.apply([{ kind: 'queue-create', target: 'queue:other' }]), /unsupported-action/u);
});

test('invalid Queue names fail closed', () => {
  assert.throws(() => validateCloudflareConfig({ ...config, queues: [{ name: 'Public_Discovery' }] }), /invalid-queue-name/u);
  assert.throws(() => validateCloudflareConfig({ ...config, queues: [{ name: 'a'.repeat(64) }] }), /invalid-queue-name/u);
});
