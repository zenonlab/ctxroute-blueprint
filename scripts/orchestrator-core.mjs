import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const MODES = Object.freeze(['SWARM_ON', 'SWARM_OFF']);
export const GOAL_STATUSES = Object.freeze(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export const MISSION_STATUSES = Object.freeze(['ASSIGNED', 'RUNNING', 'COMPLETED', 'BLOCKED', 'CANCELLED']);
const SECRET = /(?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)\s*[:=]/iu;
const DEFAULTS = Object.freeze({
  statePath: '.ctxroute/orchestrator/state.json',
  stateBytes: 512 * 1024,
  reportBytes: 64 * 1024,
  transactionTimeoutMs: 2000,
});

export function emptyOrchestratorState(mode = 'SWARM_ON') {
  return { schemaVersion: 1, revision: 0, mode, goals: [], skills: [], audits: [], transactions: [] };
}

export async function loadOrchestratorConfig(root = process.cwd()) {
  try {
    const config = JSON.parse(await readFile(resolve(root, '.project/orchestrator-config.json'), 'utf8'));
    if (config.schemaVersion !== 1 || !MODES.includes(config.defaultMode)) throw new Error('invalid schema or defaultMode');
    return { ...DEFAULTS, ...config.limits, statePath: config.statePath ?? DEFAULTS.statePath, worktreeRoot: config.worktreeRoot ?? '.ctxroute/worktrees' };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULTS, defaultMode: 'SWARM_ON', worktreeRoot: '.ctxroute/worktrees' };
    throw new Error(`Cannot load orchestrator config: ${error.message}`);
  }
}

export async function readOrchestratorState(root = process.cwd()) {
  const config = await loadOrchestratorConfig(root);
  try {
    const source = await readFile(resolve(root, config.statePath), 'utf8');
    if (Buffer.byteLength(source) > config.stateBytes) throw new Error('state exceeds its byte budget');
    const state = JSON.parse(source);
    const errors = validateState(state);
    if (errors.length) throw new Error(errors.join('; '));
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyOrchestratorState(config.defaultMode);
    throw new Error(`Cannot read orchestrator state: ${error.message}`);
  }
}

export async function currentSwarmMode(root = process.cwd(), environment = process.env) {
  const override = environment.CTXROUTE_SWARM_MODE;
  if (override !== undefined) {
    if (!MODES.includes(override)) throw new Error(`CTXROUTE_SWARM_MODE must be one of: ${MODES.join(', ')}`);
    return override;
  }
  return (await readOrchestratorState(root)).mode;
}

export async function transactOrchestrator(command, root = process.cwd()) {
  validateCommandEnvelope(command);
  const config = await loadOrchestratorConfig(root);
  const path = resolve(root, config.statePath);
  return withLock(`${path}.lock`, config.transactionTimeoutMs, async () => {
    const current = await readOrchestratorState(root);
    const digest = transactionDigest(command);
    const prior = current.transactions.find(item => item.operation_id === command.operation_id);
    if (prior) {
      if (prior.digest !== digest) throw new Error(`operation_id reused with different payload: ${command.operation_id}`);
      return { replayed: true, state: current };
    }
    if (command.expected_revision !== current.revision) throw new Error(`revision conflict: expected ${command.expected_revision}, actual ${current.revision}`);
    const mutated = applyOperation(current, command);
    const next = {
      ...mutated,
      revision: current.revision + 1,
      transactions: [...current.transactions, { operation_id: command.operation_id, digest, revision: current.revision + 1 }],
    };
    await atomicWriteState(path, next, config.stateBytes);
    return { replayed: false, state: next };
  });
}

export function validateWorkerReport(report, maximumBytes = DEFAULTS.reportBytes) {
  const errors = validateBoundedObject(report, maximumBytes, 'worker report');
  for (const field of ['mission_id', 'skill_id', 'skill_version', 'summary']) requireText(report?.[field], field, errors);
  for (const field of ['files_touched', 'material_evidence', 'blockers']) requireTextArray(report?.[field], field, errors, field === 'files_touched');
  if (!Array.isArray(report?.commands)) errors.push('commands must be an array');
  for (const item of report?.commands ?? []) {
    if (!item || item !== Object(item) || !safeText(item.command) || !Number.isInteger(item.exit_code)) errors.push('each command needs safe command text and integer exit_code');
  }
  return [...new Set(errors)];
}

