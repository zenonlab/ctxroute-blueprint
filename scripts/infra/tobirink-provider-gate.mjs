import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyApprovedPlan, createOperationPlan } from './provider-gate-core.mjs';
import { createCloudflareDriver, loadCloudflareConfig } from './cloudflare-driver.mjs';

export async function runProviderGate(argv, { cwd = process.cwd(), stdout = console.log } = {}) {
  const { command, values } = parseArguments(argv);
  const workerDirectory = resolve(cwd, 'apps/worker');
  const config = await loadCloudflareConfig(resolve(workerDirectory, 'wrangler.jsonc'));
  const driver = createCloudflareDriver({ config, workerDirectory });

  if (command === 'inspect') {
    stdout(JSON.stringify(await driver.inspect(required(values.account, '--account')), null, 2));
    return;
  }

  if (command === 'plan') {
    const accountId = required(values.account, '--account');
    const operations = list(values.operation, '--operation');
    const actions = driver.resolveOperations(operations);
    const inspection = await driver.inspect(accountId);
    const preview = await driver.preview(actions);
    const plan = createOperationPlan({
      driverId: driver.id,
      accountId,
      inspection,
      preview,
      actions,
    });
    stdout(JSON.stringify(plan, null, 2));
    return;
  }

  if (command === 'apply') {
    const plan = JSON.parse(await readFile(required(values.plan, '--plan'), 'utf8'));
    const result = await applyApprovedPlan({
      driver,
      plan,
      approvedDigest: required(values.approve, '--approve'),
      accountId: required(values.account, '--account'),
      resourceAllowlist: list(values.allow, '--allow'),
    });
    stdout(JSON.stringify({ appliedPlan: plan.digest, result }, null, 2));
    return;
  }

  throw new Error('usage: inspect --account <id> | plan --account <id> --operation <name> | apply --plan <file> --approve <digest> --account <id> --allow <resource>');
}

function parseArguments(argv) {
  const [command, ...args] = argv;
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined || value.startsWith('--')) throw new Error(`invalid-argument:${flag ?? ''}`);
    const key = flag.slice(2);
    if (!['account', 'operation', 'plan', 'approve', 'allow'].includes(key)) throw new Error(`unknown-argument:${flag}`);
    values[key] = values[key] === undefined ? value : [...(Array.isArray(values[key]) ? values[key] : [values[key]]), value];
  }
  return { command, values };
}

function required(value, flag) {
  if (value !== String(value) || value.length === 0) throw new Error(`missing-argument:${flag}`);
  return value;
}

function list(value, flag) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (values.length === 0) throw new Error(`missing-argument:${flag}`);
  return values;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runProviderGate(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
