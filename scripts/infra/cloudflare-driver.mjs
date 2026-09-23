import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isReleaseArtifactAction, releaseMutationArguments, releaseRevisionFromActions, resolveReleaseAction, validateReleaseJson, validateReleasePair } from './release-snapshot-operation.mjs';

const execFileAsync = promisify(execFile);
const DRIVER_ID = 'cloudflare-wrangler';
const PROVIDER_GATEWAY_SECRET = 'PROVIDER_GATEWAY_HMAC_KEY';

function releasePublishOperations(config) {
  const releaseBucket = config.r2.find(resource => resource.binding === 'RELEASE_SNAPSHOTS');
  if (!releaseBucket) return [];
  const extensionRoot = fileURLToPath(new URL('../../apps/extension', import.meta.url));
  const version = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8')).version;
  const manifestPath = resolve(extensionRoot, '.output', 'packages', 'release-manifest.json');
  const releaseManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (releaseManifest.version !== version || !Array.isArray(releaseManifest.artifacts)) {
    throw new Error('release-manifest-version-mismatch');
  }
  return ['chrome', 'firefox'].map(browser => {
    const artifact = `tobirink-${browser}-mv3-${version}.zip`;
    const record = releaseManifest.artifacts.find(item => item.artifact === artifact && item.target === `${browser}-mv3`);
    const source = resolve(extensionRoot, '.output', 'packages', artifact);
    if (!record || record.version !== version || !record.sha256 || !Number.isSafeInteger(record.size) || record.size !== statSync(source).size) {
      throw new Error(`release-manifest-artifact-mismatch:${artifact}`);
    }
    return [`r2-publish:${artifact}`, {
      artifact,
      bucket: releaseBucket.name,
      kind: 'r2-publish',
      source,
      target: `r2:${releaseBucket.name}/downloads/${artifact}`,
    }];
  });
}

export async function loadCloudflareConfig(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  const worker = requiredString(parsed.name, 'worker-name');
  const d1 = (parsed.d1_databases ?? []).map(item => ({
    binding: requiredString(item.binding, 'd1-binding'),
    name: requiredString(item.database_name, 'd1-name'),
  }));
  const r2 = (parsed.r2_buckets ?? []).map(item => ({
    binding: requiredString(item.binding, 'r2-binding'),
    name: requiredString(item.bucket_name, 'r2-name'),
  }));
  const queueNames = new Set();
  for (const producer of parsed.queues?.producers ?? []) queueNames.add(requiredQueueName(producer.queue));
  for (const consumer of parsed.queues?.consumers ?? []) {
    queueNames.add(requiredQueueName(consumer.queue));
    if (consumer.dead_letter_queue !== undefined) queueNames.add(requiredQueueName(consumer.dead_letter_queue));
  }
  if (d1.length === 0) throw new Error('missing-d1-resource');
  return { worker, d1, r2, queues: [...queueNames].sort().map(name => ({ name })) };
}

