import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { publicDiscoverySubmissionSchema } from '../../packages/public-discovery/src/contracts.ts';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_INPUT = 10_000;
const REQUEST_PATH = '/v3/catalogue/discoveries/requests';

function integer(value, fallback, minimum, maximum) {
  const parsed = value === undefined ? fallback : Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum, 'invalid reconciliation limit');
  return parsed;
}

function argumentsFrom(argv) {
  const options = { dryRun: true, maxAdmissions: DEFAULT_LIMIT, baseUrl: 'https://tobirink.com', input: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') options.dryRun = true;
    else if (value === '--apply') options.dryRun = false;
    else if (value === '--input') options.input = argv[++index];
    else if (value === '--base-url') options.baseUrl = argv[++index];
    else if (value === '--max-admissions') options.maxAdmissions = integer(argv[++index], DEFAULT_LIMIT, 1, MAX_LIMIT);
    else throw new Error('unknown reconciliation option');
  }
  assert.ok(options.input !== undefined, 'reconciliation input is required');
  const url = new URL(options.baseUrl);
  assert.ok(url.protocol === 'https:', 'reconciliation base URL must use HTTPS');
  return { ...options, baseUrl: url.origin };
}

function loadSubmissions(value) {
  const entries = Array.isArray(value) ? value : value?.submissions;
  assert.ok(Array.isArray(entries), 'reconciliation input must contain submissions');
  const unique = new Map();
  for (const entry of entries) {
    const parsed = publicDiscoverySubmissionSchema.parse(entry);
    const serializedKey = JSON.stringify(parsed.key);
    assert.ok(!unique.has(serializedKey), 'duplicate reconciliation key');
    unique.set(serializedKey, parsed);
  }
  return [...unique.values()];
}

export async function runDiscoveryReconciliation(options, fetcher = globalThis.fetch) {
  const submissions = loadSubmissions(options.submissions);
  const maxAdmissions = integer(options.maxAdmissions, DEFAULT_LIMIT, 1, MAX_LIMIT);
  assert.ok(submissions.length <= MAX_INPUT, 'reconciliation input exceeds hard limit');
  const selected = submissions.slice(0, maxAdmissions);
  const result = { attempted: 0, accepted: 0, deduplicated: 0, stopped: undefined, dryRun: options.dryRun !== false };
  if (result.dryRun) return { ...result, selected: selected.length };
  for (const submission of selected) {
    result.attempted += 1;
    const response = await fetcher(new URL(REQUEST_PATH, options.baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      body: JSON.stringify(submission), redirect: 'error',
    });
    if (response.status === 429) { result.stopped = 'rate-limited'; break; }
    if (response.status === 503) { result.stopped = 'queue-or-capacity-unavailable'; break; }
    if (!response.ok) { result.stopped = `http-${response.status}`; break; }
    const body = await response.json().catch(() => ({}));
    if (body?.state === 'PENDING') result.accepted += 1;
    else if (body?.state === 'VERIFIED' || body?.state === 'UNAVAILABLE') result.deduplicated += 1;
    else { result.stopped = 'invalid-admission-response'; break; }
  }
  return { ...result, selected: selected.length };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const submissions = JSON.parse(await readFile(resolve(options.input), 'utf8'));
  const result = await runDiscoveryReconciliation({ ...options, submissions });
  process.stdout.write(JSON.stringify({ attempted: result.attempted, accepted: result.accepted, deduplicated: result.deduplicated, selected: result.selected, stopped: result.stopped ?? null, dryRun: result.dryRun }) + '\n');
  if (result.stopped !== undefined) process.exitCode = 2;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) await main();