export function validateAuditReport(report, maximumBytes = DEFAULTS.reportBytes) {
  const errors = validateBoundedObject(report, maximumBytes, 'audit report');
  for (const field of ['decision', 'patch_applied', 'rollback']) requireText(report?.[field], field, errors);
  for (const field of ['sessions_examined', 'signals_detected', 'validations']) requireTextArray(report?.[field], field, errors);
  if (!report?.subject || !['skill', 'goal', 'mission', 'blueprint'].includes(report.subject.type) || !safeText(report.subject.id)) errors.push('subject must identify a skill, goal, mission, or blueprint');
  return [...new Set(errors)];
}

export function validateState(state) {
  const errors = [];
  if (!state || state.schemaVersion !== 1 || !Number.isInteger(state.revision) || state.revision < 0 || !MODES.includes(state.mode)) return ['invalid orchestrator root state'];
  if (!Array.isArray(state.goals) || !Array.isArray(state.skills) || !Array.isArray(state.audits) || !Array.isArray(state.transactions)) return ['goals, skills, audits, and transactions must be arrays'];
  if (state.skills.some(skill => !safeId(skill?.skill_id) || !safeText(skill?.version) || !safeRelativePath(skill?.path)) || new Set(state.skills.map(skill => skill.skill_id)).size !== state.skills.length) errors.push('skills must contain unique safe registrations');
  const goalIds = new Set();
  const missionIds = new Set();
  for (const goal of state.goals) {
    if (!safeId(goal?.id) || goalIds.has(goal.id)) errors.push('goal ids must be unique safe identifiers');
    goalIds.add(goal?.id);
    if (!safeText(goal?.title) || !GOAL_STATUSES.includes(goal?.status) || !Array.isArray(goal?.missions)) errors.push(`invalid goal: ${goal?.id ?? '(missing)'}`);
    for (const mission of goal?.missions ?? []) {
      if (!safeId(mission?.mission_id) || missionIds.has(mission.mission_id)) errors.push('mission ids must be globally unique safe identifiers');
      missionIds.add(mission?.mission_id);
      errors.push(...validateMission(mission));
    }
  }
  return [...new Set(errors)];
}