export function createCloudflareDriver({ config, retiredQueues = [], workerDirectory, releaseDirectory = resolve(workerDirectory, '../../build/releases'), run = runWrangler, read = readFile, buildWorkerAssets = runWebBuild, fingerprintWorker = fingerprintWorkerInputs, gatewaySecret = process.env[PROVIDER_GATEWAY_SECRET], preserveRoutes = false, r2Fetch = globalThis.fetch, apiToken = process.env.CLOUDFLARE_API_TOKEN }) {
  validateCloudflareConfig(config);
  validateRetiredQueues(config, retiredQueues);
  const operations = new Map([
    ...releasePublishOperations(config),
    ...config.queues.map(queue => [`queue-create:${queue.name}`, { kind: 'queue-create', target: `queue:${queue.name}`, queue: queue.name }]),
    ...retiredQueues.map(queue => [`queue-delete:${queue}`, { kind: 'queue-delete', target: `queue:${queue}`, queue }]),
    ['worker-secret-set:PROVIDER_GATEWAY_HMAC_KEY', { kind: 'worker-secret-set', target: `worker-secret:${config.worker}/${PROVIDER_GATEWAY_SECRET}` }],
    ['worker-deploy', { kind: 'worker-deploy', target: `worker:${config.worker}` }],
    ...config.d1.map(database => [`d1-migrate:${database.binding}`, { kind: 'd1-migrate', target: `d1:${database.name}`, binding: database.binding }]),
  ]);
  let inspectedAccountId;
  const inspectArchive = async (action, accountId) => {
    const remote = await readAuthenticatedArchive(action, accountId, r2Fetch, apiToken);
    const local = await read(action.source);
    if (remote.state === 'present' && (remote.size !== local.length || remote.sha256 !== createHash('sha256').update(local).digest('hex'))) {
      throw new Error(`immutable-release-conflict:${action.target}`);
    }
    return { target: action.target, ...remote };
  };

  return {
    id: DRIVER_ID,
    listOperations() {
      return [...operations.entries()].map(([name, action]) => ({ name, kind: action.kind, target: action.target }));
    },
    resolveOperations(operationNames) {
      return resolveOperations(operations, operationNames, config, releaseDirectory).map(({ kind, target }) => ({ kind, target }));
    },
    async inspect(accountId, requestedActions) {
      inspectedAccountId = undefined;
      requiredString(accountId, 'account-id');
      const actions = requestedActions === undefined
        ? [...operations.values()]
        : materializeActions(operations, requestedActions, config, releaseDirectory);
      const requiresWorker = requestedActions === undefined || actions.some(action => action.kind === 'worker-deploy' || action.kind === 'worker-secret-set');
      const requiresD1 = requestedActions === undefined || actions.some(action => action.kind === 'd1-migrate');
      const requiredBuckets = actions
        .filter(action => action.kind === 'r2-publish' || action.kind === 'r2-release-snapshot' || action.kind === 'r2-release-pointer')
        .map(action => action.bucket)
        .filter((bucket, index, buckets) => buckets.indexOf(bucket) === index);
      const inspectedBuckets = requestedActions === undefined
        ? config.r2
        : config.r2.filter(bucket => requiredBuckets.includes(bucket.name));
      const requiresQueues = config.queues.length > 0 && (requestedActions === undefined || actions.some(action => action.kind === 'worker-deploy' || action.kind === 'queue-create' || action.kind === 'queue-delete'));
      const [identity, deployment, migrations, buckets, queues, releaseObjects] = await Promise.all([
        run(['whoami', '--account', accountId, '--json'], { cwd: workerDirectory }),
        requiresWorker ? run(['deployments', 'status', '--name', config.worker, '--json'], { cwd: workerDirectory }) : Promise.resolve('{}'),
        requiresD1 ? Promise.all(config.d1.map(database => run(['d1', 'migrations', 'list', database.binding, '--remote'], { cwd: workerDirectory }))) : Promise.resolve([]),
        Promise.all(inspectedBuckets.map(bucket => run(['r2', 'bucket', 'info', bucket.name, '--json'], { cwd: workerDirectory }))),
        requiresQueues ? run(['queues', 'list'], { accountId, cwd: workerDirectory }) : Promise.resolve(''),
        Promise.all(actions.filter(action => action.kind === 'r2-publish').map(action => inspectArchive(action, accountId))),
      ]);
      const inspection = {
        driverId: DRIVER_ID,
        accountId,
        identity: parseJson(identity, 'invalid-whoami-response'),
        deployment: requiresWorker ? parseJson(deployment, 'invalid-deployment-response') : null,
        migrations: requiresD1 ? config.d1.map((database, index) => ({ binding: database.binding, name: database.name, output: migrations[index].trim() })) : [],
        buckets: inspectedBuckets.map((bucket, index) => ({ binding: bucket.binding, name: bucket.name, info: parseJson(buckets[index], 'invalid-r2-response') })),
        queues: { configured: requiresQueues ? config.queues.map(queue => queue.name) : [], output: queues.trim() },
        releaseObjects,
      };
      inspectedAccountId = accountId;
      return inspection;
    },
    async preview(requestedActions) {
      const actions = materializeActions(operations, requestedActions, config, releaseDirectory);
      const output = {};
      if (actions.some(action => action.kind === 'worker-deploy')) {
        await buildWorkerAssets({ workerDirectory });
        await run(await deployArguments(workerDirectory, preserveRoutes, true), { cwd: workerDirectory });
        output.worker = { dryRun: true, sourceDigest: await fingerprintWorker({ workerDirectory }) };
      }
      const artifacts = await Promise.all(actions.filter(isReleaseArtifactAction).map(async action => {
        const content = await read(action.source);
        validateReleaseJson(action, content);
        return { target: action.target, sha256: createHash('sha256').update(content).digest('hex'), size: content.length };
      }));
      if (artifacts.length > 0) output.artifacts = artifacts;
      output.actions = actions.map(({ kind, target }) => ({ kind, target }));
      return output;
    },
    async apply(actions) {
      const selected = materializeActions(operations, actions, config, releaseDirectory)
        .sort((left, right) => operationPriority(left) - operationPriority(right));
      if (selected.some(action => action.kind === 'worker-deploy')) {
        await buildWorkerAssets({ workerDirectory });
      }
      const results = [];
      for (const action of selected) {
        if (action.kind === 'r2-publish') {
          if (inspectedAccountId === undefined) throw new Error('release-publication-requires-inspection');
          const remote = await inspectArchive(action, inspectedAccountId);
          if (remote.state === 'present') {
            results.push({ kind: action.kind, target: action.target, output: 'already-published-identical' });
            continue;
          }
        }
        const args = await mutationArguments(action, workerDirectory, preserveRoutes);
        const input = action.kind === 'worker-secret-set' ? `${assertGatewaySecret(gatewaySecret)}\n` : undefined;
        const output = await run(args, { cwd: workerDirectory, input });
        results.push({ kind: action.kind, target: action.target, output: redact(output, gatewaySecret).trim() });
      }
      return results;
    },
  };
}

