import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DRIVER_ID = 'deno-provider-gateway';
const APP = 'tobirink-provider-gateway';
const DATABASE = 'tobirink-provider-gateway-nonces';
const SECRET = 'PROVIDER_GATEWAY_HMAC_KEY';
const PREVIOUS_SECRET = 'PROVIDER_GATEWAY_HMAC_KEY_PREVIOUS';
const SECRET_FILE_TOKEN = '__TOBIRINK_DENO_SECRET_FILE__';
const secretNames = new Set([SECRET, PREVIOUS_SECRET]);
const runDeno = createDenoCommandRunner();

export function createProviderGatewayDriver({
  gatewayDirectory,
  run = runDeno,
  read = readFile,
  secret = process.env[SECRET],
  previousSecret = process.env[PREVIOUS_SECRET],
}) {
  const operations = new Map([
    ['gateway-app-create', { kind: 'gateway-app-create', target: `deno-app:${APP}` }],
    ['gateway-database-provision', { kind: 'gateway-database-provision', target: `deno-kv:${DATABASE}` }],
    ['gateway-database-assign', { kind: 'gateway-database-assign', target: `deno-assignment:${DATABASE}/${APP}` }],
    ['gateway-secret-set', { kind: 'gateway-secret-set', target: `deno-secret:${APP}/${SECRET}` }],
    ['gateway-secret-update', { kind: 'gateway-secret-update', target: `deno-secret:${APP}/${SECRET}` }],
    ['gateway-previous-secret-set', { kind: 'gateway-previous-secret-set', target: `deno-secret:${APP}/${PREVIOUS_SECRET}` }],
    ['gateway-previous-secret-delete', { kind: 'gateway-previous-secret-delete', target: `deno-secret:${APP}/${PREVIOUS_SECRET}` }],
    ['gateway-deploy', { kind: 'gateway-deploy', target: `deno-app:${APP}/production` }],
  ]);

  return {
    id: DRIVER_ID,
    listOperations() {
      return [...operations.entries()].map(([name, action]) => ({ name, ...action }));
    },
    resolveOperations(names) {
      if (!Array.isArray(names) || names.length === 0 || new Set(names).size !== names.length) throw new Error('invalid-gateway-operations');
      return names.map(name => {
        const action = operations.get(name);
        if (action === undefined) throw new Error(`unsupported-gateway-operation:${name}`);
        return action;
      });
    },
    async inspect(organization) {
      requiredIdentifier(organization, 'organization');
      const common = ['--json', '--non-interactive', '--org', organization];
      const [identity, apps, databases, environment] = await Promise.all([
        run(['deploy', 'whoami', '--json', '--non-interactive'], { cwd: gatewayDirectory }),
        run(['deploy', 'apps', 'list', ...common], { cwd: gatewayDirectory }),
        run(['deploy', 'database', 'list', ...common], { cwd: gatewayDirectory }),
        run(['deploy', 'env', 'list', ...common, '--app', APP], { cwd: gatewayDirectory }),
      ]);
      return {
        accountId: organization,
        applications: parseJson(apps, 'invalid-deno-apps'),
        databases: parseJson(databases, 'invalid-deno-databases'),
        driverId: DRIVER_ID,
        environment: parseEnvironmentInventory(environment),
        identity: parseJson(identity, 'invalid-deno-identity'),
      };
    },
    async preview(actions) {
      const selected = materialize(operations, actions);
      const [source, manifest] = await Promise.all([
        read(resolve(gatewayDirectory, 'src/index.ts')),
        read(resolve(gatewayDirectory, 'package.json')),
      ]);
      return {
        actions: selected,
        artifact: {
          sha256: createHash('sha256').update(source).update(manifest).digest('hex'),
          size: source.byteLength + manifest.byteLength,
        },
      };
    },
    async apply(actions, { accountId }) {
      requiredIdentifier(accountId, 'organization');
      const selected = materialize(operations, actions).sort((left, right) => priority(left) - priority(right));
      const results = [];
      for (const action of selected) {
        const invocation = mutationInvocation(action, accountId, secret, previousSecret);
        const output = await run(invocation.args, { cwd: gatewayDirectory, secretEnvironment: invocation.secretEnvironment });
        results.push({ kind: action.kind, output: redact(output, [secret, previousSecret]), target: action.target });
      }
      return results;
    },
  };
}

function materialize(operations, actions) {
  return actions.map(expected => {
    const action = [...operations.values()].find(candidate => candidate.kind === expected.kind && candidate.target === expected.target);
    if (action === undefined) throw new Error(`unsupported-gateway-action:${expected.kind}:${expected.target}`);
    return action;
  });
}

