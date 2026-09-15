import assert from 'node:assert/strict';
import test from 'node:test';
import { createDenoCommandRunner, createProviderGatewayDriver } from './provider-gateway-driver.mjs';

const organization = 'tobirink';
const secret = '0123456789abcdef0123456789abcdef';
const previousSecret = 'abcdef0123456789abcdef0123456789';

test('the Deno driver exposes only the bounded gateway resources', () => {
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', read: async () => Buffer.from('') });
  assert.deepEqual(driver.listOperations(), [
    { kind: 'gateway-app-create', name: 'gateway-app-create', target: 'deno-app:tobirink-provider-gateway' },
    { kind: 'gateway-database-provision', name: 'gateway-database-provision', target: 'deno-kv:tobirink-provider-gateway-nonces' },
    { kind: 'gateway-database-assign', name: 'gateway-database-assign', target: 'deno-assignment:tobirink-provider-gateway-nonces/tobirink-provider-gateway' },
    { kind: 'gateway-secret-set', name: 'gateway-secret-set', target: 'deno-secret:tobirink-provider-gateway/PROVIDER_GATEWAY_HMAC_KEY' },
    { kind: 'gateway-secret-update', name: 'gateway-secret-update', target: 'deno-secret:tobirink-provider-gateway/PROVIDER_GATEWAY_HMAC_KEY' },
    { kind: 'gateway-previous-secret-set', name: 'gateway-previous-secret-set', target: 'deno-secret:tobirink-provider-gateway/PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS' },
    { kind: 'gateway-previous-secret-delete', name: 'gateway-previous-secret-delete', target: 'deno-secret:tobirink-provider-gateway/PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS' },
    { kind: 'gateway-deploy', name: 'gateway-deploy', target: 'deno-app:tobirink-provider-gateway/production' },
  ]);
  assert.throws(() => driver.resolveOperations(['gateway-delete']), /unsupported-gateway-operation/u);
});