async function readAuthenticatedArchive(action, accountId, fetcher, apiToken) {
  if (apiToken !== String(apiToken) || apiToken.length === 0) throw new Error('r2-object-inspection-token-required');
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(action.bucket)}/objects/downloads/${encodeURIComponent(action.artifact)}`;
  let response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${apiToken}` }, method: 'GET', redirect: 'error', signal: globalThis.AbortSignal.timeout(15_000) });
  } catch { throw new Error('r2-object-inspection-network-failed'); }
  if (response.status === 404) {
    await response.body?.cancel();
    return { state: 'missing' };
  }
  if (response.status !== 200 || response.body === null) {
    await response.body?.cancel();
    throw new Error(`r2-object-inspection-http:${response.status}`);
  }
  const reader = response.body.getReader();
  const hash = createHash('sha256');
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 5 * 1024 * 1024) throw new Error('archive-size-limit');
      hash.update(chunk.value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new Error('r2-object-inspection-body-failed');
  } finally { reader.releaseLock(); }
  return { state: 'present', sha256: hash.digest('hex'), size };
}

async function mutationArguments(action, workerDirectory, preserveRoutes) {
  if (action.kind === 'queue-create') return ['queues', 'create', action.queue];
  if (action.kind === 'queue-delete') return ['queues', 'delete', action.queue];
  if (action.kind === 'worker-deploy') return deployArguments(workerDirectory, preserveRoutes, false);
  if (action.kind === 'worker-secret-set') return ['secret', 'put', PROVIDER_GATEWAY_SECRET, '--name', action.target.split('/')[0].slice('worker-secret:'.length)];
  if (action.kind === 'd1-migrate') return ['d1', 'migrations', 'apply', action.binding, '--remote'];
  if (action.kind === 'r2-publish') {
    return ['r2', 'object', 'put', `${action.bucket}/downloads/${action.artifact}`, '--file', action.source, '--content-type', 'application/zip', '--content-disposition', `attachment; filename="${action.artifact}"`, '--cache-control', 'public, max-age=31536000, immutable', '--remote', '--force'];
  }
  const releaseArguments = releaseMutationArguments(action);
  if (releaseArguments) return releaseArguments;
  throw new Error(`unsupported-action-kind:${action.kind}`);
}