function mutationInvocation(action, organization, secret, previousSecret) {
  const common = ['--json', '--non-interactive', '--org', organization];
  if (action.kind === 'gateway-app-create') {
    return { args: ['deploy', 'create', '.', ...common, '--app', APP, '--source', 'local', '--runtime-mode', 'dynamic', '--entrypoint', 'src/index.ts', '--region', 'global'] };
  }
  if (action.kind === 'gateway-database-provision') return { args: ['deploy', 'database', 'provision', DATABASE, ...common, '--kind', 'denokv'] };
  if (action.kind === 'gateway-database-assign') return { args: ['deploy', 'database', 'assign', DATABASE, ...common, '--app', APP] };
  if (action.kind === 'gateway-secret-set') {
    assertSecret(secret);
    return { args: ['deploy', 'env', 'load', SECRET_FILE_TOKEN, ...common, '--app', APP], secretEnvironment: { [SECRET]: secret } };
  }
  if (action.kind === 'gateway-secret-update') {
    assertSecret(secret);
    return { args: ['deploy', 'env', 'load', SECRET_FILE_TOKEN, ...common, '--app', APP], secretEnvironment: { [SECRET]: secret } };
  }
  if (action.kind === 'gateway-previous-secret-set') {
    assertSecret(previousSecret);
    if (secret === previousSecret) throw new Error('duplicate-provider-gateway-secret');
    return { args: ['deploy', 'env', 'load', SECRET_FILE_TOKEN, ...common, '--app', APP], secretEnvironment: { [PREVIOUS_SECRET]: previousSecret } };
  }
  if (action.kind === 'gateway-previous-secret-delete') return { args: ['deploy', 'env', 'delete', PREVIOUS_SECRET, ...common, '--app', APP] };
  if (action.kind === 'gateway-deploy') return { args: ['deploy', '.', ...common, '--app', APP, '--prod'] };
  throw new Error(`unsupported-gateway-action-kind:${action.kind}`);
}

function priority(action) {
  return ['gateway-app-create', 'gateway-database-provision', 'gateway-database-assign', 'gateway-secret-set', 'gateway-previous-secret-set', 'gateway-secret-update', 'gateway-previous-secret-delete', 'gateway-deploy'].indexOf(action.kind);
}

export function createDenoCommandRunner({
  execute = execFileAsync,
  makeTemporaryDirectory = mkdtemp,
  removeTemporary = rm,
  temporaryDirectory = tmpdir,
  write = writeFile,
} = {}) {
  return async (args, { cwd, secretEnvironment } = {}) => {
    if (secretEnvironment === undefined) return executeDeno(execute, args, cwd);
    const directory = await makeTemporaryDirectory(join(temporaryDirectory(), 'tobirink-deno-env-'));
    const path = join(directory, '.env');
    try {
      await write(path, serializeSecretEnvironment(secretEnvironment), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return await executeDeno(execute, args.map(argument => argument === SECRET_FILE_TOKEN ? path : argument), cwd);
    } finally {
      await removeTemporary(directory, { force: true, recursive: true });
    }
  };
}

async function executeDeno(execute, args, cwd) {
  try {
    const { stdout } = await execute('deno', args, { cwd, encoding: 'utf8', env: { ...process.env }, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch {
    throw new Error('deno-provider-command-failed');
  }
}

function serializeSecretEnvironment(environment) {
  const entries = Object.entries(environment);
  if (entries.length !== 1) throw new Error('invalid-provider-gateway-secret-environment');
  const [name, value] = entries[0];
  if (!secretNames.has(name)) throw new Error('invalid-provider-gateway-secret-environment');
  assertSecret(value);
  return `${name}=${JSON.stringify(value)}\n`;
}

function assertSecret(value) {
  if (value !== String(value)) throw new Error('invalid-provider-gateway-secret');
  const length = Buffer.byteLength(value);
  if (length < 32 || length > 256) throw new Error('invalid-provider-gateway-secret');
}

function requiredIdentifier(value, name) {
  if (value !== String(value) || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)) throw new Error(`invalid-${name}`);
}

function parseJson(value, error) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(error);
  }
}

function parseEnvironmentInventory(value) {
  const parsed = parseJson(value, 'invalid-deno-environment');
  const variables = Array.isArray(parsed) ? parsed : parsed?.variables;
  if (!Array.isArray(variables)) throw new Error('invalid-deno-environment');
  return {
    variables: variables.map(variable => {
      if (variable === null || variable?.name !== String(variable?.name)) throw new Error('invalid-deno-environment');
      return { name: variable.name, secret: variable.secret === true || variable.type === 'secret' };
    }),
  };
}

function redact(value, secrets) {
  let redacted = value;
  for (const secret of secrets) if (secret === String(secret) && secret.length > 0) redacted = redacted.replaceAll(secret, '[REDACTED]');
  return redacted;
}
