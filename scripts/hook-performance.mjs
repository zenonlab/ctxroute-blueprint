import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { hookContract } from '../.codex/hooks/lifecycle-contract.mjs';
import { handlerPlan, lifecycleEvents } from '../.codex/hooks/lifecycle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = mkdtempSync(join(tmpdir(), 'blueprint-hook-performance-state-'));
const fixture = mkdtempSync(join(root, '.hook-performance-'));
const hook = join(root, '.codex/hooks/lifecycle.mjs');
const samplesPerCase = 10;
const fixturePath = path => relative(root, path).split(sep).join('/');
const unsafePath = join(fixture, 'unsafe.js');
writeFileSync(unsafePath, "eval('performance fixture');\n");

const inputs = {
  SessionStart: { hook_event_name: 'SessionStart' },
  PreToolUse: { tool_name: 'Edit', tool_input: { file_path: 'scripts/hook-performance.mjs' } },
  PostToolUse: { tool_name: 'Edit', tool_input: { file_path: fixturePath(unsafePath) }, tool_response: {} },
  UserPromptSubmit: { prompt: 'continue', hook_event_name: 'UserPromptSubmit' },
  PreCompact: { hook_event_name: 'PreCompact' },
  Stop: { hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Work verified.' },
  SubagentStart: { agent_id: 'benchmark-agent', agent_type: 'Explore' },
  SubagentStop: { agent_id: 'benchmark-agent', agent_type: 'Explore' },
  SessionEnd: { hook_event_name: 'SessionEnd' },
};
const latencyLimits = { SessionStart: 1_500, PreToolUse: 250, PostToolUse: 500, UserPromptSubmit: 1_000, PreCompact: 1_000, Stop: 1_000, SubagentStart: 750, SubagentStop: 750, SessionEnd: 1_000 };
const results = [];
let failed = false;

try {
  for (const harness of ['codex', 'claude']) {
    for (const event of lifecycleEvents) {
      const samples = [];
      let contextChars = 0;
      let error;
      for (let sample = 0; sample < samplesPerCase; sample += 1) {
        const started = performance.now();
        const child = spawnSync(process.execPath, [hook, harness, event], {
          cwd: root,
          env: { ...process.env, CTXROUTE_STATE_DIR: state },
          input: JSON.stringify({ ...inputs[event], session_id: `performance-${harness}-${event}-${sample}` }),
          encoding: 'utf8',
          timeout: hookContract(harness, event, 'synchronous', root).timeoutMs,
        });
        samples.push(Math.round(performance.now() - started));
        let output = {};
        try { output = child.stdout.trim() ? JSON.parse(child.stdout) : {}; } catch { error = 'invalid dispatcher JSON'; }
        contextChars = Math.max(contextChars, String(output?.hookSpecificOutput?.additionalContext ?? '').length);
        if (child.status !== 0) error = child.error?.message ?? (child.stderr.trim() || `exit ${child.status}`);
      }
      const durationMs = percentile(samples, 0.95);
      const contract = hookContract(harness, event, 'synchronous', root);
      const ok = !error && durationMs <= latencyLimits[event] && contextChars <= contract.contextLimit;
      failed ||= !ok;
      results.push({ harness, event, durationMs, samples, latencyLimit: latencyLimits[event], contextChars, contextLimit: contract.contextLimit, handlers: handlerPlan(harness, event, root).map(item => item.name), ok, error });
    }
    const readOnlySamples = [];
    let readOnlyError;
    for (let sample = 0; sample < samplesPerCase; sample += 1) {
      const started = performance.now();
      const child = spawnSync(process.execPath, [hook, harness, 'PreToolUse'], {
        cwd: root,
        env: { ...process.env, CTXROUTE_STATE_DIR: state },
        input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'README.md' }, session_id: `performance-${harness}-read-${sample}` }),
        encoding: 'utf8',
        timeout: hookContract(harness, 'PreToolUse', 'synchronous', root).timeoutMs,
      });
      readOnlySamples.push(Math.round(performance.now() - started));
      if (child.status !== 0) readOnlyError = child.error?.message ?? (child.stderr.trim() || `exit ${child.status}`);
    }
    const readOnlyDuration = percentile(readOnlySamples, 0.95);
    const readOnlyOk = !readOnlyError && readOnlyDuration <= 100;
    failed ||= !readOnlyOk;
    results.push({ harness, event: 'PreToolUse:read-only', durationMs: readOnlyDuration, samples: readOnlySamples, latencyLimit: 100, contextChars: 0, contextLimit: hookContract(harness, 'PreToolUse', 'synchronous', root).contextLimit, handlers: [], ok: readOnlyOk, error: readOnlyError });
    if (!handlerPlan(harness, 'PostToolUse', root, 'maintenance').length) failed = true;
  }
} finally {
  rmSync(state, { recursive: true, force: true });
  rmSync(fixture, { recursive: true, force: true });
}

const maximumObservedLatencyMs = Math.max(...results.flatMap(result => result.samples));
const maximumObservedContextChars = Math.max(...results.map(result => result.contextChars));
process.stdout.write(`${JSON.stringify({ ok: !failed, samplesPerCase, lifecycleEvents, harnesses: ['codex', 'claude'], maintenancePlanCovered: true, maximumObservedLatencyMs, maximumObservedContextChars, results }, null, 2)}\n`);
if (failed) process.exitCode = 1;

function percentile(values, ratio) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}