test('inspection is read-only and includes secret names without values', async () => {
  const calls = [];
  const run = async args => {
    calls.push(args);
    if (args[1] === 'whoami') return '{"subject":"owner"}';
    if (args[1] === 'apps') return '{"apps":[]}';
    if (args[1] === 'env') return '{"variables":[{"name":"PROVIDER_GATEWAY_HMAC_KEY","secret":true,"value":"must-not-escape"}]}';
    return '{"databases":[]}';
  };
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', run });
  assert.deepEqual(await driver.inspect(organization), {
    accountId: organization,
    applications: { apps: [] },
    databases: { databases: [] },
    driverId: 'deno-provider-gateway',
    environment: { variables: [{ name: 'PROVIDER_GATEWAY_HMAC_KEY', secret: true }] },
    identity: { subject: 'owner' },
  });
  assert.equal(calls.every(args => !args.includes('create') && !args.includes('provision') && !args.includes('assign') && !args.includes('add') && !args.includes('delete')), true);
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
  const run = async (args, options) => { calls.push({ args, options }); return `configured ${secret}`; };
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', read: async () => Buffer.from(''), run, secret });
  const actions = driver.resolveOperations([
    'gateway-deploy',
    'gateway-secret-set',
    'gateway-database-assign',
    'gateway-database-provision',
    'gateway-app-create',
  ]);
  const result = await driver.apply(actions, { accountId: organization });
  assert.deepEqual(calls.map(call => call.args.slice(0, 3)), [
    ['deploy', 'create', '.'],
    ['deploy', 'database', 'provision'],
    ['deploy', 'database', 'assign'],
    ['deploy', 'env', 'load'],
    ['deploy', '.', '--json'],
  ]);
  assert.deepEqual(calls[3]?.options.secretEnvironment, { PROVIDER_GATEWAY_HMAC_KEY: secret });
  assert.equal(calls.every(call => !call.args.includes(secret)), true);
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

test('rotation operations keep both secrets redacted and deletion value-free', async () => {
  const calls = [];
  const run = async (args, options) => { calls.push({ args, options }); return `${secret}:${previousSecret}`; };
  const driver = createProviderGatewayDriver({ gatewayDirectory: '/gateway', previousSecret, read: async () => Buffer.from(''), run, secret });
  const actions = driver.resolveOperations(['gateway-secret-update', 'gateway-previous-secret-set', 'gateway-previous-secret-delete']);
  const result = await driver.apply(actions, { accountId: organization });
  assert.deepEqual(calls.map(call => call.args.slice(0, 5)), [
    ['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__', '--json'],
    ['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__', '--json'],
    ['deploy', 'env', 'delete', 'PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS', '--json'],
  ]);
  assert.deepEqual(calls.map(call => call.options.secretEnvironment), [
    { PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS: previousSecret },
    { PROVIDER_GATEWAY_HMAC_KEY: secret },
    undefined,
  ]);
  assert.equal(result.every(item => !item.output.includes(secret) && !item.output.includes(previousSecret)), true);
  assert.equal(calls.every(call => !call.args.includes(secret) && !call.args.includes(previousSecret)), true);
});

test('previous-secret mutation fails before Deno when its value is absent or weak', async () => {
  const calls = [];
  const driver = createProviderGatewayDriver({
    gatewayDirectory: '/gateway',
    previousSecret: 'short',
    read: async () => Buffer.from(''),
    run: async args => { calls.push(args); return ''; },
    secret,
  });
  await assert.rejects(() => driver.apply(driver.resolveOperations(['gateway-previous-secret-set']), { accountId: organization }), /invalid-provider-gateway-secret/u);
  assert.deepEqual(calls, []);
});

test('the Deno runner keeps one secret in a 0600 temporary file and removes it after success', async () => {
  const writes = [];
  const removals = [];
  const executions = [];
  const runner = createDenoCommandRunner({
    execute: async (command, args) => { executions.push({ args, command }); return { stdout: 'ok' }; },
    makeTemporaryDirectory: async prefix => `${prefix}fixed`,
    removeTemporary: async (path, options) => { removals.push({ options, path }); },
    temporaryDirectory: () => '/private/tmp',
    write: async (path, content, options) => { writes.push({ content, options, path }); },
  });
  assert.equal(await runner(['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__'], {
    cwd: '/gateway',
    secretEnvironment: { PROVIDER_GATEWAY_HMAC_KEY: secret },
  }), 'ok');
  assert.deepEqual(writes, [{
    content: `PROVIDER_GATEWAY_HMAC_KEY=${JSON.stringify(secret)}\n`,
    options: { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    path: '/private/tmp/tobirink-deno-env-fixed/.env',
  }]);
  assert.deepEqual(executions, [{ args: ['deploy', 'env', 'load', '/private/tmp/tobirink-deno-env-fixed/.env'], command: 'deno' }]);
  assert.deepEqual(removals, [{ options: { force: true, recursive: true }, path: '/private/tmp/tobirink-deno-env-fixed' }]);
  assert.equal(JSON.stringify(executions).includes(secret), false);
});

test('the Deno runner removes temporary secrets and returns a redacted error after failure', async () => {
  const removals = [];
  const runner = createDenoCommandRunner({
    execute: async () => { throw new Error(`upstream echoed ${secret}`); },
    makeTemporaryDirectory: async () => '/private/tmp/tobirink-deno-env-failure',
    removeTemporary: async path => { removals.push(path); },
    temporaryDirectory: () => '/private/tmp',
    write: async () => undefined,
  });
  await assert.rejects(
    () => runner(['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__'], { cwd: '/gateway', secretEnvironment: { PROVIDER_GATEWAY_HMAC_KEY: secret } }),
    error => error instanceof Error && error.message === 'deno-provider-command-failed' && !error.message.includes(secret),
  );
  assert.deepEqual(removals, ['/private/tmp/tobirink-deno-env-failure']);
});

test('the Deno runner rejects multi-key and unknown secret files before execution', async () => {
  const executions = [];
  const runner = createDenoCommandRunner({
    execute: async (...args) => { executions.push(args); return { stdout: '' }; },
    makeTemporaryDirectory: async () => '/private/tmp/tobirink-deno-env-invalid',
    removeTemporary: async () => undefined,
    temporaryDirectory: () => '/private/tmp',
    write: async () => undefined,
  });
  await assert.rejects(() => runner(['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__'], {
    secretEnvironment: { PROVIDER_GATEWAY_HMAC_KEY: secret, PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS: previousSecret },
  }), /invalid-provider-gateway-secret-environment/u);
  await assert.rejects(() => runner(['deploy', 'env', 'load', '__TOBIRINK_DENO_SECRET_FILE__'], {
    secretEnvironment: { UNKNOWN_SECRET: secret },
  }), /invalid-provider-gateway-secret-environment/u);
  assert.deepEqual(executions, []);
});

test('rotation rejects duplicate current and previous secrets before Deno', async () => {
  const calls = [];
  const driver = createProviderGatewayDriver({
    gatewayDirectory: '/gateway',
    previousSecret: secret,
    read: async () => Buffer.from(''),
    run: async args => { calls.push(args); return ''; },
    secret,
  });
  await assert.rejects(() => driver.apply(driver.resolveOperations(['gateway-previous-secret-set']), { accountId: organization }), /duplicate-provider-gateway-secret/u);
  assert.deepEqual(calls, []);
});
