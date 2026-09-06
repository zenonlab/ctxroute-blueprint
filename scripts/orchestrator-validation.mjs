import { execFile as execFileCallback } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertNoSecrets, loadOrchestratorConfig, safeRelativePath } from './orchestrator-core.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

const execFile = promisify(execFileCallback);
const SECRET = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|authorization|cookie|credential|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/giu;

export async function runMissionValidations(mission, worktree, root = process.cwd(), dependencies = {}) {
  const config = await loadOrchestratorConfig(root);
  const runner = dependencies.execFile ?? execFile;
  const now = dependencies.now ?? (() => new Date());
  const results = [];
  for (const validation of mission.validations) {
    assertNoSecrets(validation);
    const cwd = await validationCwd(worktree, validation.cwd);
    const started = now().getTime();
    try {
      await runner(validation.executable, validation.args, {
        cwd,
        encoding: 'utf8',
        timeout: Math.min(validation.timeout_ms, config.subprocessTimeoutMs),
        maxBuffer: config.reportBytes,
        windowsHide: true,
        shell: false,
      });
      results.push(outcome(validation.id, 'PASSED', 0, now().getTime() - started, false, null, null));
    } catch (error) {
      const timedOut = Boolean(error.killed || error.signal === 'SIGTERM' || error.code === 'ETIMEDOUT');
      const exitCode = Number.isInteger(error.code) && error.code >= 0 && error.code <= 255 ? error.code : null;
      const diagnostic = redactDiagnostic(`${error.stderr ?? ''}\n${error.stdout ?? ''}`);
      results.push(outcome(validation.id, timedOut ? 'TIMED_OUT' : 'FAILED', exitCode, now().getTime() - started, timedOut, timedOut ? 'VALIDATION_TIMEOUT' : 'VALIDATION_FAILED', diagnostic));
    }
  }
  const status = results.some(item => item.status === 'TIMED_OUT') ? 'TIMED_OUT' : results.some(item => item.status !== 'PASSED') ? 'FAILED' : 'PASSED';
  const receipt = { receipt_id: `receipt-${mission.mission_id}-${now().getTime()}`, mission_id: mission.mission_id, status, results, completed_at: now().toISOString() };
  assertOrchestratorContract('validation-receipt-v2', receipt);
  return receipt;
}

async function validationCwd(worktree, cwd) {
  if (!safeRelativePath(cwd)) throw new Error('validation cwd must be repository-relative');
  const canonicalWorktree = await realpath(worktree);
  const candidate = resolve(canonicalWorktree, cwd);
  const details = await lstat(candidate);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('validation cwd must be a real directory');
  const canonical = await realpath(candidate);
  if (canonical !== canonicalWorktree && !canonical.startsWith(`${canonicalWorktree}${sep}`)) throw new Error('validation cwd escapes the worktree');
  return canonical;
}
function outcome(id, status, exit_code, duration, timed_out, cause, diagnostic) { return { id, status, exit_code, duration_ms: Math.min(Math.max(0, duration), 300_000), timed_out, cause, diagnostic }; }
function redactDiagnostic(source) { const sanitized = [...String(source).replace(SECRET, '<redacted>')].filter(character => { const code = character.codePointAt(0); return code === 9 || code === 10 || code === 13 || code >= 32; }).join(''); const value = sanitized.trim(); return value ? value.slice(0, 1024) : null; }