function applyOperation(state, command) {
  const payload = command.payload ?? {};
  if (command.action === 'mode.set') {
    if (!MODES.includes(payload.mode)) throw new Error(`mode must be one of: ${MODES.join(', ')}`);
    return { ...state, mode: payload.mode };
  }
  if (command.action === 'goal.create') {
    if (!safeId(payload.id) || !safeText(payload.title)) throw new Error('goal.create requires a safe id and title');
    if (state.goals.some(goal => goal.id === payload.id)) throw new Error(`goal already exists: ${payload.id}`);
    return { ...state, goals: [...state.goals, { id: payload.id, title: payload.title.trim(), status: 'ACTIVE', missions: [] }] };
  }
  if (command.action === 'goal.update') {
    return updateGoal(state, payload.goal_id, goal => {
      if (!safeText(payload.title)) throw new Error('goal.update requires a title');
      return { ...goal, title: payload.title.trim() };
    });
  }
  if (command.action === 'goal.transition') {
    return updateGoal(state, payload.goal_id, goal => {
      if (!GOAL_STATUSES.includes(payload.status)) throw new Error(`invalid goal status: ${payload.status}`);
      return { ...goal, status: payload.status };
    });
  }
  if (command.action === 'goal.reorder') {
    if (!Array.isArray(payload.goal_ids) || payload.goal_ids.length !== state.goals.length || new Set(payload.goal_ids).size !== state.goals.length || payload.goal_ids.some(id => !state.goals.some(goal => goal.id === id))) throw new Error('goal.reorder must contain every goal id exactly once');
    return { ...state, goals: payload.goal_ids.map(id => state.goals.find(goal => goal.id === id)) };
  }
  if (command.action === 'skill.register') {
    if (!safeId(payload.skill_id) || !safeText(payload.version) || !safeRelativePath(payload.path)) throw new Error('skill.register requires skill_id, version, and repository-relative path');
    const existing = state.skills.find(skill => skill.skill_id === payload.skill_id);
    if (existing && (existing.version !== payload.version || existing.path !== payload.path)) throw new Error(`skill already registered with different identity: ${payload.skill_id}`);
    return existing ? state : { ...state, skills: [...state.skills, { skill_id: payload.skill_id, version: payload.version, path: payload.path }] };
  }
  if (command.action === 'mission.prepare') {
    if (state.mode === 'SWARM_OFF') throw new Error('SWARM_OFF executes directly and does not create missions');
    const errors = validateMission({ ...payload.mission, status: payload.mission?.status ?? 'ASSIGNED' });
    if (errors.length) throw new Error(errors.join('; '));
    if (state.goals.some(goal => goal.missions.some(mission => mission.mission_id === payload.mission.mission_id))) throw new Error(`mission already exists: ${payload.mission.mission_id}`);
    const activeMissions = state.goals.flatMap(goal => goal.missions).filter(mission => !['COMPLETED', 'CANCELLED'].includes(mission.status));
    if (activeMissions.some(mission => mission.file_scope.some(left => payload.mission.file_scope.some(right => scopesOverlap(left, right))))) throw new Error('mission file_scope overlaps an active worker');
    return updateGoal(state, payload.goal_id, goal => ({ ...goal, missions: [...goal.missions, { ...payload.mission, status: payload.mission.status ?? 'ASSIGNED', report: null }] }));
  }
  if (command.action === 'mission.transition') {
    if (!MISSION_STATUSES.includes(payload.status)) throw new Error(`invalid mission status: ${payload.status}`);
    return updateMission(state, payload.mission_id, mission => ({ ...mission, status: payload.status }));
  }
  if (command.action === 'mission.report') {
    const errors = validateWorkerReport(payload.report);
    if (errors.length) throw new Error(errors.join('; '));
    if (payload.report.mission_id !== payload.mission_id) throw new Error('worker report mission_id mismatch');
    return updateMission(state, payload.mission_id, mission => {
      if (mission.skill_id !== payload.report.skill_id || mission.skill_version !== payload.report.skill_version) throw new Error('worker report skill identity mismatch');
      if (payload.report.files_touched.some(path => !mission.file_scope.some(scope => path === scope || path.startsWith(scope.endsWith('/') ? scope : `${scope}/`)))) throw new Error('worker report contains files outside mission scope');
      const reportedCommands = payload.report.commands.map(item => item.command);
      if (mission.validation_commands.some(commandText => !reportedCommands.includes(commandText))) throw new Error('worker report omits a required validation command');
      const status = payload.report.blockers.length ? 'BLOCKED' : payload.report.commands.some(item => item.exit_code !== 0) ? 'BLOCKED' : 'COMPLETED';
      return { ...mission, status, report: payload.report };
    });
  }
  if (command.action === 'audit.apply') {
    const errors = validateAuditReport(payload.report);
    if (errors.length) throw new Error(errors.join('; '));
    let next = { ...state, audits: [...state.audits, payload.report] };
    if (payload.goal_adjustment) {
      const adjustment = payload.goal_adjustment;
      next = updateGoal(next, adjustment.goal_id, goal => {
        if (adjustment.title !== undefined && !safeText(adjustment.title)) throw new Error('audit goal title is invalid');
        if (adjustment.status !== undefined && !GOAL_STATUSES.includes(adjustment.status)) throw new Error('audit goal status is invalid');
        const updated = { ...goal };
        if (adjustment.title !== undefined) updated.title = adjustment.title.trim();
        if (adjustment.status !== undefined) updated.status = adjustment.status;
        return updated;
      });
    }
    return next;
  }
  throw new Error(`unsupported orchestrator action: ${command.action}`);
}

function validateMission(mission) {
  const errors = [];
  for (const field of ['mission_id', 'skill_id', 'skill_version', 'response_format']) requireText(mission?.[field], field, errors);
  for (const field of ['file_scope', 'acceptance', 'validation_commands']) requireTextArray(mission?.[field], field, errors, field === 'file_scope', true);
  if (!MISSION_STATUSES.includes(mission?.status)) errors.push('mission has invalid status');
  if (Object.hasOwn(mission ?? {}, 'history') || Object.hasOwn(mission ?? {}, 'conversation')) errors.push('mission must not contain conversation history');
  if (mission?.worktree !== null && mission?.worktree !== undefined && !safeRelativePath(mission.worktree)) errors.push('mission worktree must be repository-relative');
  return errors;
}

