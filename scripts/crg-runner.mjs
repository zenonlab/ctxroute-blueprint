import { spawn as defaultSpawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

export async function runCrgUpdate({ cwd = process.cwd(), databasePath = resolve(cwd, '.ctxroute/state/code-review-graph.sqlite'), executable = 'uvx', args = ['code-review-graph', 'update'], timeoutMs = DEFAULT_TIMEOUT_MS, signal, spawnImpl = defaultSpawn } = {}) {
  await mkdir(dirname(databasePath), { recursive: true });
  const database = await openWalDatabase(databasePath);
  const startedAt = Date.now();
  let child;
  try {
    child = spawnImpl(executable, args, { cwd, shell: false, signal, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CRG_DATABASE_PATH: databasePath } });
    const result = await collectChild(child, timeoutMs);
    database.insert.run(new Date().toISOString(), result.code, result.signal, result.stdout, result.stderr, Date.now() - startedAt);
    return { ...result, databasePath, durationMs: Date.now() - startedAt };
  } finally {
    if (child && child.exitCode === null && !child.signalCode) child.kill('SIGTERM');
    database.close();
  }
}

async function openWalDatabase(databasePath) {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import('node:sqlite')); }
  catch { throw new Error('SQLite requires a Node.js release with node:sqlite support'); }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS crg_updates (id INTEGER PRIMARY KEY, finished_at TEXT NOT NULL, exit_code INTEGER, signal TEXT, stdout TEXT NOT NULL, stderr TEXT NOT NULL, duration_ms INTEGER NOT NULL);');
  return { insert: db.prepare('INSERT INTO crg_updates (finished_at, exit_code, signal, stdout, stderr, duration_ms) VALUES (?, ?, ?, ?, ?, ?)'), close: () => db.close() };
}

function collectChild(child, timeoutMs) {
  return new Promise((resolveResult, rejectResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish({ code: null, signal: 'SIGTERM', stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(), timedOut: true }); }, timeoutMs);
    const append = (target, chunk) => { const next = `${target}${chunk}`; return Buffer.byteLength(next) > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next; };
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; rejectResult(error); } });
    child.once('close', (code, signal) => finish({ code, signal, stdout, stderr, timedOut: false }));
    function finish(result) { if (settled) return; settled = true; clearTimeout(timer); resolveResult(result); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCrgUpdate({ databasePath: process.argv[2] ? resolve(process.argv[2]) : undefined })
    .then(result => { console.log(JSON.stringify({ ok: result.code === 0 && !result.timedOut, ...result })); process.exitCode = result.code === 0 && !result.timedOut ? 0 : 1; })
    .catch(error => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 2; });
}
