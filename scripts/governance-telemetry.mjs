import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const MAXIMUM_BYTES = 64 * 1024;
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
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(source) > MAXIMUM_BYTES) {
      const rotated = `${path}.1`;
      if (existsSync(rotated)) unlinkSync(rotated);
      renameSync(path, rotated);
    }
    appendFileSync(path, source, { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}
