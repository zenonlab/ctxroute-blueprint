import { constants, createReadStream, existsSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SECRET_KEY = /(?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)/iu;
const SECRET_VALUE = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/giu;
const MAX_FILES = 32;
const MAX_DIAGNOSTIC_LENGTH = 1024;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export async function auditSessions({ sessionPaths, approvedRoots, excludedPaths = [], currentSessionPath, outputPath, mission, maxBytes = 2 * 1024 * 1024, maxFiles = MAX_FILES, timeoutMs = 10_000 }) {
  if (!Array.isArray(sessionPaths) || sessionPaths.length === 0) throw new Error('sessionPaths must contain at least one trace');
  if (!Array.isArray(approvedRoots) || approvedRoots.length === 0) throw new Error('approvedRoots must contain at least one directory');
  if (!Array.isArray(excludedPaths)) throw new Error('excludedPaths must be an array');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2 * 1024 * 1024 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('audit limits are outside the supported range');
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > MAX_FILES) throw new Error(`maxFiles must be between 1 and ${MAX_FILES}`);
  if (sessionPaths.length > maxFiles) throw new Error(`sessionPaths exceeds the ${maxFiles} file limit`);

  const roots = await canonicalDirectories(approvedRoots);
  const ownArtifacts = [currentSessionPath, outputPath].filter(Boolean);
  const exclusions = await canonicalExclusions([...excludedPaths, ...ownArtifacts, SCRIPT_PATH]);
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  const observations = { files: new Set(), commands: new Map(), missionIds: new Set(), skillIds: new Set(), redactions: 0, malformed: 0, bytes: 0, truncated: false };
  let sessionsExamined = 0;
  const seen = new Set();
  let skippedActive = 0;
  let skippedExcluded = 0;
  for (const candidate of sessionPaths) {
    if (Date.now() >= deadline || observations.bytes >= maxBytes) { observations.truncated = true; break; }
    const trace = await authorizeTrace(candidate, roots);
    if (seen.has(trace)) continue;
    seen.add(trace);
    if (exclusions.has(trace)) { skippedExcluded += 1; continue; }
    if (isActiveTrace(trace)) { skippedActive += 1; continue; }
    sessionsExamined += 1;
    await streamTrace(trace, observations, maxBytes, deadline);
  }
  const signals = compareMission(mission, observations);
  if (observations.redactions) signals.push('secret-fields-redacted');
  if (observations.malformed) signals.push('malformed-records');
  if (observations.truncated) signals.push('bounded-read-truncated');
  if (skippedActive) signals.push('active-sessions-skipped');
  if (skippedExcluded) signals.push('self-traces-excluded');
  if (!signals.length) signals.push('no-defect-detected');
  return {
    audit_id: `audit-${safeIdentifier(mission?.mission_id ?? 'session-traces')}`,
    audit_type: 'session-audit',
    subject: { type: mission ? 'mission' : 'blueprint', id: safeText(mission?.mission_id ?? 'session-traces') },
    signals: [...new Set(signals)],
    decision: signals.length === 1 && signals[0] === 'no-defect-detected' ? 'accept' : 'repair',
    evidence_refs: [],
    proposed_action: signals.length === 1 && signals[0] === 'no-defect-detected' ? null : 'route-repair-through-orchestrator',
    applied_action: null,
    validations: [{
      id: 'trace-stream', status: 'PASSED', exit_code: null, duration_ms: Math.min(Date.now() - startedAt, 300_000), timed_out: false, cause: null,
      diagnostic: `files=${sessionsExamined};bytes=${observations.bytes};malformed=${observations.malformed};redactions=${observations.redactions};active-skipped=${skippedActive};self-excluded=${skippedExcluded}`,
    }],
    rollback_ref: null,
  };
}

async function canonicalDirectories(paths) {
  const result = [];
  for (const path of paths) {
    if (path !== String(path) || !isAbsolute(path)) throw new Error('approved roots must be absolute paths');
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error('approved roots must be real directories, not symlinks');
    result.push(await realpath(path));
  }
  return [...new Set(result)];
}

async function canonicalExclusions(paths) {
  const result = new Set();
  for (const path of paths) {
    if (path !== String(path) || !isAbsolute(path)) throw new Error('excluded paths must be absolute paths');
    try { result.add(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; result.add(resolve(path)); }
  }
  return result;
}

async function authorizeTrace(path, roots) {
  if (path !== String(path) || !isAbsolute(path)) throw new Error('session trace paths must be absolute');
  const details = await lstat(path);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error('session traces must be regular non-symlink files');
  const canonical = await realpath(path);
  if (!roots.some(root => isWithin(root, canonical))) throw new Error('session trace is outside approved roots');
  return canonical;
}

function isWithin(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function isActiveTrace(path) { return existsSync(`${path}.active`) || existsSync(`${path}.lock`); }

async function streamTrace(path, observations, maximum, deadline) {
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 16 * 1024, flags });
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
  if (Array.isArray(value)) return value.slice(0, 256).map(item => redact(item, observations, depth + 1));
  if (value && value === Object(value)) {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 256)) {
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
  const scopes = Array.isArray(mission.file_scope) ? mission.file_scope : [];
  const outside = [...observations.files].filter(path => !scopes.some(scope => path === scope || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)));
  if (outside.length) signals.push('files-outside-scope');
  const expectedCommands = Array.isArray(mission.validations)
    ? mission.validations.map(validation => [validation.executable, ...(validation.args ?? [])].join(' '))
    : Array.isArray(mission.validation_commands) ? mission.validation_commands : [];
  const missingCommands = expectedCommands.filter(command => !observations.commands.has(command));
  if (missingCommands.length) signals.push('validations-missing');
  const failed = [...observations.commands.values()].filter(code => Number.isInteger(code) && code !== 0).length;
  if (failed) signals.push('validations-failed');
  return signals;
}

function safeText(value) { return redact(String(value), { redactions: 0 }).slice(0, 128); }
function safeIdentifier(value) { return String(value).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '').slice(0, 120) || 'session-traces'; }
async function main() {
  const args = process.argv.slice(2);
  const roots = takeOptions(args, '--root');
  const exclusions = takeOptions(args, '--exclude');
  const currentSessions = takeOptions(args, '--current-session');
  const outputPaths = takeOptions(args, '--output');
  const missionPaths = takeOptions(args, '--mission');
  if (missionPaths.length > 1) throw new Error('--mission may be supplied only once');
  if (currentSessions.length > 1 || outputPaths.length > 1) throw new Error('--current-session and --output may each be supplied only once');
  const mission = missionPaths[0] ? JSON.parse(await readFile(missionPaths[0], 'utf8')) : undefined;
  const report = await auditSessions({ sessionPaths: args, approvedRoots: roots, excludedPaths: [...exclusions, ...missionPaths.map(path => resolve(path))], currentSessionPath: currentSessions[0], outputPath: outputPaths[0], mission });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function takeOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length;) {
    if (args[index] !== name) { index += 1; continue; }
    if (!args[index + 1]) throw new Error(`${name} requires a value`);
    values.push(resolve(args[index + 1]));
    args.splice(index, 2);
  }
  return values;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(error => { process.stderr.write(`${String(error.message).slice(0, MAX_DIAGNOSTIC_LENGTH)}\n`); process.exitCode = 1; });
