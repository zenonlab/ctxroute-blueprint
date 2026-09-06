import { mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

export async function emitDecisionEvent(root, config, event, dependencies = {}) {
  const now = dependencies.now ?? (() => new Date());
  const id = dependencies.id ?? (() => randomUUID());
  const complete = {
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
    policy_id: event.policy_id ?? 'orchestrator',
    schema_id: event.schema_id ?? null,
    schema_path: sanitizeSchemaPath(event.schema_path),
    keyword: sanitizeKeyword(event.keyword),
    evidence_digest: event.evidence_digest ?? null,
    timestamp: now().toISOString(),
  };
  assertOrchestratorContract('decision-event', complete);
  const path = resolve(root, config.telemetryPath);
  const source = `${JSON.stringify(complete)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await withTelemetryLock(`${path}.lock`, dependencies, async () => {
    const current = await stat(path).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (current && current.size + Buffer.byteLength(source) > config.telemetryBytes) {
      await unlink(`${path}.1`).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await rename(path, `${path}.1`);
    }
    const handle = await open(path, 'a', 0o600);
    try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
  });
  return complete;
}

async function withTelemetryLock(path, dependencies, operation) {
  const now = dependencies.now ?? (() => new Date());
  const wait = dependencies.wait ?? (milliseconds => new Promise(resolveWait => { setTimeout(resolveWait, milliseconds); }));
  const processAlive = dependencies.processAlive ?? (pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } });
  const token = (dependencies.id ?? (() => randomUUID()))();
  const timeoutMs = 2000;
  const started = now().getTime();
  let handle;
  while (!handle) {
    try {
      handle = await open(path, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, created_at: now().toISOString() })}\n`);
      await handle.sync();
    } catch (error) {
      await handle?.close().catch(() => {}); handle = null;
      if (error.code !== 'EEXIST') throw error;
      const stale = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
      if (stale?.token && Number.isInteger(stale.pid) && !processAlive(stale.pid)) {
        const current = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
        if (current?.token === stale.token) await unlink(path).catch(() => {});
      }
      if (now().getTime() - started >= timeoutMs) throw new Error('telemetry lock timeout');
      await wait(25);
    }
  }
  try { return await operation(); }
  finally {
    await handle.close();
    const current = await readFile(path, 'utf8').then(JSON.parse).catch(() => null);
    if (current?.token === token) await unlink(path).catch(() => {});
  }
}

function sanitizeSchemaPath(value) {
  if (value === undefined || value === null) return null;
  const path = String(value).replace(/^#?/u, '').split('/').filter(Boolean).map(part => part.replace(/[^A-Za-z0-9._~-]/gu, '_')).join('/');
  return path ? `/${path}`.slice(0, 256) : null;
}
function sanitizeKeyword(value) { return value === undefined || value === null ? null : String(value).replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 64) || null; }
