import { mkdir, open, rename, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

export async function emitDecisionEvent(root, config, event, dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const id = dependencies.id ?? (() => `${process.pid}-${now().getTime()}`);
  const complete = {
    schemaVersion: 1,
    sequence: event.sequence,
    event_id: `event-${id()}`.toLowerCase().replace(/[^a-z0-9._-]/gu, '-').slice(0, 128),
    event_type: event.event_type,
    operation_id: event.operation_id ?? null,
    revision_before: event.revision_before,
    revision_after: event.revision_after,
    entity_type: event.entity_type ?? 'transaction',
    entity_id: event.entity_id ?? null,
    transition: event.transition ?? null,
    mode: event.mode ?? null,
    mode_source: event.mode_source ?? null,
    skill_id: event.skill_id ?? null,
    skill_version: event.skill_version ?? null,
    validation_id: event.validation_id ?? null,
    duration_ms: event.duration_ms ?? null,
    exit_code: event.exit_code ?? null,
    git_oid_before: event.git_oid_before ?? null,
    git_oid_after: event.git_oid_after ?? null,
    result: event.result ?? 'SUCCESS',
    cause: event.cause ?? null,
    timestamp: now().toISOString(),
  };
  assertOrchestratorContract('decision-event-v1', complete);
  const path = resolve(root, config.telemetryPath);
  const source = `${JSON.stringify(complete)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const current = await stat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (current && current.size + Buffer.byteLength(source) > config.telemetryBytes) await rename(path, `${path}.1`);
  const handle = await open(path, 'a', 0o600);
  try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
  return complete;
}
