import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertExtensionPublicationContext, assertExtensionPublicationPlan, createCloudflareDriver, fingerprintWorkerInputs, loadCloudflareConfig, readExtensionPublicationCandidate, validateCloudflareConfig, verifyExtensionPublication } from './cloudflare-driver.mjs';
import { createOperationPlan } from './provider-gate-core.mjs';

const { Response } = globalThis;

const config = {
  worker: 'public-api',
  d1: [{ binding: 'CATALOGUE_DB', name: 'public-catalogue' }],
  r2: [{ binding: 'COVERS', name: 'public-covers' }],
  queues: [],
};
const extensionRoot = fileURLToPath(new URL('../../apps/extension', import.meta.url));
const releaseVersion = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8')).version;

test('extension publication is disabled for pushes and requires manual main plus canaries', () => {
  assert.equal(assertExtensionPublicationContext({ GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' }), false);
  assert.equal(assertExtensionPublicationContext({ TOBIRINK_PUBLISH_EXTENSION: 'false' }), false);
  const enabled = { TOBIRINK_PUBLISH_EXTENSION: 'true', TOBIRINK_RUN_MANGA_CANARY: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main' };
  assert.equal(assertExtensionPublicationContext(enabled), true);
  for (const patch of [{ GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/other' }, { TOBIRINK_RUN_MANGA_CANARY: 'false' }, { TOBIRINK_RUN_MANGA_CANARY: undefined }]) {
    assert.throws(() => assertExtensionPublicationContext({ ...enabled, ...patch }), /extension-publication-preconditions/u);
  }
});

function extensionCandidateFixture(edit = () => undefined, bytes = Buffer.from('zip')) {
  const manifest = { schemaVersion: 1, version: releaseVersion, siteOrigin: 'https://tobirink.com', artifacts: ['chrome', 'firefox'].map(browser => ({
    artifact: `tobirink-${browser}-mv3-${releaseVersion}.zip`, target: `${browser}-mv3`, version: releaseVersion,
    manifest: { version: releaseVersion }, size: 3, sha256: '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
  })) };
  edit(manifest);
  return { read: async path => path.endsWith('/package.json') ? JSON.stringify({ version: releaseVersion })
    : path.endsWith('/release-manifest.json') ? JSON.stringify(manifest) : bytes };
}

test('extension candidate checks both exact filenames, versions, sizes and local hashes', async () => {
  const candidate = await readExtensionPublicationCandidate(extensionCandidateFixture());
  assert.equal(candidate.artifacts.length, 2);
  assert.equal(candidate.artifacts[0].target, `r2:tobirink-public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`);
  for (const edit of [
    manifest => { manifest.version = '0.0.0'; },
    manifest => { manifest.artifacts[1] = manifest.artifacts[0]; },
    manifest => { manifest.artifacts[0].manifest.version = '0.0.0'; },
    manifest => { manifest.artifacts[0].size = 5 * 1024 * 1024 + 1; },
    manifest => { manifest.artifacts[0].sha256 = '0'.repeat(64); },
    manifest => { manifest.artifacts[0].artifact = '../other.zip'; },
  ]) await assert.rejects(() => readExtensionPublicationCandidate(extensionCandidateFixture(edit)), /extension-publication-/u);
  await assert.rejects(() => readExtensionPublicationCandidate(extensionCandidateFixture(undefined, Buffer.from('zap'))), /local-bytes/u);
});

test('extension plans require exactly the candidate pair and retain freshness and account checks', async () => {
  const candidate = await readExtensionPublicationCandidate(extensionCandidateFixture());
  const actions = candidate.artifacts.map(({ target }) => ({ kind: 'r2-publish', target }));
  const plan = createOperationPlan({ driverId: 'cloudflare-wrangler', accountId: 'account-1', inspection: {}, preview: {}, actions });
  assert.deepEqual(assertExtensionPublicationPlan(plan, candidate, 'account-1'), plan);
  for (const invalid of [actions.slice(0, 1), [...actions, { kind: 'worker-deploy', target: 'worker:tobirink-public-api' }], [actions[0], actions[0]], actions.map(action => ({ ...action, kind: 'worker-deploy' }))]) {
    assert.throws(() => assertExtensionPublicationPlan({ ...plan, actions: invalid }, candidate, 'account-1'), /plan-targets/u);
  }
  assert.throws(() => assertExtensionPublicationPlan(plan, candidate, 'account-2'), /account-not-allowed/u);
  const expired = createOperationPlan({ driverId: 'cloudflare-wrangler', accountId: 'account-1', inspection: {}, preview: {}, actions, now: new Date(Date.now() - 60 * 60 * 1000) });
  assert.throws(() => assertExtensionPublicationPlan(expired, candidate, 'account-1'), /stale-plan/u);
});

const publicArchiveResponse = (body = 'zip', options = {}) => new Response(body, {
  headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'public, max-age=31536000, immutable' }, ...options,
});

test('both public archives must match hashes, sizes and HTTP metadata without credentials or redirects', async () => {
  const candidate = await readExtensionPublicationCandidate(extensionCandidateFixture());
  const calls = [];
  const proof = await verifyExtensionPublication(candidate, { fetcher: async (url, options) => { calls.push({ url, options }); return publicArchiveResponse(); } });
  assert.equal(proof.artifacts.length, 2);
  assert.ok(proof.artifacts.every(artifact => artifact.size === 3 && artifact.status === 200));
  assert.deepEqual(calls.map(({ url }) => url), candidate.artifacts.map(({ artifact }) => `https://tobirink.com/downloads/${artifact}`));
  assert.ok(calls.every(({ options }) => options.redirect === 'error' && options.headers === undefined));
  for (const response of [
    () => publicArchiveResponse('zip', { status: 404 }),
    () => publicArchiveResponse('zip', { status: 302 }),
    () => publicArchiveResponse('zip', { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'immutable' } }),
    () => publicArchiveResponse('zip', { headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' } }),
    () => publicArchiveResponse('zap'),
    () => publicArchiveResponse('zi'),
    () => publicArchiveResponse(Buffer.alloc(5 * 1024 * 1024 + 1)),
  ]) await assert.rejects(() => verifyExtensionPublication(candidate, { fetcher: async () => response() }), /extension-publication-/u);
  await assert.rejects(() => verifyExtensionPublication(candidate, { fetcher: async () => { throw new Error('secret-fixture'); } }), /^Error: extension-publication-fetch-failed$/u);
});

test('public verification has one total deadline including stalled bodies and rejects partial success', async () => {
  const candidate = await readExtensionPublicationCandidate(extensionCandidateFixture());
  let signal;
  await assert.rejects(() => verifyExtensionPublication(candidate, { timeoutMs: 20, fetcher: async (_url, options) => {
    signal = options.signal;
    return publicArchiveResponse(new globalThis.ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); } }));
  } }), /extension-publication-timeout/u);
  assert.equal(signal.aborted, true);
  let count = 0;
  await assert.rejects(() => verifyExtensionPublication(candidate, { fetcher: async () => publicArchiveResponse(++count === 1 ? 'zip' : 'zap') }), /public-bytes/u);
  assert.equal(count, 2);
  await assert.rejects(() => verifyExtensionPublication(candidate, { timeoutMs: 30_001 }), /invalid-deadline/u);
});

function test_derive_operation_targets() {
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async () => '' });
  assert.deepEqual(driver.listOperations(), [
    { name: 'worker-secret-set:PROVIDER_GATEWAY_HMAC_KEY', kind: 'worker-secret-set', target: 'worker-secret:public-api/PROVIDER_GATEWAY_HMAC_KEY' },
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
    if (args[0] === 'd1') return 'No migrations to apply';
    return '{"name":"public-covers"}';
  };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run });
  const state = await driver.inspect('account-1');
  assert.equal(state.accountId, 'account-1');
  assert.deepEqual(state.migrations, [{ binding: 'CATALOGUE_DB', name: 'public-catalogue', output: 'No migrations to apply' }]);
  assert.deepEqual(state.queues, { configured: [], output: '' });
  assert.deepEqual(calls, [
    ['whoami', '--account', 'account-1', '--json'],
    ['d1', 'migrations', 'list', 'CATALOGUE_DB', '--remote'],
    ['r2', 'bucket', 'info', 'public-covers', '--json'],
  ]);
  assert.equal(calls.some(args => args.includes('apply') || args[0] === 'deploy'), false);
}

