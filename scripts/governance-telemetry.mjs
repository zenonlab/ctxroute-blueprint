import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAXIMUM_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 250;
const STALE_LOCK_MS = 5_000;
const ACTION = /^[a-z]+(?:[.-][a-z]+)*$/u;

export function emitGovernanceEvent(stateDirectory, decision, details = {}, dependencies = {}) {
  try {
    if (!ACTION.test(String(decision?.action ?? ''))) return false;
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    const path = join(stateDirectory, 'governance-events.jsonl');
    const event = {
      action: decision.action,
      decision: decision.decision,
      allowed: decision.allowed === true,
      approval_present: details.approvalPresent === true,
      receipt_present: details.receiptPresent === true,
      authority: details.authority === 'orchestrator' ? 'orchestrator' : null,
      timestamp: (dependencies.now?.() ?? new Date()).toISOString(),
    };
    const source = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(source) > MAXIMUM_BYTES) return false;
    const release = acquireLock(`${path}.lock`);
    if (!release) return false;
    try {
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(source) > MAXIMUM_BYTES) {
        const rotated = `${path}.1`;
        if (existsSync(rotated)) unlinkSync(rotated);
        renameSync(path, rotated);
      }
      appendFileSync(path, source, { encoding: 'utf8', mode: 0o600 });
    } finally {
      release();
    }
    return true;
  } catch {
    return false;
  }
}

function acquireLock(path) {
  const now = Date.now;
  const deadline = now() + LOCK_WAIT_MS;
  while (now() <= deadline) {
    try {
      const descriptor = openSync(path, 'wx', 0o600);
      return () => {
        closeSync(descriptor);
        try { unlinkSync(path); } catch {}
      };
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      try {
        if (now() - statSync(path).mtimeMs > STALE_LOCK_MS) { unlinkSync(path); continue; }
      } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  return null;
}
