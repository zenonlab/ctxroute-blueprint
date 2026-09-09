import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isReleaseArtifactAction, releaseMutationArguments, releaseRevisionFromActions, resolveReleaseAction, validateReleaseJson, validateReleasePair } from './release-snapshot-operation.mjs';

const execFileAsync = promisify(execFile);
const DRIVER_ID = 'cloudflare-wrangler';

function releasePublishOperations(config) {
  const releaseBucket = config.r2.find(resource => resource.binding === 'RELEASE_SNAPSHOTS');
  if (!releaseBucket) return [];
  const extensionRoot = fileURLToPath(new URL('../../apps/extension', import.meta.url));
  const version = JSON.parse(readFileSync(resolve(extensionRoot, 'package.json'), 'utf8')).version;
  return ['chrome', 'firefox'].map(browser => {
    const artifact = `tobirink-${browser}-mv3-${version}.zip`;
    return [`r2-publish:${artifact}`, {
      artifact,
      bucket: releaseBucket.name,
      kind: 'r2-publish',
      source: resolve(extensionRoot, '.output', 'packages', artifact),
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
  if (d1.length === 0) throw new Error('missing-d1-resource');
  return { worker, d1, r2 };
}

export function createCloudflareDriver({ config, workerDirectory, releaseDirectory = resolve(workerDirectory, '../../build/releases'), run = runWrangler, read = readFile }) {
  validateCloudflareConfig(config);
  const operations = new Map([
    ...releasePublishOperations(config),
    ['worker-deploy', { kind: 'worker-deploy', target: `worker:${config.worker}` }],
    ...config.d1.map(database => [`d1-migrate:${database.binding}`, { kind: 'd1-migrate', target: `d1:${database.name}`, binding: database.binding }]),
  ]);

  return {
    id: DRIVER_ID,
    listOperations() {
      return [...operations.entries()].map(([name, action]) => ({ name, kind: action.kind, target: action.target }));
    },
    resolveOperations(operationNames) {
      return resolveOperations(operations, operationNames, config, releaseDirectory).map(({ kind, target }) => ({ kind, target }));
    },
    async inspect(accountId) {
      requiredString(accountId, 'account-id');
      const [identity, deployment, migrations, buckets] = await Promise.all([
        run(['whoami', '--account', accountId, '--json'], { cwd: workerDirectory }),
        run(['deployments', 'status', '--name', config.worker, '--json'], { cwd: workerDirectory }),
        Promise.all(config.d1.map(database => run(['d1', 'migrations', 'list', database.binding, '--remote'], { cwd: workerDirectory }))),
        Promise.all(config.r2.map(bucket => run(['r2', 'bucket', 'info', bucket.name, '--json'], { cwd: workerDirectory }))),
      ]);
      return {
        driverId: DRIVER_ID,
        accountId,
        identity: parseJson(identity, 'invalid-whoami-response'),
        deployment: parseJson(deployment, 'invalid-deployment-response'),
        migrations: config.d1.map((database, index) => ({ binding: database.binding, name: database.name, output: migrations[index].trim() })),
        buckets: config.r2.map((bucket, index) => ({ binding: bucket.binding, name: bucket.name, info: parseJson(buckets[index], 'invalid-r2-response') })),
      };
    },
    async preview(requestedActions) {
      const actions = materializeActions(operations, requestedActions, config, releaseDirectory);
      const output = {};
      if (actions.some(action => action.kind === 'worker-deploy')) {
        output.worker = (await run(['deploy', '--dry-run'], { cwd: workerDirectory })).trim();
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
      const results = [];
      for (const action of selected) {
        const args = mutationArguments(action);
        results.push({ kind: action.kind, target: action.target, output: (await run(args, { cwd: workerDirectory })).trim() });
      }
      return results;
    },
  };
}

function mutationArguments(action) {
  if (action.kind === 'worker-deploy') return ['deploy'];
  if (action.kind === 'd1-migrate') return ['d1', 'migrations', 'apply', action.binding, '--remote'];
  if (action.kind === 'r2-publish') {
    return ['r2', 'object', 'put', `${action.bucket}/downloads/${action.artifact}`, '--file', action.source, '--content-type', 'application/zip', '--content-disposition', `attachment; filename="${action.artifact}"`, '--cache-control', 'public, max-age=31536000, immutable', '--remote', '--force'];
  }
  const releaseArguments = releaseMutationArguments(action);
  if (releaseArguments) return releaseArguments;
  throw new Error(`unsupported-action-kind:${action.kind}`);
}

async function runWrangler(args, { cwd }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const { stdout } = await execFileAsync(npm, ['exec', '--', 'wrangler', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  return stdout;
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
  if (action.kind === 'd1-migrate') return 0;
  if (action.kind === 'r2-publish' || action.kind === 'r2-release-snapshot') return 1;
  if (action.kind === 'r2-release-pointer') return 2;
  return 3;
}

export function validateCloudflareConfig(config) {
  if (!config || !Array.isArray(config.d1) || !Array.isArray(config.r2)) throw new Error('invalid-cloudflare-config');
  requiredString(config.worker, 'worker-name');
  config.d1.forEach(item => { requiredString(item.binding, 'd1-binding'); requiredString(item.name, 'd1-name'); });
  config.r2.forEach(item => { requiredString(item.binding, 'r2-binding'); requiredString(item.name, 'r2-name'); });
}

function parseJson(value, error) {
  try { return JSON.parse(value); } catch { throw new Error(error); }
}

function requiredString(value, field) {
  if (value !== String(value) || value.length === 0) throw new Error(`invalid-${field}`);
  return value;
}
