import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_FIELD_LENGTH = 4000;

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gu, '<url>')
    .replace(/[0-9a-f]{8,}/giu, '<id>')
    .replace(/\b\d+(?:\.\d+)?\b/gu, '<n>')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .slice(0, MAX_FIELD_LENGTH);
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
      .filter(([key]) => !/^(?:time|timestamp|session|request|run|duration|pid)(?:_|$)/iu.test(key))
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
  const failed = value.success === false || value.ok === false || value.is_error === true
    || value.exit_code > 0 || value.exitCode > 0 || value.status === 'error'
    || Boolean(value.error_message)
    || (result && (result.is_error === true || result.success === false || result.error));
  const userReported = event === 'UserPromptSubmit' && (explicit || value.problemDetected === true);
  if (!failed && !userReported) return null;

  const details = typeof explicit === 'object' ? explicit : {};
  const message = details.message ?? value.error_message ?? value.error ?? value.failure ?? result?.error
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
    message: fieldText(message),
    stack: fieldText(stack),
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
    message: normalizeText(observation.message),
    stack: observation.stack,
  });
  const structural = canonicalize({
    kind: observation.kind,
    stage: observation.stage,
    tool: observation.tool,
    target: observation.target,
    code: observation.code,
    message: normalizeStructuralMessage(observation.message),
  });
  return {
    exactSignature: digest(exact),
    structuralSignature: digest(structural),
  };
}

function fieldText(value) {
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, MAX_FIELD_LENGTH); } catch { return '[unserializable]'; }
  }
  return String(value ?? '').slice(0, MAX_FIELD_LENGTH);
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

  resolve(problemId, resolution, now = new Date().toISOString()) {
    if (!resolution || typeof resolution !== 'object' || !resolution.type || !resolution.summary) {
      throw new TypeError('A resolution requires type and summary');
    }
    const result = this.database.prepare(`UPDATE problems SET resolution_json = ?, protection_status = ?, last_seen = ? WHERE id = ?`)
      .run(JSON.stringify(redactEvidence(resolution)), resolution.protectionStatus ?? 'resolved', now, problemId);
    return result.changes > 0;
  }

  get(problemId) {
    return this.database.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
  }

  close() { this.database.close(); }
}

export function resolveProblem(problemId, resolution, stateDirectory, projectRoot = root) {
  if (resolution?.type === 'persistent-instruction' && resolution.approved !== true) {
    throw new TypeError('A persistent instruction requires approved: true');
  }
  const store = new ProblemStore(stateDirectory ?? process.env.CTXROUTE_STATE_DIR ?? join(root, '.ctxroute', 'state'));
  try {
    if (!store.get(Number(problemId))) return false;
    if (resolution.type === 'persistent-instruction' && resolution.approved === true) {
      applyPersistentInstruction(problemId, resolution, projectRoot);
    }
    return store.resolve(Number(problemId), resolution);
  } finally {
    store.close();
  }
}

export function applyPersistentInstruction(problemId, resolution, projectRoot = root) {
  if (resolution?.type !== 'persistent-instruction' || resolution.approved !== true) {
    throw new TypeError('A persistent instruction requires approved: true');
  }
  const numericId = Number(problemId);
  if (!Number.isSafeInteger(numericId) || numericId < 1) throw new TypeError('Problem id must be a positive integer');
  const scope = resolution.scope ?? {};
  const paths = validateInstructionPaths(scope.paths);
  const tools = validateInstructionTools(scope.tools);
  const directory = join(projectRoot, '.claude', 'hooks', 'docs', 'problem-memory');
  mkdirSync(directory, { recursive: true });
  const content = fieldText(resolution.content ?? resolution.summary);
  const artifacts = [];
  let index = 0;
  for (const path of paths) {
    for (const tool of tools) {
      const artifactPath = join(directory, `problem-${numericId}-${index}.md`);
      writeFileSync(artifactPath, [
        '---',
        `tool: ${formatYaml(tool)}`,
        `scope: [${formatYaml(path)}]`,
        'mode: dumb',
        '---',
        `# Problem ${numericId} protection`,
        '',
        content,
        '',
      ].join('\n'), { encoding: 'utf8', flag: 'wx' });
      artifacts.push(artifactPath);
      index += 1;
    }
  }
  return artifacts[0];
}

export function validateInstructionPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new TypeError('Instruction paths must contain at least one repository-relative file');
  }
  return paths.map(path => {
    if (typeof path !== 'string') throw new TypeError('Instruction paths must be strings');
    const normalized = path.trim().replace(/\\/gu, '/');
    if (!normalized || normalized === '.' || normalized.endsWith('/') || normalized.includes('*')
      || normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:\//u.test(normalized)
      || normalized.split('/').some(segment => segment === '..' || segment === '.')) {
      throw new TypeError('Instruction paths must be unambiguous repository-relative files without globs or parent traversal');
    }
    return normalized;
  });
}

export function validateInstructionTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new TypeError('Instruction tools must contain at least one exact CTXRoute tool');
  }
  return tools.map(tool => {
    if (typeof tool !== 'string' || !tool.trim() || tool.trim() === '*' || /[\r\n]/u.test(tool)) {
      throw new TypeError('Instruction tools must be non-empty exact tool names');
    }
    return tool.trim();
  });
}

function formatYaml(value) {
  return JSON.stringify(String(value));
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
  const threshold = validThreshold(config.recurrenceThreshold);
  if (record.match === 'new' || record.occurrences < threshold) return null;
  let resolution = null;
  try { resolution = record.resolution_json ? JSON.parse(record.resolution_json) : null; } catch { resolution = null; }
  const proposal = resolution ? null : {
    type: 'protection-proposal',
    allowedActions: ['correction', 'refactor', 'persistent-instruction', 'specific-hook'],
    approvalRequired: true,
    scope: { event: observation.event, tool: observation.tool, target: observation.target },
  };
  return {
    systemMessage: resolution
      ? `Recurring problem recognized (${record.occurrences} occurrences). Reuse the approved resolution before asking the user again.`
      : `Recurring problem recognized (${record.occurrences} occurrences, ${record.match} signature). A protection proposal requires approval.`,
    hookSpecificOutput: {
      hookEventName: observation.event,
      additionalContext: JSON.stringify({ problemMemory: {
        problemId: record.id,
        occurrences: record.occurrences,
        signatureMatch: record.match,
        resolution,
        proposal,
      } }),
    },
  };
}

function validThreshold(value) {
  const threshold = Number(value);
  return Number.isInteger(threshold) && threshold >= 2 ? threshold : 3;
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
  if (process.argv[2] === 'resolve') {
    try {
      const result = resolveProblem(process.argv[3], JSON.parse(process.argv[4] ?? '{}'));
      process.stdout.write(JSON.stringify({ resolved: result }));
    } catch (error) {
      process.stderr.write(`Problem memory resolution failed: ${error.message}`);
      process.exitCode = 1;
    }
  } else {
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
}