function updateGoal(state, goalId, operation) {
  const index = state.goals.findIndex(goal => goal.id === goalId);
  if (index < 0) throw new Error(`unknown goal: ${goalId}`);
  const goals = [...state.goals];
  goals[index] = operation(goals[index]);
  return { ...state, goals };
}

function scopesOverlap(left, right) {
  const leftPath = left.endsWith('/') ? left : `${left}/`;
  const rightPath = right.endsWith('/') ? right : `${right}/`;
  return left === right || leftPath.startsWith(rightPath) || rightPath.startsWith(leftPath);
}

function updateMission(state, missionId, operation) {
  const goal = state.goals.find(item => item.missions.some(mission => mission.mission_id === missionId));
  if (!goal) throw new Error(`unknown mission: ${missionId}`);
  return updateGoal(state, goal.id, item => ({ ...item, missions: item.missions.map(mission => mission.mission_id === missionId ? operation(mission) : mission) }));
}

function validateCommandEnvelope(command) {
  if (!command || command !== Object(command) || !safeId(command.operation_id)) throw new Error('transaction requires a safe operation_id');
  if (!Number.isInteger(command.expected_revision) || command.expected_revision < 0) throw new Error('transaction requires a non-negative expected_revision');
  if (!safeText(command.action)) throw new Error('transaction requires an action');
  if (command.payload !== undefined && (!command.payload || command.payload !== Object(command.payload) || Array.isArray(command.payload))) throw new Error('transaction payload must be an object');
  if (containsSecret(command)) throw new Error('transaction contains secret-like material');
}

function validateBoundedObject(value, maximumBytes, label) {
  const errors = [];
  if (!value || value !== Object(value) || Array.isArray(value)) return [`${label} must be an object`];
  let serialized;
  try { serialized = JSON.stringify(value); } catch { return [`${label} must be serializable`]; }
  if (Buffer.byteLength(serialized) > maximumBytes) errors.push(`${label} exceeds ${maximumBytes} bytes`);
  if (containsSecret(value)) errors.push(`${label} contains secret-like material`);
  return errors;
}

function requireText(value, name, errors) {
  if (!safeText(value)) errors.push(`${name} must be safe non-empty text`);
}

function requireTextArray(value, name, errors, paths = false, nonEmpty = false) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) return errors.push(`${name} must be${nonEmpty ? ' a non-empty' : ' an'} array`);
  if (value.some(item => paths ? !safeRelativePath(item) : !safeText(item))) errors.push(`${name} contains an invalid value`);
}

function safeId(value) {
  return value === String(value) && /^[a-z][a-z0-9-]{0,127}$/u.test(value);
}

function safeText(value) {
  return value === String(value) && value.trim().length > 0 && value.length <= 4096 && !SECRET.test(value) && ![...value].some(character => character.codePointAt(0) < 9);
}

export function safeRelativePath(value) {
  if (!safeText(value) || isAbsolute(value) || value.startsWith('~')) return false;
  const normalized = value.replaceAll('\\', '/');
  const comparable = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  return Boolean(comparable) && !normalized.split('/').includes('..') && relative('.', comparable).replaceAll('\\', '/') === comparable;
}

function containsSecret(value, key = '', depth = 0) {
  if (depth > 12) return true;
  if (/(?:authorization|cookie|password|private[_-]?key|secret|token|api[_-]?key)/iu.test(key)) return true;
  if (value === String(value)) return SECRET.test(value);
  if (Array.isArray(value)) return value.some(item => containsSecret(item, key, depth + 1));
  return Boolean(value && value === Object(value) && Object.entries(value).some(([name, item]) => containsSecret(item, name, depth + 1)));
}

function transactionDigest(command) {
  return `sha256:${createHash('sha256').update(stableJson({ action: command.action, payload: command.payload ?? {} })).digest('hex')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && value === Object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function atomicWriteState(path, state, maximumBytes) {
  const source = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(source) > maximumBytes) throw new Error(`orchestrator state exceeds ${maximumBytes} bytes`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(source, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
}

async function withLock(path, timeoutMs, operation) {
  await mkdir(dirname(path), { recursive: true });
  const started = Date.now();
  let handle;
  while (!handle) {
    try { handle = await open(path, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= timeoutMs) throw new Error('orchestrator transaction lock timeout');
      await new Promise(resolveWait => { setTimeout(resolveWait, 25); });
    }
  }
  try { return await operation(); }
  finally { await handle.close(); await unlink(path).catch(() => {}); }
}
