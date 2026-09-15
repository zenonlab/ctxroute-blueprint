import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderGatewayDriver } from './provider-gateway-driver.mjs';

const organization = 'tobirink';
const secret = '0123456789abcdef0123456789abcdef';

test('the Deno driver exposes only the bounded gateway resources', () => {
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', read: async () => Buffer.from('') });
  assert.deepEqual(driver.listOperations(), [
    { kind: 'gateway-app-create', name: 'gateway-app-create', target: 'deno-app:tobirink-provider-gateway' },
    { kind: 'gateway-database-provision', name: 'gateway-database-provision', target: 'deno-kv:tobirink-provider-gateway-nonces' },
    { kind: 'gateway-database-assign', name: 'gateway-database-assign', target: 'deno-assignment:tobirink-provider-gateway-nonces/tobirink-provider-gateway' },
    { kind: 'gateway-secret-set', name: 'gateway-secret-set', target: 'deno-secret:tobirink-provider-gateway/PROVIDER_GATEWAY_HMAC_KEY' },
    { kind: 'gateway-deploy', name: 'gateway-deploy', target: 'deno-app:tobirink-provider-gateway/production' },
  ]);
  assert.throws(() => driver.resolveOperations(['gateway-delete']), /unsupported-gateway-operation/u);
});

test('inspection is read-only and normalizes the three Deno inventories', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[1] === 'whoami') return '{"subject":"owner"}';
    if (args[1] === 'apps') return '{"apps":[]}';
    return '{"databases":[]}';
  };
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', run });
  assert.deepEqual(await driver.inspect(organization), {
    accountId: organization,
    applications: { apps: [] },
    databases: { databases: [] },
    driverId: 'deno-provider-gateway',
    identity: { subject: 'owner' },
  });
  assert.equal(calls.every(args => !args.includes('create') && !args.includes('provision') && !args.includes('assign')), true);
});

test('preview hashes local source without a provider mutation', async () => {
  const calls = [];
  const driver = createProviderGatewayDriver({
    gatewayDirectory: '/gateway',
    read: async path => Buffer.from(path),
    run: async args => { calls.push(args); return ''; },
  });
  const actions = driver.resolveOperations(['gateway-deploy']);
  const preview = await driver.preview(actions);
  assert.match(preview.artifact.sha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(preview.actions, [{ kind: 'gateway-deploy', target: 'deno-app:tobirink-provider-gateway/production' }]);
  assert.deepEqual(calls, []);
});

test('apply orders creation, KV assignment, secret and production deployment', async () => {
  const calls = [];
  const run = async args => { calls.push(args); return args.includes(secret) ? `configured ${secret}` : 'ok'; };
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', read: async () => Buffer.from(''), run, secret });
  const actions = driver.resolveOperations([
    'gateway-deploy',
    'gateway-secret-set',
    'gateway-database-assign',
    'gateway-database-provision',
    'gateway-app-create',
  ]);
  const result = await driver.apply(actions, { accountId: organization });
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [
    ['deploy', 'create', '.'],
    ['deploy', 'database', 'provision'],
    ['deploy', 'database', 'assign'],
    ['deploy', 'env', 'add'],
    ['deploy', '.', '--json'],
  ]);
  assert.equal(result.some(item => item.output.includes(secret)), false);
});

test('secret mutation fails before Deno when the secret is absent or weak', async () => {
  const calls = [];
  const driver = createProviderGatewayDriver({
    gatewayDirectory: '/gateway',
    read: async () => Buffer.from(''),
    run: async args => { calls.push(args); return ''; },
    secret: 'short',
  });
  const action = driver.resolveOperations(['gateway-secret-set']);
  await assert.rejects(() => driver.apply(action, { accountId: organization }), /invalid-provider-gateway-secret/u);
  assert.deepEqual(calls, []);
});
