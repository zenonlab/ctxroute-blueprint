import { spawnSync } from 'node:child_process';

const common = ['exec', '--', 'wrangler', 'd1', 'execute', 'tobirink-public', '--remote', '--config', 'apps/worker/wrangler.jsonc', '--json', '--command'];
const queries = {
  reasons: `SELECT state, COALESCE(failure_reason, 'NONE') AS reason, COUNT(*) AS requests
    FROM public_discovery_requests_v3 GROUP BY state, COALESCE(failure_reason, 'NONE') ORDER BY state, reason`,
  signals: `SELECT COALESCE(queue_signal_state, 'NONE') AS signal, COUNT(*) AS requests
    FROM public_discovery_requests_v3 GROUP BY COALESCE(queue_signal_state, 'NONE') ORDER BY signal`,
  pendingAges: `SELECT CASE
      WHEN retry_at <= datetime('now') THEN 'due'
      WHEN retry_at <= datetime('now', '+15 minutes') THEN '0-15m'
      WHEN retry_at <= datetime('now', '+1 hour') THEN '15-60m'
      ELSE '>60m' END AS age, COUNT(*) AS requests
    FROM public_discovery_requests_v3 WHERE state = 'PENDING' GROUP BY age ORDER BY age`,
};

function execute(command) {
  const result = spawnSync('npm', [...common, command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`discovery-diagnostics-query-failed:${result.status ?? 'signal'}`);
  const payload = JSON.parse(result.stdout);
  const first = Array.isArray(payload) ? payload[0] : payload;
  return { meta: first?.meta ?? null, rows: first?.results ?? [] };
}

const results = Object.fromEntries(Object.entries(queries).map(([name, command]) => [name, execute(command)]));
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  scope: 'aggregate-only',
  d1: Object.fromEntries(Object.entries(results).map(([name, value]) => [name, { rows: value.rows, rowsRead: value.meta?.rows_read ?? null, rowsWritten: value.meta?.rows_written ?? null }])),
  unavailable: ['extension-profile-counters', 'provider-latencies', 'worker-429-counts'],
})}\n`);