async function test_worker_inspection_does_not_require_unrelated_storage_permissions() {
  const calls = [];
  const driver = createCloudflareDriver({
    config,
    workerDirectory: '/worker',
    run: async args => {
      calls.push(args);
      if (args[0] === 'whoami') return '{"accounts":[{"id":"account-1"}]}';
      return '{}';
    },
  });
  const actions = driver.resolveOperations(['worker-deploy']);
  const state = await driver.inspect('account-1', actions);
  assert.deepEqual(state.migrations, []);
  assert.deepEqual(state.buckets, []);
  assert.deepEqual(state.queues, { configured: [], output: '' });
  assert.deepEqual(calls, [
    ['whoami', '--account', 'account-1', '--json'],
  ]);
}

async function test_worker_inspection_omits_volatile_deployment_status() {
  const calls = [];
  const driver = createCloudflareDriver({
    config,
    workerDirectory: '/worker',
    run: async args => {
      calls.push(args);
      if (args[0] === 'whoami') return '{"accounts":[{"id":"account-1"}]}';
      throw new Error(`unexpected-command:${args.join(' ')}`);
    },
  });
  const actions = driver.resolveOperations(['worker-deploy']);
  const first = await driver.inspect('account-1', actions);
  const second = await driver.inspect('account-1', actions);
  assert.deepEqual(second, first);
  assert.equal(calls.some(args => args[0] === 'deployments'), false);
}

