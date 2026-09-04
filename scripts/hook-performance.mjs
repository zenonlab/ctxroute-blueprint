import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = mkdtempSync(join(tmpdir(), 'blueprint-hook-performance-state-'));
const fixture = mkdtempSync(join(root, '.hook-performance-'));
const hook = join(root, '.codex/hooks/lifecycle.mjs');
const samplesPerCase = 3;
const fixturePath = path => relative(root, path).split(sep).join('/');

const unsafePath = join(fixture, '00-unsafe.js');
writeFileSync(unsafePath, "eval('performance fixture');\n");
for (let index = 1; index <= 24; index += 1) writeFileSync(join(fixture, `${String(index).padStart(2, '0')}-valid.js`), `export const value${index} = ${index};\n`);

const cases = [
  ['SessionStart', 'SessionStart', { hook_event_name: 'SessionStart' }, 1500, 1400],
  ['UserPromptSubmit', 'UserPromptSubmit', { prompt: 'continue', hook_event_name: 'UserPromptSubmit' }, 750, 1400],
  ['PreToolUse', 'PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'scripts/hook-performance.mjs' } }, 1000, 2200],
  ['PostToolUseSensor', 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: fixturePath(unsafePath) }, tool_response: {} }, 1500, 1800, /Sensor UNSAFE/u],
  ['StopDirty', 'Stop', { hook_event_name: 'Stop', last_assistant_message: 'Work verified.' }, 750, 1400],
];

const results = [];
let failed = false;
try {
  for (const [name, event, baseInput, latencyLimit, contextLimit, requiredPattern] of cases) {
    const samples = [];
    let contextChars = 0;
    let error;
    let requiredOutput = !requiredPattern;
    for (let sample = 0; sample < samplesPerCase; sample += 1) {
      const started = performance.now();
      const child = spawnSync(process.execPath, [hook, 'codex', event], {
        cwd: root,
        env: { ...process.env, CTXROUTE_STATE_DIR: state },
        input: JSON.stringify({ ...baseInput, session_id: `performance-${name}-${sample}` }),
        encoding: 'utf8',
        timeout: 5000,
      });
      samples.push(Math.round(performance.now() - started));
      let output = {};
      try { output = child.stdout.trim() ? JSON.parse(child.stdout) : {}; } catch {}
      const serialized = JSON.stringify(output);
      contextChars = Math.max(contextChars, String(output?.hookSpecificOutput?.additionalContext ?? '').length);
      requiredOutput ||= requiredPattern?.test(serialized);
      if (child.status !== 0) error = child.error?.message ?? (child.stderr.trim() || `exit ${child.status}`);
    }
    const durationMs = median(samples);
    const ok = !error && durationMs <= latencyLimit && contextChars <= contextLimit && requiredOutput;
    failed ||= !ok;
    results.push({ event: name, durationMs, samples, latencyLimit, contextChars, contextLimit, requiredOutput, ok, error });
  }
} finally {
  rmSync(state, { recursive: true, force: true });
  rmSync(fixture, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ ok: !failed, samplesPerCase, results }, null, 2)}\n`);
if (failed) process.exitCode = 1;

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)];
}
