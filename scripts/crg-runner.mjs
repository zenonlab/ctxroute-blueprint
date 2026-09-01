import { spawn as defaultSpawn } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CRG_PROJECT = 'packages/code-review-graph';
export const CRG_VERSION = '2.3.8';
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_BYTES = 32 * 1024;

export function crgInvocation(args, root = process.cwd()) {
  return {
    executable: 'uv',
    args: ['run', '--project', resolve(root, CRG_PROJECT), '--frozen', 'code-review-graph', ...args],
  };
}

export async function runCrgCommand({ root = process.cwd(), args = [], timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = defaultSpawn, env = process.env } = {}) {
  const invocation = crgInvocation(args, root);
  const child = spawnImpl(invocation.executable, invocation.args, {
    cwd: root,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, UV_PROJECT_ENVIRONMENT: resolve(root, CRG_PROJECT, '.venv') },
  });
  return collectChild(child, timeoutMs);
}

export async function runCrgUpdate({ root = process.cwd(), timeoutMs, spawnImpl, env } = {}) {
  const graphDirectory = resolve(root, '.code-review-graph');
  const lockDirectory = join(graphDirectory, '.ctxroute-update.lock');
  await mkdir(graphDirectory, { recursive: true });
  try {
    await mkdir(lockDirectory);
  } catch (error) {
    if (error.code === 'EEXIST') return { code: 0, skipped: true, reason: 'update already running', stdout: '', stderr: '', timedOut: false };
    throw error;
  }
  try {
    const graph = join(graphDirectory, 'graph.db');
    const command = (await isFile(graph)) ? ['update', '--repo', root, '--skip-flows'] : ['build', '--repo', root];
    return { ...(await runCrgCommand({ root, args: command, timeoutMs, spawnImpl, env })), command };
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function collectChild(child, timeoutMs) {
  return new Promise((resolveResult, rejectResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 1_000).unref();
    }, timeoutMs);
    const append = (target, chunk) => {
      const next = Buffer.concat([Buffer.from(target), Buffer.from(chunk)]);
      return next.subarray(0, MAX_OUTPUT_BYTES).toString();
    };
    child.stdout?.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', chunk => { stderr = append(stderr, chunk); });
    child.once('error', error => { clearTimeout(timer); if (!settled) { settled = true; rejectResult(error); } });
    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ code, signal, stdout, stderr: timedOut ? `${stderr}\nTimed out after ${timeoutMs}ms`.trim() : stderr, timedOut });
    });
  });
}

function publicArgs(command, root) {
  return {
    build: ['build', '--repo', root],
    update: ['update', '--repo', root, '--skip-flows'],
    status: ['status', '--repo', root],
    review: ['detect-changes', '--repo', root, '--brief'],
    mcp: ['serve', '--repo', root],
    version: ['--version'],
  }[command];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = publicArgs(process.argv[2], process.cwd());
  if (!args) {
    console.error('Usage: node scripts/crg-runner.mjs build|update|status|review|mcp|version');
    process.exit(2);
  }
  const invocation = crgInvocation(args);
  const child = defaultSpawn(invocation.executable, invocation.args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, UV_PROJECT_ENVIRONMENT: resolve(process.cwd(), CRG_PROJECT, '.venv') },
  });
  child.once('error', error => { console.error(`Unable to start CRG: ${error.message}`); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