async function deployArguments(workerDirectory, preserveRoutes, dryRun) {
  const args = ['deploy'];
  if (dryRun) args.push('--dry-run');
  if (!preserveRoutes) return args;
  const source = JSON.parse(await readFile(resolve(workerDirectory, 'wrangler.jsonc'), 'utf8'));
  delete source.routes;
  const configPath = resolve(workerDirectory, `.wrangler-preserve-routes-${process.pid}.jsonc`);
  await writeFile(configPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
  args.push('--config', configPath);
  return args;
}

async function runWrangler(args, { accountId, cwd, input }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
  if (accountId !== undefined) environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  const options = {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: environment,
  };
  const commandArgs = ['exec', '--', 'wrangler', ...args];
  try {
    if (input !== undefined) return await runWranglerWithInput(npm, commandArgs, { ...options, input });
    const { stdout } = await execFileAsync(npm, commandArgs, options);
    return stdout;
  } finally {
    await cleanupTemporaryConfig(args);
  }
}

async function cleanupTemporaryConfig(args) {
  const configIndex = args.indexOf('--config');
  const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined;
  if (configPath?.includes('.wrangler-preserve-routes-')) await unlink(configPath).catch(() => undefined);
}

function runWranglerWithInput(command, args, { cwd, env, input, maxBuffer }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const collect = (current, chunk) => {
      const next = current + chunk;
      if (Buffer.byteLength(next) > maxBuffer) child.kill();
      return next;
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = collect(stderr, chunk); });
    child.on('error', rejectPromise);
    child.on('close', code => {
      if (code === 0) resolvePromise(stdout);
      else rejectPromise(new Error(`wrangler exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function runWebBuild({ workerDirectory }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await execFileAsync(npm, ['run', 'build', '--workspace', '@tobirink/web'], {
    cwd: resolve(workerDirectory, '../..'),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

export async function fingerprintWorkerInputs({ workerDirectory }) {
  const entries = await fingerprintWorkerInputEntries({ workerDirectory });
  const hash = createHash('sha256');
  for (const entry of entries) {
    hash.update(entry.path);
    hash.update('\0');
    hash.update(entry.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

async function fingerprintWorkerInputEntries({ workerDirectory }) {
  const roots = [resolve(workerDirectory, 'wrangler.jsonc'), resolve(workerDirectory, 'src'), resolve(workerDirectory, '../web/out')];
  const buildIds = await generatedBuildIds(resolve(workerDirectory, '../web/out'));
  const files = [];
  for (const root of roots) await collectFiles(root, files);
  files.sort((left, right) => left.localeCompare(right));
  const entries = [];
  for (const inputPath of files) entries.push({
    path: normalizeGeneratedValue(inputPath.slice(workerDirectory.length + 1), buildIds),
    content: normalizeGeneratedContent(await readFile(inputPath), buildIds),
  });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

async function generatedBuildIds(outputDirectory) {
  const staticDirectory = resolve(outputDirectory, '_next/static');
  const entries = await readdir(staticDirectory, { withFileTypes: true });
  const buildIds = new Set(entries.filter(entry => entry.isDirectory() && entry.name !== 'chunks' && entry.name !== 'media').map(entry => entry.name));
  const files = [];
  await collectFiles(outputDirectory, files);
  for (const file of files) {
    const content = await readFile(file);
    if (content.includes(0)) continue;
    for (const match of content.toString('utf8').matchAll(/"buildId":"([^"]+)"/gu)) buildIds.add(match[1]);
  }
  return [...buildIds].sort((left, right) => left.localeCompare(right));
}

function normalizeGeneratedValue(value, buildIds) {
  return buildIds.reduce((current, buildId) => current.replaceAll(buildId, '<next-build-id>'), value);
}

function normalizeGeneratedContent(content, buildIds) {
  if (buildIds.length === 0 || content.includes(0)) return content;
  return Buffer.from(normalizeGeneratedValue(content.toString('utf8'), buildIds));
}

async function collectFiles(path, files) {
  const entries = await readdir(path, { withFileTypes: true }).catch(async error => {
    if (error.code !== 'ENOTDIR') throw error;
    return [null];
  });
  if (entries[0] === null) {
    files.push(path);
    return;
  }
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await collectFiles(child, files);
    else if (entry.isFile()) files.push(child);
  }
}

function resolveOperations(operations, names, config, releaseDirectory) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('missing-operation');
  if (new Set(names).size !== names.length) throw new Error('duplicate-operation');
  const releaseBucket = config.r2.find(resource => resource.binding === 'RELEASE_SNAPSHOTS');
  const selected = names.map(name => operations.get(name) ?? resolveReleaseAction(name, releaseBucket, releaseDirectory));
  validateReleasePair(selected);
  return selected;
}

function materializeActions(operations, expectedActions, config, releaseDirectory) {
  const revision = releaseRevisionFromActions(expectedActions);
  const releaseBucket = config.r2.find(resource => resource.binding === 'RELEASE_SNAPSHOTS');
  const actions = expectedActions.map(expected => {
    if (expected.kind === 'r2-release-snapshot' && revision) return resolveReleaseAction(`r2-release-snapshot:${revision}`, releaseBucket, releaseDirectory);
    if (expected.kind === 'r2-release-pointer' && revision) return resolveReleaseAction(`r2-release-pointer:${revision}`, releaseBucket, releaseDirectory);
    return findAction(operations, expected);
  });
  if (actions.some((action, index) => action.kind !== expectedActions[index].kind || action.target !== expectedActions[index].target)) throw new Error('unsupported-release-action');
  validateReleasePair(actions);
  return actions;
}

function findAction(operations, expected) {
  const action = [...operations.values()].find(item => item.kind === expected.kind && item.target === expected.target);
  if (!action) throw new Error(`unsupported-action:${expected.kind}:${expected.target}`);
  return action;
}

function operationPriority(action) {
  if (action.kind === 'queue-create') return 0;
  if (action.kind === 'd1-migrate') return 1;
  if (action.kind === 'queue-delete') return 2;
  if (action.kind === 'r2-publish' || action.kind === 'r2-release-snapshot') return 2;
  if (action.kind === 'r2-release-pointer') return 3;
  if (action.kind === 'worker-secret-set') return 3;
  return 4;
}

function assertGatewaySecret(value) {
  if (value !== String(value)) throw new Error('invalid-provider-gateway-secret');
  const length = Buffer.byteLength(value);
  if (length < 32 || length > 256) throw new Error('invalid-provider-gateway-secret');
  return value;
}

function redact(value, secret) {
  return secret === String(secret) && secret.length > 0 ? value.replaceAll(secret, '[REDACTED]') : value;
}

export function validateCloudflareConfig(config) {
  if (!config || !Array.isArray(config.d1) || !Array.isArray(config.r2) || !Array.isArray(config.queues)) throw new Error('invalid-cloudflare-config');
  requiredString(config.worker, 'worker-name');
  config.d1.forEach(item => { requiredString(item.binding, 'd1-binding'); requiredString(item.name, 'd1-name'); });
  config.r2.forEach(item => { requiredString(item.binding, 'r2-binding'); requiredString(item.name, 'r2-name'); });
  config.queues.forEach(item => requiredQueueName(item.name));
}

function validateRetiredQueues(config, retiredQueues) {
  if (!Array.isArray(retiredQueues)) throw new Error('invalid-retired-queues');
  const active = new Set(config.queues.map(queue => queue.name));
  const seen = new Set();
  for (const queue of retiredQueues) {
    requiredQueueName(queue);
    if (active.has(queue) || seen.has(queue)) throw new Error('invalid-retired-queue');
    seen.add(queue);
  }
}

function parseJson(value, error) {
  try { return JSON.parse(value); } catch { throw new Error(error); }
}

function requiredString(value, field) {
  if (value !== String(value) || value.length === 0) throw new Error(`invalid-${field}`);
  return value;
}

function requiredQueueName(value) {
  if (value !== String(value) || value.length > 63 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) throw new Error('invalid-queue-name');
  return value;
}