async function test_preview_and_apply_translations() {
  const calls = [];
  const builds = [];
  const run = async args => { calls.push(args); return args.includes('--dry-run') ? 'bundle preview' : 'applied'; };
  const buildWorkerAssets = async options => { builds.push(options); };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run, buildWorkerAssets, fingerprintWorker: async () => 'a'.repeat(64) });
  const actions = driver.resolveOperations(['worker-deploy', 'd1-migrate:CATALOGUE_DB']);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview, {
    worker: { dryRun: true, sourceDigest: 'a'.repeat(64) },
    actions: [
      { kind: 'worker-deploy', target: 'worker:public-api' },
      { kind: 'd1-migrate', target: 'd1:public-catalogue' },
    ],
  });
  assert.deepEqual(calls, [['deploy', '--dry-run']]);
  assert.deepEqual(builds, [{ workerDirectory: '/worker' }]);
  calls.length = 0;
  await driver.apply(preview.actions);
  assert.deepEqual(calls, [
    ['d1', 'migrations', 'apply', 'CATALOGUE_DB', '--remote'],
    ['deploy'],
  ]);
  assert.deepEqual(builds, [
    { workerDirectory: '/worker' },
    { workerDirectory: '/worker' },
  ]);
}

async function test_worker_preview_ignores_volatile_wrangler_output_but_tracks_sources() {
  let runCount = 0;
  let sourceDigest = 'a'.repeat(64);
  const driver = createCloudflareDriver({
    config,
    workerDirectory: '/worker',
    run: async () => `volatile deployment metadata ${++runCount}`,
    buildWorkerAssets: async () => {},
    fingerprintWorker: async () => sourceDigest,
  });
  const actions = driver.resolveOperations(['worker-deploy']);
  const first = await driver.preview(actions);
  const second = await driver.preview(actions);
  assert.deepEqual(second.worker, first.worker);
  sourceDigest = 'b'.repeat(64);
  const changed = await driver.preview(actions);
  assert.notDeepEqual(changed.worker, first.worker);
}

