import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { policyDigest, resolveExecutionPolicy } from './orchestration-policy-core.mjs';

export const POLICY_SNAPSHOT_MAX_BYTES = 16 * 1024;

export async function writePolicySnapshot(policy, path, dependencies = {}) {
  assertOrchestratorContract('resolved-execution-policy', policy);
  const envelope = { policy, digest: policyDigest(policy) };
  const source = `${JSON.stringify(envelope)}\n`;
  if (Buffer.byteLength(source) >= POLICY_SNAPSHOT_MAX_BYTES) throw new Error('resolved policy snapshot exceeds 16 KiB');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${dependencies.id?.() ?? Date.now()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source); await handle.sync(); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } finally { await handle.close(); }
  await rename(temporary, path);
  return envelope;
}

export async function readPolicySnapshot(path) {
  const source = await readFile(path, 'utf8');
  if (Buffer.byteLength(source) >= POLICY_SNAPSHOT_MAX_BYTES) throw new Error('resolved policy snapshot exceeds 16 KiB');
  const envelope = JSON.parse(source);
  assertOrchestratorContract('resolved-execution-policy', envelope.policy);
  if (envelope.digest !== policyDigest(envelope.policy)) throw new Error('resolved policy snapshot digest mismatch');
  return envelope.policy;
}

export async function loadPolicySnapshot({ path, lastValid = null, config = {}, mutation = false }) {
  try { return { policy: await readPolicySnapshot(resolve(path)), source: 'snapshot' }; }
  catch (snapshotError) {
    if (lastValid) return { policy: lastValid, source: 'last-valid', diagnostic: snapshotError.message };
    const rebuilt = resolveExecutionPolicy({ requested_mode: config.default_mode ?? config.defaultMode ?? 'SWARM', workflow: 'STANDARD', capabilities: config.capabilities ?? ['git'] });
    if (rebuilt.resolution_status === 'RESOLVED') return { policy: rebuilt, source: 'rebuilt', diagnostic: snapshotError.message };
    return { policy: null, source: 'unverified', mutation_blocked: Boolean(mutation), diagnostic: `${snapshotError.message}; run orchestrator_explain_execution` };
  }
}
