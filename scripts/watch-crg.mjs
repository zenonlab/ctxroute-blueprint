import { watch } from 'node:fs';
import { resolve } from 'node:path';
import { runCrgUpdate } from './crg-runner.mjs';

const IGNORED = new Set(['.git', 'node_modules', 'dist', 'coverage', '.ctxroute']);

export function createCrgWatcher({ root = process.cwd(), debounceMs = 150, runUpdate = runCrgUpdate, watchImpl = watch } = {}) {
  let timer;
  let running = false;
  let pending = false;
  let stopped = false;
  let active;
  let activeAbort;
  const changed = new Set();
  const watcher = watchImpl(root, { recursive: true }, (_event, filename) => {
    const relative = filename?.toString() ?? '';
    if (!relative || relative.split(/[\\/]/u).some(part => IGNORED.has(part))) return;
    changed.add(relative);
    schedule();
  });
  function schedule() { clearTimeout(timer); if (stopped) return; if (running) { pending = true; return; } timer = setTimeout(flush, debounceMs); }
  async function flush() {
    if (stopped || running || changed.size === 0) return;
    running = true; pending = false;
    const paths = [...changed]; changed.clear();
    activeAbort = new AbortController();
    active = runUpdate({ cwd: resolve(root), changedPaths: paths, signal: activeAbort.signal });
    try { await active; } finally { running = false; active = undefined; activeAbort = undefined; if (pending || changed.size) schedule(); }
  }
  return { close() { stopped = true; clearTimeout(timer); watcher.close(); activeAbort?.abort(); }, flush, state: () => ({ running, pending, changedPaths: [...changed], stopped }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = createCrgWatcher({ root: resolve(process.argv[2] ?? process.cwd()) });
  const stop = () => { controller.close(); process.exitCode = 0; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log(JSON.stringify({ ok: true, watching: process.argv[2] ?? process.cwd() }));
}
