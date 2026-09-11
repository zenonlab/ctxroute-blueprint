import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudflareDriver, loadCloudflareConfig, validateCloudflareConfig } from './cloudflare-driver.mjs';

const config = {
  worker: 'public-api',
  d1: [{ binding: 'CATALOGUE_DB', name: 'public-catalogue' }],
  r2: [{ binding: 'COVERS', name: 'public-covers' }],
};
const releaseVersion = '1.0.1';

function test_derive_operation_targets() {
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async () => '' });
  assert.deepEqual(driver.listOperations(), [
    { name: 'worker-deploy', kind: 'worker-deploy', target: 'worker:public-api' },
    { name: 'd1-migrate:CATALOGUE_DB', kind: 'd1-migrate', target: 'd1:public-catalogue' },
  ]);

  const releaseDriver = createCloudflareDriver({
    config: { ...config, r2: [...config.r2, { binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] },
    workerDirectory: '/worker',
    run: async () => '',
  });
  assert.deepEqual(releaseDriver.listOperations().filter(operation => operation.kind === 'r2-publish').map(operation => operation.target), [
    `r2:public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`,
    `r2:public-releases/downloads/tobirink-firefox-mv3-${releaseVersion}.zip`,
  ]);
}

async function test_inspect_read_only_resources() {
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
}

async function test_preview_and_apply_translations() {
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
}

async function test_release_publish_is_hashed_and_translated() {
  const calls = [];
  const releaseConfig = { ...config, r2: [...config.r2, { binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] };
  const driver = createCloudflareDriver({ config: releaseConfig, workerDirectory: '/worker', read: async () => Buffer.from('zip'), run: async args => { calls.push(args); return 'uploaded'; } });
  const actions = driver.resolveOperations([`r2-publish:tobirink-chrome-mv3-${releaseVersion}.zip`]);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview.artifacts, [{
    target: `r2:public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`,
    sha256: '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
    size: 3,
  }]);
  await driver.apply(actions);
  assert.deepEqual(calls, [[
    'r2', 'object', 'put', `public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`,
    '--file', fileURLToPath(new URL(`../../apps/extension/.output/packages/tobirink-chrome-mv3-${releaseVersion}.zip`, import.meta.url)),
    '--content-type', 'application/zip',
    '--content-disposition', `attachment; filename="tobirink-chrome-mv3-${releaseVersion}.zip"`,
    '--cache-control', 'public, max-age=31536000, immutable', '--remote', '--force',
  ]]);
}

async function test_release_snapshot_publication_is_validated_and_ordered() {
  const calls = [];
  const releaseConfig = { ...config, r2: [...config.r2, { binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] };
  const releaseDirectory = resolve('/releases');
  const files = new Map([
    [resolve(releaseDirectory, 'empty-2026-09-09.json'), Buffer.from('{"entries":[],"generatedAt":"2026-09-09T12:00:00.000Z","revision":"empty-2026-09-09"}\n')],
    [resolve(releaseDirectory, 'current-empty-2026-09-09.json'), Buffer.from('{"revision":"empty-2026-09-09"}\n')],
  ]);
  const driver = createCloudflareDriver({
    config: releaseConfig,
    workerDirectory: '/worker',
    releaseDirectory,
    read: async path => files.get(path),
    run: async args => { calls.push(args); return 'uploaded'; },
  });
  const actions = driver.resolveOperations([
    'r2-release-pointer:empty-2026-09-09',
    'r2-release-snapshot:empty-2026-09-09',
  ]);
  assert.deepEqual(actions, [
    { kind: 'r2-release-pointer', target: 'r2:public-releases/releases/current.json' },
    { kind: 'r2-release-snapshot', target: 'r2:public-releases/releases/snapshots/empty-2026-09-09.json' },
  ]);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview.actions, actions);
  assert.equal(preview.artifacts.length, 2);
  await driver.apply(actions);
  assert.deepEqual(calls.map(args => args.slice(0, 4)), [
    ['r2', 'object', 'put', 'public-releases/releases/snapshots/empty-2026-09-09.json'],
    ['r2', 'object', 'put', 'public-releases/releases/current.json'],
  ]);
  assert.ok(calls[0].includes('public, max-age=31536000, immutable'));
  assert.ok(calls[1].includes('no-cache'));
}