async function test_worker_fingerprint_normalizes_next_build_ids_only() {
  const root = await mkdtemp(resolve(tmpdir(), 'tobirink-cloudflare-'));
  const workerDirectory = resolve(root, 'worker');
  const outputDirectory = resolve(root, 'web/out');
  try {
    await mkdir(resolve(workerDirectory, 'src'), { recursive: true });
    await mkdir(resolve(outputDirectory, '_next/static/first-build-id'), { recursive: true });
    await writeFile(resolve(workerDirectory, 'wrangler.jsonc'), '{}');
    await writeFile(resolve(workerDirectory, 'src/index.ts'), 'export default {}');
    await writeFile(resolve(outputDirectory, 'index.html'), '/_next/static/first-build-id/app.js first-build-id');
    await writeFile(resolve(outputDirectory, '_next/static/first-build-id/app.js'), '{"buildId":"first-build-id"}');
    const first = await fingerprintWorkerInputs({ workerDirectory });
    await rm(resolve(outputDirectory, '_next/static/first-build-id'), { recursive: true });
    await mkdir(resolve(outputDirectory, '_next/static/second-build-id'), { recursive: true });
    await writeFile(resolve(outputDirectory, 'index.html'), '/_next/static/second-build-id/app.js second-build-id');
    await writeFile(resolve(outputDirectory, '_next/static/second-build-id/app.js'), '{"buildId":"second-build-id"}');
    const second = await fingerprintWorkerInputs({ workerDirectory });
    assert.equal(first, second);
    await writeFile(resolve(outputDirectory, 'index.html'), 'changed application content');
    assert.notEqual(await fingerprintWorkerInputs({ workerDirectory }), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function test_preserve_routes_deploy_uses_route_free_ephemeral_config() {
  const calls = [];
  const driver = createCloudflareDriver({
    config,
    workerDirectory: resolve(fileURLToPath(new URL('../../apps/worker', import.meta.url))),
    run: async args => { calls.push(args); return args.includes('--dry-run') ? 'bundle preview' : 'applied'; },
    buildWorkerAssets: async () => {},
    preserveRoutes: true,
  });
  const actions = driver.resolveOperations(['worker-deploy']);
  await driver.preview(actions);
  const previewConfig = calls[0][calls[0].indexOf('--config') + 1];
  assert.equal(calls[0][0], 'deploy');
  assert.equal(calls[0][1], '--dry-run');
  assert.ok(previewConfig.endsWith('.jsonc'));
  assert.equal('routes' in JSON.parse(readFileSync(previewConfig, 'utf8')), false);
  calls.length = 0;
  await driver.apply(actions);
  assert.equal(calls[0][0], 'deploy');
  assert.ok(calls[0].includes('--config'));
  unlinkSync(previewConfig);
}

async function test_gateway_secret_is_stdin_only_and_redacted() {
  const calls = [];
  const gatewaySecret = '0123456789abcdef0123456789abcdef';
  const run = async (args, options) => {
    calls.push({ args, options });
    return `configured ${gatewaySecret}`;
  };
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run, gatewaySecret });
  const actions = driver.resolveOperations(['worker-secret-set:PROVIDER_GATEWAY_HMAC_KEY']);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview.actions, [{ kind: 'worker-secret-set', target: 'worker-secret:public-api/PROVIDER_GATEWAY_HMAC_KEY' }]);
  const result = await driver.apply(actions);
  assert.deepEqual(calls[0].args, ['secret', 'put', 'PROVIDER_GATEWAY_HMAC_KEY', '--name', 'public-api']);
  assert.equal(calls[0].options.input, `${gatewaySecret}\n`);
  assert.equal(result[0].output, 'configured [REDACTED]');
}

async function test_gateway_secret_fails_closed_before_wrangler() {
  const calls = [];
  const driver = createCloudflareDriver({ config, workerDirectory: '/worker', run: async args => { calls.push(args); return ''; }, gatewaySecret: 'short' });
  const actions = driver.resolveOperations(['worker-secret-set:PROVIDER_GATEWAY_HMAC_KEY']);
  await assert.rejects(() => driver.apply(actions), /invalid-provider-gateway-secret/u);
  assert.deepEqual(calls, []);
}

async function test_worker_build_failure_prevents_wrangler() {
  const calls = [];
  const driver = createCloudflareDriver({
    config,
    workerDirectory: '/worker',
    run: async args => { calls.push(args); return ''; },
    buildWorkerAssets: async () => { throw new Error('web-build-failed'); },
  });
  const actions = driver.resolveOperations(['worker-deploy']);
  await assert.rejects(() => driver.preview(actions), /web-build-failed/u);
  await assert.rejects(() => driver.apply(actions), /web-build-failed/u);
  assert.deepEqual(calls, []);
}

