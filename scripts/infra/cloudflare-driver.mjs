import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DRIVER_ID = 'cloudflare-wrangler';

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

export function createCloudflareDriver({ config, workerDirectory, run = runWrangler }) {
  validateConfig(config);
  const operations = new Map([
    ['worker-deploy', { kind: 'worker-deploy', target: `worker:${config.worker}` }],
    ...config.d1.map(database => [`d1-migrate:${database.binding}`, { kind: 'd1-migrate', target: `d1:${database.name}`, binding: database.binding }]),
  ]);

  return {
    id: DRIVER_ID,
    listOperations() {
      return [...operations.entries()].map(([name, action]) => ({ name, kind: action.kind, target: action.target }));
    },
    resolveOperations(operationNames) {
      return selectOperations(operations, operationNames).map(({ kind, target }) => ({ kind, target }));
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
      const actions = requestedActions.map(action => findAction(operations, action));
      const output = {};
      if (actions.some(action => action.kind === 'worker-deploy')) {
        output.worker = (await run(['deploy', '--dry-run'], { cwd: workerDirectory })).trim();
      }
      output.actions = actions.map(({ kind, target }) => ({ kind, target }));
      return output;
    },
    async apply(actions) {
      const selected = actions
        .map(action => findAction(operations, action))
        .sort((left, right) => operationPriority(left) - operationPriority(right));
      const results = [];
      for (const action of selected) {
        const args = action.kind === 'worker-deploy'
          ? ['deploy']
          : ['d1', 'migrations', 'apply', action.binding, '--remote'];
        results.push({ kind: action.kind, target: action.target, output: (await run(args, { cwd: workerDirectory })).trim() });
      }
      return results;
    },
  };
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

function selectOperations(operations, names) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('missing-operation');
  if (new Set(names).size !== names.length) throw new Error('duplicate-operation');
  return names.map(name => {
    const action = operations.get(name);
    if (!action) throw new Error(`unsupported-operation:${name}`);
    return action;
  });
}

function findAction(operations, expected) {
  const action = [...operations.values()].find(item => item.kind === expected.kind && item.target === expected.target);
  if (!action) throw new Error(`unsupported-action:${expected.kind}:${expected.target}`);
  return action;
}

function operationPriority(action) {
  return action.kind === 'd1-migrate' ? 0 : 1;
}

function validateConfig(config) {
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
