import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/giu;

export async function auditSessions({ sessionPaths, mission, maxBytes = 2 * 1024 * 1024, timeoutMs = 10_000 }) {
  if (!Array.isArray(sessionPaths) || sessionPaths.length === 0) throw new Error('sessionPaths must contain at least one trace');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('audit limits must be positive integers');
  const deadline = Date.now() + timeoutMs;
  const observations = { files: new Set(), commands: new Map(), missionIds: new Set(), skillIds: new Set(), redactions: 0, malformed: 0, bytes: 0, truncated: false };
  const sessions = [];
  let skippedActive = 0;
  for (const path of sessionPaths) {
    if (Date.now() >= deadline || observations.bytes >= maxBytes) { observations.truncated = true; break; }
    if (isActiveTrace(path)) { skippedActive += 1; continue; }
    sessions.push(basename(path));
    await streamTrace(path, observations, maxBytes, deadline);
  }
  const signals = compareMission(mission, observations);
  if (observations.redactions) signals.push(`redacted-secret-fields:${observations.redactions}`);
  if (observations.malformed) signals.push(`malformed-records:${observations.malformed}`);
  if (observations.truncated) signals.push('bounded-read-truncated');
  if (skippedActive) signals.push(`active-sessions-skipped:${skippedActive}`);
  if (!signals.length) signals.push('no-defect-detected');
  return {
    sessions_examined: sessions,
    signals_detected: signals,
    subject: { type: mission ? 'mission' : 'blueprint', id: mission?.mission_id ?? 'session-traces' },
    decision: signals.length === 1 && signals[0] === 'no-defect-detected' ? 'accept' : 'correct-through-orchestrator',
    patch_applied: 'none; submit a reviewed patch through orchestrator audit.apply when correction is warranted',
    validations: [`streamed-bytes:${observations.bytes}`, `records-malformed:${observations.malformed}`],
    rollback: 'revert the orchestrator audit transaction and its referenced patch commit',
  };
}

function isActiveTrace(path) {
  return existsSync(`${path}.active`) || existsSync(`${path}.lock`);
}

async function streamTrace(path, observations, maximum, deadline) {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 16 * 1024 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (Date.now() >= deadline || observations.bytes + Buffer.byteLength(line) > maximum) { observations.truncated = true; stream.destroy(); break; }
      observations.bytes += Buffer.byteLength(line);
      let value;
      try { value = JSON.parse(line); } catch { observations.malformed += 1; continue; }
      visit(redact(value, observations), observations);
    }
  } finally { lines.close(); stream.destroy(); }
}

function redact(value, observations, depth = 0) {
  if (depth > 12) return '<depth-limit>';
  if (Array.isArray(value)) return value.map(item => redact(item, observations, depth + 1));
  if (value && value === Object(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) { result[key] = '<redacted>'; observations.redactions += 1; }
      else result[key] = redact(item, observations, depth + 1);
    }
    return result;
  }
  if (value === String(value)) return value.replace(SECRET_VALUE, () => { observations.redactions += 1; return '<redacted>'; }).slice(0, 4096);
  return value;
}

function visit(value, observations, key = '', depth = 0) {
  if (depth > 12) return;
  if (Array.isArray(value)) return value.forEach(item => visit(item, observations, key, depth + 1));
  if (value && value === Object(value)) {
    const command = value.command === String(value.command) ? value.command : value.cmd === String(value.cmd) ? value.cmd : null;
    const exitCode = Number.isInteger(value.exit_code) ? value.exit_code : Number.isInteger(value.exitCode) ? value.exitCode : null;
    if (command) observations.commands.set(command, exitCode);
    for (const [name, item] of Object.entries(value)) visit(item, observations, name, depth + 1);
    return;
  }
  if (/^(?:exit_code|exitCode)$/u.test(key) && Number.isInteger(value)) {
    const command = [...observations.commands.keys()].at(-1);
    if (command) observations.commands.set(command, value);
    return;
  }
  if (value !== String(value)) return;
  if (/^(?:file|file_path|path)$/iu.test(key) && !value.startsWith('<')) observations.files.add(value.replaceAll('\\', '/'));
  else if (/^(?:command|cmd)$/iu.test(key)) observations.commands.set(value, observations.commands.get(value) ?? null);
  else if (key === 'mission_id') observations.missionIds.add(value);
  else if (key === 'skill_id') observations.skillIds.add(value);
}

function compareMission(mission, observations) {
  if (!mission) return [];
  const signals = [];
  if (observations.missionIds.size && !observations.missionIds.has(mission.mission_id)) signals.push('mission-id-mismatch');
  if (observations.skillIds.size && !observations.skillIds.has(mission.skill_id)) signals.push('skill-id-mismatch');
  const outside = [...observations.files].filter(path => !mission.file_scope.some(scope => path === scope || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)));
  if (outside.length) signals.push(`files-outside-scope:${outside.length}`);
  const missingCommands = mission.validation_commands.filter(command => !observations.commands.has(command));
  if (missingCommands.length) signals.push(`validations-missing:${missingCommands.length}`);
  const failed = [...observations.commands.values()].filter(code => Number.isInteger(code) && code !== 0).length;
  if (failed) signals.push(`validations-failed:${failed}`);
  return signals;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const missionIndex = argumentsList.indexOf('--mission');
  let mission;
  if (missionIndex >= 0) {
    mission = JSON.parse(await readFile(argumentsList[missionIndex + 1], 'utf8'));
    argumentsList.splice(missionIndex, 2);
  }
  const report = await auditSessions({ sessionPaths: argumentsList, mission });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
