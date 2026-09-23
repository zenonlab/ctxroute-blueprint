import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const common = ['exec', '--', 'wrangler', 'd1', 'execute', 'tobirink-public', '--remote', '--config', 'apps/worker/wrangler.jsonc', '--json', '--command'];
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

function execute(command) {
  const result = spawnSync('npm', [...common, command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('diagnostic-query-failed');
  const payload = JSON.parse(result.stdout);
  const first = Array.isArray(payload) ? payload[0] : payload;
  if (first?.success === false || !Array.isArray(first?.results)) throw new Error('diagnostic-response-invalid');
  return { meta: first.meta ?? null, rows: first.results };
}

export function collectDiscoveryDiagnostics({ now = new Date().toISOString(), query = execute } = {}) {
  const d1 = {};
  const missing = [];
  for (const [name, command] of Object.entries(discoveryDiagnosticQueries(now))) {
    try {
      const value = query(command);
      // Only the requested aggregate columns may leave this diagnostic boundary.
      const columns = { reasons: ['media', 'state', 'reason', 'requests'], signals: ['media', 'state', 'signal', 'requests'], pendingAges: ['media', 'age', 'requests'], pendingDeadlines: ['media', 'deadline', 'requests'] }[name];
      if (!Array.isArray(value?.rows) || value.rows.some(row => Object.keys(row).some(key => !columns.includes(key)))) throw new Error('diagnostic-response-invalid');
      d1[name] = { rows: value.rows, rowsRead: value.meta?.rows_read ?? null, rowsWritten: value.meta?.rows_written ?? null };
    } catch { missing.push(`d1-${name}`); }
  }
  return {
    schemaVersion: 2,
    ok: missing.length === 0,
    generatedAt: now,
    scope: 'aggregate-only',
    queryCostScope: 'these-diagnostic-queries-only',
    d1,
    unavailable: ['extension-profile-counters', 'provider-latencies', 'worker-429-counts', ...missing],
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = collectDiscoveryDiagnostics();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}