async function test_release_snapshot_publication_fails_closed() {
  const releaseConfig = { ...config, r2: [...config.r2, { binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] };
  const driver = createCloudflareDriver({ config: releaseConfig, workerDirectory: '/worker', releaseDirectory: '/releases', read: async () => Buffer.from('{}'), run: async () => '' });
  assert.throws(() => driver.resolveOperations(['r2-release-snapshot:bad/revision', 'r2-release-pointer:bad/revision']), /Invalid string/u);
  assert.throws(() => driver.resolveOperations(['r2-release-snapshot:one', 'r2-release-pointer:two']), /revision-mismatch/u);
  assert.throws(() => driver.resolveOperations(['r2-release-snapshot:one']), /requires-snapshot-and-pointer/u);
  const actions = driver.resolveOperations(['r2-release-snapshot:one', 'r2-release-pointer:one']);
  await assert.rejects(() => driver.preview(actions), /Invalid input/u);
}

async function test_reject_unknown_operations() {
  const calls = [];
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async args => { calls.push(args); return ''; } });
  assert.throws(() => driver.resolveOperations(['r2-delete']), /unsupported-operation/u);
  await assert.rejects(() => driver.apply([{ kind: 'worker-deploy', target: 'worker:other' }]), /unsupported-action/u);
  assert.deepEqual(calls, []);
}

async function test_load_checked_in_config() {
  const path = fileURLToPath(new URL('../../apps/worker/wrangler.jsonc', import.meta.url));
  assert.deepEqual(await loadCloudflareConfig(path), {
    worker: 'tobirink-public-api',
    d1: [{ binding: 'COLLECTIVE_DB', name: 'tobirink-public' }],
    r2: [
      { binding: 'COVER_BUCKET', name: 'tobirink-covers' },
      { binding: 'RELEASE_SNAPSHOTS', name: 'tobirink-public-releases' },
    ],
  });
}

function test_accept_valid_config() {
  assert.doesNotThrow(() => validateCloudflareConfig(config));
}

function test_reject_missing_resource_collections() {
  assert.throws(() => validateCloudflareConfig({ worker: 'public-api' }), /invalid-cloudflare-config/u);
}

function test_reject_invalid_d1_identifiers() {
  assert.throws(() => validateCloudflareConfig({ ...config, d1: [{ binding: '', name: 'public-catalogue' }] }), /invalid-d1-binding/u);
  assert.throws(() => validateCloudflareConfig({ ...config, d1: [{ binding: 'CATALOGUE_DB', name: '' }] }), /invalid-d1-name/u);
}

function test_reject_invalid_r2_identifiers() {
  assert.throws(() => validateCloudflareConfig({ ...config, r2: [{ binding: '', name: 'public-covers' }] }), /invalid-r2-binding/u);
  assert.throws(() => validateCloudflareConfig({ ...config, r2: [{ binding: 'COVERS', name: '' }] }), /invalid-r2-name/u);
}

test('the driver derives operation targets from configuration', test_derive_operation_targets);
test('inspect uses read-only Wrangler commands and returns normalized resources', test_inspect_read_only_resources);
test('preview is dry-run and apply owns the only mutating Wrangler translations', test_preview_and_apply_translations);
test('release publication hashes bytes before translating the bounded R2 upload', test_release_publish_is_hashed_and_translated);
test('release snapshots are schema-validated and uploaded before their pointer', test_release_snapshot_publication_is_validated_and_ordered);
test('release snapshot publication rejects unsafe revisions, mismatches, incomplete pairs and invalid JSON', test_release_snapshot_publication_fails_closed);
test('unknown operations and actions fail before invoking Wrangler', test_reject_unknown_operations);
test('the checked-in Wrangler config is the single resource source', test_load_checked_in_config);
test('the driver accepts a complete provider configuration', test_accept_valid_config);
test('the driver rejects missing resource collections', test_reject_missing_resource_collections);
test('the driver rejects invalid D1 identifiers', test_reject_invalid_d1_identifiers);
test('the driver rejects invalid R2 identifiers', test_reject_invalid_r2_identifiers);
