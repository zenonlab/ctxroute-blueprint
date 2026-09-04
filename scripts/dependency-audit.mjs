import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const OUTPUT_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;

export function classifyAuditResult({ status, timedOut, stdout, stderr }) {
  if (timedOut) return { ok: false, infrastructureFailure: true, message: 'npm audit timed out' };
  let report;
  try { report = JSON.parse(stdout); } catch {}
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || !Number.isSafeInteger(vulnerabilities.high) || !Number.isSafeInteger(vulnerabilities.critical)) {
    const detail = String(report?.error?.summary ?? stderr ?? 'invalid npm audit response').trim().slice(0, 500);
    return { ok: false, infrastructureFailure: true, message: detail || 'invalid npm audit response' };
  }
  const blocking = vulnerabilities.high + vulnerabilities.critical;
  return { ok: blocking === 0, infrastructureFailure: false, blocking, vulnerabilities, status };
}

export async function runDependencyAudit({ timeoutMs = DEFAULT_TIMEOUT_MS, npmCli = process.env.npm_execpath, spawnProcess = spawn } = {}) {
  if (!npmCli) return { ok: false, infrastructureFailure: true, message: 'npm_execpath is unavailable; run through npm run audit:dependencies' };
  const result = await new Promise(resolve => {
    const child = spawnProcess(process.execPath, [npmCli, 'audit', '--audit-level=high', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-OUTPUT_LIMIT);
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); resolve({ status: null, timedOut, stdout, stderr: error.message }); });
    child.on('close', status => { clearTimeout(timer); resolve({ status, timedOut, stdout, stderr }); });
  });
  return classifyAuditResult(result);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runDependencyAudit();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.infrastructureFailure) process.stderr.write(`::warning title=Dependency audit unavailable::${result.message}\n`);
  else if (!result.ok) process.exitCode = 1;
}
