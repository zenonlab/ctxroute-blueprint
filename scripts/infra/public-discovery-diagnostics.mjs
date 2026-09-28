import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const wranglerCli = resolve(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'wrangler-dist/cli.js');
const common = ['--no-warnings', wranglerCli, 'd1', 'execute', 'tobirink-public', '--remote', '--config', 'apps/worker/wrangler.jsonc', '--json', '--command'];
const failureCodes = new Set(['account-missing', 'account-invalid', 'access-denied', 'token-location-denied', 'authentication-failed', 'timeout', 'output-limit', 'command-unavailable', 'transport-failed', 'query-failed', 'response-invalid']);
const tokenVerifyUrl = 'https://api.cloudflare.com/client/v4/user/tokens/verify';

export async function verifyDiagnosticToken({ environment = process.env, request = globalThis.fetch } = {}) {
  if (!environment.CLOUDFLARE_API_TOKEN) return { ok: false, code: 'token-missing' };
  let response;
  let payload;
  try {
    response = await request(tokenVerifyUrl, {
      headers: { Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}` },
      signal: globalThis.AbortSignal.timeout(5_000),
    });
    if (Number(response.headers?.get('content-length')) > 16_384) return { ok: false, code: 'token-response-invalid' };
    const body = await response.text();
    if (body.length > 16_384) return { ok: false, code: 'token-response-invalid' };
    payload = JSON.parse(body);
  } catch { return { ok: false, code: 'token-transport-failed' }; }
  const httpStatus = Number.isInteger(response.status) ? response.status : null;
  const cloudflareCode = Array.isArray(payload?.errors) && Number.isInteger(payload.errors[0]?.code) ? payload.errors[0].code : null;
  if (Array.isArray(payload?.errors) && payload.errors.some(error => /Cannot use the access token from location\b/iu.test(error?.message ?? ''))) {
    return { ok: false, code: 'token-location-denied', httpStatus, cloudflareCode };
  }
  if (payload?.result?.status === 'expired' || payload?.result?.status === 'disabled') {
    return { ok: false, code: `token-${payload.result.status}`, httpStatus, cloudflareCode };
  }
  if (!response.ok || payload?.success !== true) return { ok: false, code: 'token-verification-failed', httpStatus, cloudflareCode };
  if (payload?.result?.status !== 'active') return { ok: false, code: 'token-response-invalid', httpStatus, cloudflareCode };
  return { ok: true, status: 'active' };
}
export function discoveryDiagnosticQueries(now) {
  if (new Date(now).toISOString() !== now) throw new TypeError('invalid-diagnostic-clock');
  return {
    reasons: `SELECT media_kind AS media, state, COALESCE(failure_reason, 'NONE') AS reason, COUNT(*) AS requests
      FROM public_discovery_requests_v3 GROUP BY media_kind, state, COALESCE(failure_reason, 'NONE') ORDER BY media, state, reason`,
    signals: `SELECT media_kind AS media, state, queue_signal_state AS signal, COUNT(*) AS requests
      FROM public_discovery_requests_v3 GROUP BY media_kind, state, queue_signal_state ORDER BY media, state, signal`,
    pendingAges: `SELECT media_kind AS media, CASE
        WHEN julianday(created_at) IS NULL OR julianday(created_at) > julianday('${now}') THEN 'invalid-clock'
        WHEN julianday(created_at) >= julianday('${now}', '-15 minutes') THEN '0-15m'
        WHEN julianday(created_at) >= julianday('${now}', '-1 hour') THEN '15-60m'
        ELSE '>60m' END AS age, COUNT(*) AS requests
      FROM public_discovery_requests_v3 WHERE state = 'PENDING' GROUP BY media, age ORDER BY media, age`,
    pendingDeadlines: `SELECT media_kind AS media, CASE
        WHEN julianday(retry_at) IS NULL THEN 'invalid-clock'
        WHEN julianday(retry_at) <= julianday('${now}') THEN 'due'
        WHEN julianday(retry_at) <= julianday('${now}', '+15 minutes') THEN '0-15m'
        WHEN julianday(retry_at) <= julianday('${now}', '+1 hour') THEN '15-60m'
        ELSE '>60m' END AS deadline, COUNT(*) AS requests
      FROM public_discovery_requests_v3 WHERE state = 'PENDING' GROUP BY media, deadline ORDER BY media, deadline`,
  };
}

function commandFailureCode(result) {
  if (result.error?.code === 'ETIMEDOUT') return 'timeout';
  if (result.error?.code === 'ENOBUFS') return 'output-limit';
  if (result.error?.code === 'ENOENT') return 'command-unavailable';
  const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  if (/Cannot use the access token from location\b/iu.test(output)) return 'token-location-denied';
  if (/\[code: 910[69]\]|\bForbidden\b/iu.test(output)) return 'access-denied';
  if (/\[code: 10000\]|Authentication error|\bUnauthorized\b/iu.test(output)) return 'authentication-failed';
  if (/\b(?:ENOTFOUND|ECONNRESET|EAI_AGAIN|ETIMEDOUT)\b|fetch failed/iu.test(output)) return 'transport-failed';
  return 'query-failed';
}

export function executeDiagnosticQuery(command, { run = spawnSync, environment = process.env } = {}) {
  if (!environment.CLOUDFLARE_ACCOUNT_ID) throw new Error('account-missing');
  if (!/^[a-f0-9]{32}$/u.test(environment.CLOUDFLARE_ACCOUNT_ID)) throw new Error('account-invalid');
  const env = { ...environment, WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_SEND_ERROR_REPORTS: 'false', FORCE_COLOR: '0' };
  delete env.WRANGLER_OUTPUT_FILE_PATH;
  delete env.WRANGLER_OUTPUT_FILE_DIRECTORY;
  let result;
  try {
    result = run(process.execPath, [...common, command], { cwd: new URL('../../', import.meta.url), env, encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
  } catch { throw new Error('query-failed'); }
  if (result.status !== 0 || result.error) throw new Error(commandFailureCode(result));
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { throw new Error('response-invalid'); }
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (first?.success === false || !Array.isArray(first?.results)) throw new Error('response-invalid');
  return { meta: first.meta ?? null, rows: first.results };
}

export function collectDiscoveryDiagnostics({ now = new Date().toISOString(), query = executeDiagnosticQuery } = {}) {
  const d1 = {};
  const missing = [];
  const failures = [];
  for (const [name, command] of Object.entries(discoveryDiagnosticQueries(now))) {
    try {
      const value = query(command);
      // Only the requested aggregate columns may leave this diagnostic boundary.
      const columns = { reasons: ['media', 'state', 'reason', 'requests'], signals: ['media', 'state', 'signal', 'requests'], pendingAges: ['media', 'age', 'requests'], pendingDeadlines: ['media', 'deadline', 'requests'] }[name];
      if (!Array.isArray(value?.rows) || value.rows.some(row => Object.keys(row).some(key => !columns.includes(key)))) throw new Error('response-invalid');
      d1[name] = { rows: value.rows, rowsRead: value.meta?.rows_read ?? null, rowsWritten: value.meta?.rows_written ?? null };
    } catch (error) {
      missing.push(`d1-${name}`);
      failures.push({ query: name, code: failureCodes.has(error?.message) ? error.message : 'query-failed' });
    }
  }
  return {
    schemaVersion: 2,
    ok: missing.length === 0,
    generatedAt: now,
    scope: 'aggregate-only',
    queryCostScope: 'these-diagnostic-queries-only',
    d1,
    failures,
    unavailable: ['extension-profile-counters', 'provider-latencies', 'worker-429-counts', ...missing],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = process.argv[2] === '--verify-token' ? await verifyDiagnosticToken() : collectDiscoveryDiagnostics();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}
