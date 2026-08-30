import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(new URL('../..', import.meta.url).pathname);

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gu, '<url>')
    .replace(/[0-9a-f]{8,}/giu, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/gu, '<n>')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function normalizeStructuralMessage(value) {
  return normalizeText(value)
    .replace(/\b(for|on|at|in|from)\s+\S+/gu, '$1 <var>')
    .replace(/(['"]).*?\1/gu, '<var>');
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/^time|timestamp|session|request|run|duration|pid$/iu.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return typeof value === 'string' ? normalizeText(value) : value;
}

function redactEvidence(value, depth = 0) {
  if (depth > 4) return '<depth-limit>';
  if (Array.isArray(value)) return value.slice(0, 20).map(item => redactEvidence(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/(?:password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)/iu.test(key))
      .slice(0, 40)
      .map(([key, item]) => [key, redactEvidence(item, depth + 1)]));
  }
  return typeof value === 'string' ? value.slice(0, 2000) : value;
}

export function extractObservation(input, event) {
  let value = input;
  if (typeof input === 'string') {
    try { value = JSON.parse(input); } catch { value = { raw: input }; }
  }
  if (!value || typeof value !== 'object') return null;

  const explicit = value.problem ?? value.problem_detected;
  const result = value.tool_result ?? value.tool_response ?? value.result ?? value.error ?? value.failure;
  const failed = value.success === false || value.is_error === true || value.exit_code > 0
    || (result && (result.is_error === true || result.success === false || result.error));
  const userReported = event === 'UserPromptSubmit' && (explicit || value.problemDetected === true);
  if (!failed && !userReported) return null;

  const details = typeof explicit === 'object' ? explicit : {};
  const message = details.message ?? value.error ?? value.failure ?? result?.error
    ?? value.message ?? value.prompt ?? value.raw ?? 'unspecified problem';
  const tool = value.tool_name ?? value.tool ?? details.tool ?? 'user';
  const target = value.tool_input?.file_path ?? value.file_path ?? details.target ?? '';
  const code = value.error_code ?? value.code ?? result?.code ?? details.code ?? '';
  const stack = value.stack ?? result?.stack ?? details.stack ?? '';
  return {
    event,
    kind: details.kind ?? (failed ? 'tool_failure' : 'user_report'),
    stage: details.stage ?? event,
    tool: String(tool),
    target: String(target),
    code: String(code),
    message: String(message),
    stack: String(stack),
    evidence: redactEvidence(canonicalize(value)),
  };
}

export function buildSignatures(observation) {
  const exact = canonicalize({
    kind: observation.kind,
    stage: observation.stage,
    tool: observation.tool,
    target: observation.target,
    code: observation.code,
    message: normalizeStructuralMessage(observation.message),
    message: observation.message,
    stack: observation.stack,
  });
  const structural = canonicalize({
    kind: observation.kind,
    stage: observation.stage,
    tool: observation.tool,
    target: observation.target,
    code: observation.code,
  });
  return {
    exactSignature: digest(exact),
    structuralSignature: digest(structural),
  };
}

function digest(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export class ProblemStore {
  constructor(stateDirectory) {
    mkdirSync(stateDirectory, { recursive: true });
    this.database = new DatabaseSync(join(stateDirectory, 'problem-memory.sqlite'));
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY,
      exact_signature TEXT NOT NULL UNIQUE,
      structural_signature TEXT NOT NULL,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      resolution_json TEXT,
      protection_status TEXT NOT NULL DEFAULT 'none'
    )`);
  }

  record(observation, signatures, now = new Date().toISOString(), options = {}) {
    const exact = this.database.prepare('SELECT * FROM problems WHERE exact_signature = ?').get(signatures.exactSignature);
    const structural = exact ?? (options.structuralMatch !== false
      ? this.database.prepare('SELECT * FROM problems WHERE structural_signature = ? ORDER BY last_seen DESC LIMIT 1').get(signatures.structuralSignature)
      : null);
    if (structural) {
      this.database.prepare(`UPDATE problems SET last_seen = ?, occurrences = occurrences + 1,
      evidence_json = ? WHERE id = ?`).run(now, appendEvidence(structural.evidence_json, observation.evidence), structural.id);
      return { ...structural, occurrences: structural.occurrences + 1, match: exact ? 'exact' : 'structural', last_seen: now };
    }
    const result = this.database.prepare(`INSERT INTO problems
      (exact_signature, structural_signature, first_seen, last_seen, kind, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?)`).run(signatures.exactSignature, signatures.structuralSignature,
      now, now, observation.kind, JSON.stringify([observation.evidence]));
    return { id: Number(result.lastInsertRowid), occurrences: 1, match: 'new', first_seen: now, last_seen: now };
  }

  close() { this.database.close(); }
}

function appendEvidence(serialized, evidence) {
  let history;
  try { history = JSON.parse(serialized); } catch { history = []; }
  return JSON.stringify([...history, evidence].slice(-20));
}

function readConfig() {
  try {
    return JSON.parse(requireConfig());
  } catch {
    return { enabled: false };
  }
}

function requireConfig() {
  return readFileSync(
    process.env.CTXROUTE_CONFIG_PATH ?? join(root, 'ctxroute-config.json'), 'utf8');
}

function emit(observation, record, config) {
  if (record.match === 'new' || record.occurrences < config.recurrenceThreshold) return null;
  return {
    systemMessage: `Recurring problem recognized (${record.occurrences} occurrences, ${record.match} signature). Reuse its recorded context before asking the user again. Protection mode: ${config.protectionMode}.`,
    hookSpecificOutput: {
      hookEventName: observation.event,
      additionalContext: JSON.stringify({ problemMemory: { problemId: record.id, occurrences: record.occurrences, signatureMatch: record.match } }),
    },
  };
}

export function handle(input, event, options = {}) {
  const configuration = options.config ?? readConfig().problemMemory;
  if (!configuration?.enabled || !configuration.recordOn?.includes(event)) return null;
  const observation = extractObservation(input, event);
  if (!observation) return null;
  const signatures = buildSignatures(observation);
  const store = new ProblemStore(options.stateDirectory ?? process.env.CTXROUTE_STATE_DIR ?? join(root, '.ctxroute', 'state'));
  try { return emit(observation, store.record(observation, signatures, new Date().toISOString(), configuration.matching), configuration); }
  finally { store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) input += chunk;
  try {
    const output = handle(input || '{}', process.argv[2] ?? 'PostToolUse');
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (error) {
    process.stderr.write(`Problem memory failed open: ${error.message}`);
  }
}
