import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = mkdtempSync(join(tmpdir(), 'blueprint-hook-performance-'));
const hook = join(root, '.codex/hooks/lifecycle.mjs');
const cases = [
  ['SessionStart', { session_id: 'performance', hook_event_name: 'SessionStart' }, 1500, 1400],
  ['UserPromptSubmit', { session_id: 'performance', prompt: 'continue', hook_event_name: 'UserPromptSubmit' }, 750, 1400],
  ['PreToolUse', { session_id: 'performance', tool_name: 'Edit', tool_input: { file_path: 'scripts/hook-performance.mjs' } }, 1000, 2200],
  ['PostToolUse', { session_id: 'performance', tool_name: 'Edit', tool_input: { file_path: 'AGENTS.md' }, tool_response: {} }, 1500, 1800],
  ['Stop', { session_id: 'performance', hook_event_name: 'Stop', last_assistant_message: 'Work verified.' }, 750, 1400],
];

const results = [];
let failed = false;
try {
  for (const [event, input, latencyLimit, contextLimit] of cases) {
    const started = performance.now();
    const child = spawnSync(process.execPath, [hook, 'codex', event], {
      cwd: root,
      env: { ...process.env, CTXROUTE_STATE_DIR: state },
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 5000,
    });
    const durationMs = Math.round(performance.now() - started);
    let output = {};
    try { output = child.stdout.trim() ? JSON.parse(child.stdout) : {}; } catch {}
    const contextChars = String(output?.hookSpecificOutput?.additionalContext ?? '').length;
    const ok = child.status === 0 && durationMs <= latencyLimit && contextChars <= contextLimit;
    failed ||= !ok;
    results.push({ event, durationMs, latencyLimit, contextChars, contextLimit, ok, error: child.error?.message ?? (child.stderr.trim() || undefined) });
  }
} finally {
  rmSync(state, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: !failed, results }, null, 2)}\n`);
if (failed) process.exitCode = 1;