async function test_release_publish_is_hashed_and_translated() {
  const calls = [];
  const releaseConfig = { ...config, r2: [...config.r2, { binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] };
  const driver = createCloudflareDriver({ config: releaseConfig, workerDirectory: '/worker', apiToken: 'fixture-token', r2Fetch: async () => new Response(null, { status: 404 }), read: async () => Buffer.from('zip'), run: async args => { calls.push(args); return '{}'; } });
  const actions = driver.resolveOperations([`r2-publish:tobirink-chrome-mv3-${releaseVersion}.zip`]);
  const preview = await driver.preview(actions);
  assert.deepEqual(preview.artifacts, [{
    target: `r2:public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`,
    sha256: '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2',
    size: 3,
  }]);
  await driver.inspect('account-1', actions);
  calls.length = 0;
  await driver.apply(actions);
  assert.deepEqual(calls, [[
    'r2', 'object', 'put', `public-releases/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`,
    '--file', fileURLToPath(new URL(`../../apps/extension/.output/packages/tobirink-chrome-mv3-${releaseVersion}.zip`, import.meta.url)),
    '--content-type', 'application/zip',
    '--content-disposition', `attachment; filename="tobirink-chrome-mv3-${releaseVersion}.zip"`,
    '--cache-control', 'public, max-age=31536000, immutable', '--remote', '--force',
  ]]);
}

function archiveInspectionFixture(response) {
  const writes = [];
  const reads = [];
  const driver = createCloudflareDriver({
    config: { ...config, r2: [{ binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] },
    workerDirectory: '/worker', apiToken: 'fixture-token', read: async () => Buffer.from('zip'),
    run: async args => { if (args.includes('put')) writes.push(args); return '{}'; },
    r2Fetch: async (url, init) => { reads.push({ url, init }); return response(); },
  });
  const actions = driver.resolveOperations([`r2-publish:tobirink-chrome-mv3-${releaseVersion}.zip`]);
  return { actions, driver, reads, writes };
}

test('immutable archives are authenticated and hashed, and identical retries never upload', async () => {
  const fixture = archiveInspectionFixture(() => new Response('zip'));
  const inspection = await fixture.driver.inspect('account-1', fixture.actions);
  assert.deepEqual(inspection.releaseObjects, [{ target: fixture.actions[0].target, state: 'present', size: 3, sha256: '4a70fe9aa6436e02c2dea340fbd1e352e4ef2d8ce6ca52ad25d4b95471fc8bf2' }]);
  assert.equal(fixture.reads[0].url, `https://api.cloudflare.com/client/v4/accounts/account-1/r2/buckets/public-releases/objects/downloads/tobirink-chrome-mv3-${releaseVersion}.zip`);
  assert.equal(fixture.reads[0].init.headers.Authorization, 'Bearer fixture-token');
  assert.equal(fixture.reads[0].init.redirect, 'error');
  assert.equal(JSON.stringify(inspection).includes('fixture-token'), false);
  assert.equal((await fixture.driver.apply(fixture.actions))[0].output, 'already-published-identical');
  assert.equal(fixture.reads.length, 2);
  assert.deepEqual(fixture.writes, []);
});

test('a partial two-archive publication fails and resumes without rewriting the successful object', async () => {
  const published = new Set();
  const writes = [];
  let failFirefox = true;
  const driver = createCloudflareDriver({
    config: { ...config, r2: [{ binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] },
    workerDirectory: '/worker', apiToken: 'fixture-token', read: async () => Buffer.from('zip'),
    r2Fetch: async url => published.has(url.split('/').at(-1)) ? new Response('zip') : new Response(null, { status: 404 }),
    run: async args => {
      if (args.includes('put')) {
        const artifact = args[3].split('/').at(-1);
        writes.push(artifact);
        if (failFirefox && artifact.includes('firefox')) throw new Error('fixture-upload-failed');
        published.add(artifact);
      }
      return '{}';
    },
  });
  const artifacts = ['chrome', 'firefox'].map(browser => `tobirink-${browser}-mv3-${releaseVersion}.zip`);
  const actions = driver.resolveOperations(artifacts.map(artifact => `r2-publish:${artifact}`));
  await driver.inspect('account-1', actions);
  await assert.rejects(() => driver.apply(actions), /fixture-upload-failed/u);
  assert.deepEqual([...published], [artifacts[0]]);
  failFirefox = false;
  const inspection = await driver.inspect('account-1', actions);
  assert.deepEqual(inspection.releaseObjects.map(object => object.state), ['present', 'missing']);
  const resumed = await driver.apply(actions);
  assert.equal(resumed[0].output, 'already-published-identical');
  assert.deepEqual(writes, [artifacts[0], artifacts[1], artifacts[1]]);
  assert.deepEqual([...published], artifacts);
});

test('a conflicting archive prevents planning and a last-minute conflict prevents upload', async () => {
  let present = true;
  const fixture = archiveInspectionFixture(() => present ? new Response('different') : new Response(null, { status: 404 }));
  await assert.rejects(() => fixture.driver.inspect('account-1', fixture.actions), /immutable-release-conflict/u);
  present = false;
  const inspection = await fixture.driver.inspect('account-1', fixture.actions);
  assert.equal(inspection.releaseObjects[0].state, 'missing');
  present = true;
  await assert.rejects(() => fixture.driver.apply(fixture.actions), /immutable-release-conflict/u);
  assert.deepEqual(fixture.writes, []);
});

test('R2 authentication, unavailable responses and oversized bodies never count as absence', async () => {
  for (const status of [401, 403, 429, 503]) {
    const fixture = archiveInspectionFixture(() => new Response('sensitive-body', { status }));
    await assert.rejects(() => fixture.driver.inspect('account-1', fixture.actions), new RegExp(`r2-object-inspection-http:${status}`, 'u'));
    await assert.rejects(() => fixture.driver.apply(fixture.actions), /requires-inspection/u);
    assert.deepEqual(fixture.writes, []);
  }
  const oversized = archiveInspectionFixture(() => new Response(Buffer.alloc(5 * 1024 * 1024 + 1)));
  await assert.rejects(() => oversized.driver.inspect('account-1', oversized.actions), /r2-object-inspection-body-failed/u);
  const network = archiveInspectionFixture(() => { throw new Error('fixture-token-sensitive'); });
  await assert.rejects(() => network.driver.inspect('account-1', network.actions), /^Error: r2-object-inspection-network-failed$/u);
});

test('immutable publication requires an API token and never guesses absence from local-only authentication', async () => {
  const driver = createCloudflareDriver({ config: { ...config, r2: [{ binding: 'RELEASE_SNAPSHOTS', name: 'public-releases' }] }, workerDirectory: '/worker', apiToken: '', run: async () => '{}', r2Fetch: async () => { throw new Error('must-not-fetch'); } });
  const actions = driver.resolveOperations([`r2-publish:tobirink-chrome-mv3-${releaseVersion}.zip`]);
  await assert.rejects(() => driver.inspect('account-1', actions), /r2-object-inspection-token-required/u);
  await assert.rejects(() => driver.apply(actions), /release-publication-requires-inspection/u);
});

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
    d1: [{ binding: 'PUBLIC_DB', name: 'tobirink-public' }],
    r2: [
      { binding: 'COVER_BUCKET', name: 'tobirink-covers' },
      { binding: 'RELEASE_SNAPSHOTS', name: 'tobirink-public-releases' },
    ],
    queues: [
      { name: 'tobirink-public-discovery' },
      { name: 'tobirink-public-discovery-dlq' },
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
test('worker-only inspection excludes unrelated D1, R2 and Queue reads', test_worker_inspection_does_not_require_unrelated_storage_permissions);
test('worker inspection omits volatile deployment status', test_worker_inspection_omits_volatile_deployment_status);
test('preview is dry-run and apply owns the only mutating Wrangler translations', test_preview_and_apply_translations);
test('worker preview ignores volatile Wrangler output but tracks sources', test_worker_preview_ignores_volatile_wrangler_output_but_tracks_sources);
test('worker fingerprint normalizes Next build IDs only', test_worker_fingerprint_normalizes_next_build_ids_only);
test('preserve-routes deploys with an ephemeral route-free config', test_preserve_routes_deploy_uses_route_free_ephemeral_config);
test('the gateway secret is passed on stdin and redacted from results', test_gateway_secret_is_stdin_only_and_redacted);
test('an absent or weak gateway secret fails before Wrangler', test_gateway_secret_fails_closed_before_wrangler);
test('a failed web build prevents Worker preview and deployment', test_worker_build_failure_prevents_wrangler);
test('release publication hashes bytes before translating the bounded R2 upload', test_release_publish_is_hashed_and_translated);
test('release snapshots are schema-validated and uploaded before their pointer', test_release_snapshot_publication_is_validated_and_ordered);
test('release snapshot publication rejects unsafe revisions, mismatches, incomplete pairs and invalid JSON', test_release_snapshot_publication_fails_closed);
test('unknown operations and actions fail before invoking Wrangler', test_reject_unknown_operations);
test('the checked-in Wrangler config is the single resource source', test_load_checked_in_config);
test('the driver accepts a complete provider configuration', test_accept_valid_config);
test('the driver rejects missing resource collections', test_reject_missing_resource_collections);
test('the driver rejects invalid D1 identifiers', test_reject_invalid_d1_identifiers);
test('the driver rejects invalid R2 identifiers', test_reject_invalid_r2_identifiers);
