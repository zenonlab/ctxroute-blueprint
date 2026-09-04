import { mkdir, readFile, rename, open, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

export const PROGRESS_PATH = '.project/progress.json';
export const PROGRESS_VIEW_PATH = 'docs/progress.md';
export const PROGRESS_ARCHIVE_PATH = '.project/progress-archive.json';
export const PROGRESS_LOCK_PATH = '.ctxroute/state/progress.lock';
export const PROGRESS_RESOURCE_URI = 'ctxroute://progress/full';
export const LIMITS = { bytes: 64 * 1024, goals: 20, steps: 30, references: 30, evidence: 10, text: 500, next: 3 };
const ARCHIVE_BYTES = 2 * 1024 * 1024;
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
export const EXECUTION_MODES = Object.freeze(['automatic', 'manual']);
export const MANUAL_REASONS = Object.freeze(['visual-review', 'important-decision']);
const LEGACY_EXECUTION_MODES = Object.freeze(['autonomous', 'collaborative']);
const SECRET = /(?:\b(?:api[_-]?key|secret|password|token|private[_-]?key|authorization)\s*[:=]|\bbearer\s+[a-z0-9._~+/-]{8,}|\bgh[oprsu]_[a-z0-9]{12,}|\bsk-[a-z0-9_-]{12,})/iu;
const LOCK_STALE_MS = 30_000;
// Give a full 30-process claim burst enough time to drain on loaded runners and
// Windows while remaining below the five-second lifecycle-hook timeout.
const LOCK_WAIT_MS = 3_000;
const LOCK_RETRY_MIN_MS = 2;
const LOCK_RETRY_MAX_MS = 25;
const ATOMIC_RENAME_WAIT_MS = process.platform === 'win32' ? 1_000 : 0;

export const emptyProgress = () => ({ schemaVersion: 1, goals: [] });
export const progressRevision = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function ensureProgressView(root = process.cwd()) {
  const current = await readProgress(root);
  const expected = progressRevision(current);
  if (await viewHasRevision(root, expected)) return current;
  return withProgressLock(root, async () => {
    const latest = await readProgress(root);
    if (!await viewHasRevision(root, progressRevision(latest))) await atomicWrite(resolve(root, PROGRESS_VIEW_PATH), renderProgress(latest));
    return latest;
  });
}

export async function readProgress(root = process.cwd()) {
  try {
    const source = await readFile(resolve(root, PROGRESS_PATH), 'utf8');
    if (Buffer.byteLength(source) > LIMITS.bytes) throw new Error('progress file exceeds 64 KiB');
    const value = JSON.parse(source); const errors = inspectProgressChecklist(value);
    if (errors.length) throw new Error(errors.join('; '));
    return { ...value, goals: value.goals.map(normalizeStoredGoal) };
  } catch (error) { if (error.code === 'ENOENT') return emptyProgress(); throw new Error(`Cannot read progress checklist: ${error.message}`); }
}

function inspectProgressChecklist(value) {
  const errors = [];
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.goals)) return ['schemaVersion 1 and goals array are required'];
  if (value.goals.length > LIMITS.goals) errors.push(`maximum ${LIMITS.goals} goals exceeded`);
  const goalIds = new Set();
  for (const goal of value.goals) {
    if (!isId(goal?.id) || goalIds.has(goal.id)) errors.push('goal ids must be unique safe identifiers'); goalIds.add(goal?.id);
    if (!text(goal?.title)) errors.push(`goal ${goal?.id ?? '(missing)'} needs a title`);
    if (goal?.executionMode !== undefined && ![...EXECUTION_MODES, ...LEGACY_EXECUTION_MODES].includes(goal.executionMode)) errors.push(`goal ${goal?.id ?? '(missing)'} has an invalid executionMode`);
    const mode = normalizeExecutionMode(goal?.executionMode);
    if (goal?.manualReason !== undefined && goal.manualReason !== null && !MANUAL_REASONS.includes(goal.manualReason)) errors.push(`goal ${goal?.id ?? '(missing)'} has an invalid manualReason`);
    if (mode === 'manual' && goal?.status !== 'DONE' && !MANUAL_REASONS.includes(goal?.manualReason)) errors.push(`active manual goal ${goal?.id ?? '(missing)'} requires manualReason`);
    if (mode === 'automatic' && goal?.manualReason !== undefined && goal.manualReason !== null) errors.push(`automatic goal ${goal?.id ?? '(missing)'} cannot have manualReason`);
    if (goal?.modeOffered !== undefined && (goal.modeOffered !== true && goal.modeOffered !== false)) errors.push(`goal ${goal?.id ?? '(missing)'} has an invalid modeOffered`);
    if (!Array.isArray(goal?.steps) || goal.steps.length < 1 || goal.steps.length > LIMITS.steps) { errors.push(`goal ${goal?.id ?? '(missing)'} needs 1-${LIMITS.steps} steps`); continue; }
    const stepIds = new Set();
    for (const step of goal.steps) {
      if (!isId(step?.id) || stepIds.has(step.id)) errors.push(`goal ${goal.id} has duplicate or invalid step id`); stepIds.add(step?.id);
      if (!text(step?.title) || !STATUSES.has(step?.status)) errors.push(`step ${step?.id ?? '(missing)'} has invalid title or status`);
      if (step?.claimable !== undefined && ![true, false].includes(step.claimable)) errors.push(`step ${step?.id ?? '(missing)'} has an invalid claimable flag`);
      if (step?.assignee !== undefined && !shortReference(step.assignee)) errors.push(`step ${step?.id ?? '(missing)'} has an invalid assignee`);
      for (const [name, list] of Object.entries({ acceptance: step?.acceptance, files: step?.files, commands: step?.commands, evidence: step?.evidence })) {
        if (!Array.isArray(list) || list.length > (name === 'evidence' ? LIMITS.evidence : LIMITS.references) || (name === 'acceptance' && !list.length)) errors.push(`step ${step?.id ?? '(missing)'} needs bounded ${name}`);
        for (const item of list ?? []) if (!shortReference(item) || (name === 'files' && !safePath(item))) errors.push(`step ${step?.id ?? '(missing)'} contains an invalid ${name} reference`);
      }
      if ((step?.evidence?.length ?? 0) > LIMITS.evidence) errors.push(`step ${step.id} has too many evidence references`);
      if (step?.status === 'DONE' && step?.evidence?.length === 0) errors.push(`step ${step.id} requires evidence when DONE`);
    }
  }
  return errors;
}

// Kept as the public API name used by the CLI, MCP server, and consumers.
export const validateProgress = inspectProgressChecklist;
export const isSafeProgressReference = shortReference;

export function validatePlan(plan, current = emptyProgress()) {
  const errors = [];
  if (!plan || plan !== Object(plan)) return { ok: false, errors: ['plan must be an object'] };
  const goalId = plan.goalId ?? plan.id;
  if (!isId(goalId)) errors.push('plan requires a safe goalId');
  if (!text(plan.title)) errors.push('plan requires a title');
  if (plan.executionMode !== undefined && !EXECUTION_MODES.includes(plan.executionMode)) errors.push(`plan executionMode must be one of: ${EXECUTION_MODES.join(', ')}`);
  if (plan.executionMode === 'manual' && !MANUAL_REASONS.includes(plan.manualReason)) errors.push(`manual plan requires manualReason: ${MANUAL_REASONS.join(' or ')}`);
  if (plan.executionMode !== 'manual' && plan.manualReason !== undefined && plan.manualReason !== null) errors.push('manualReason is only valid for manual plans');
  if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > LIMITS.steps) errors.push(`plan requires 1-${LIMITS.steps} steps`);
  const ids = new Set();
  for (const step of plan.steps ?? []) {
    if (!isId(step?.id) || ids.has(step.id)) errors.push('plan step ids must be unique safe identifiers'); ids.add(step?.id);
    if (!text(step?.title)) errors.push('each step requires a title');
    for (const [name, list] of Object.entries({ acceptance: step?.acceptance, files: step?.files ?? [], commands: step?.commands ?? [] })) {
      if (!Array.isArray(list) || (name === 'acceptance' && !list.length)) errors.push(`step ${step?.id ?? '(missing)'} requires bounded ${name}`);
      for (const item of list ?? []) if (!shortReference(item) || (name === 'files' && !safePath(item))) errors.push(`unsafe or invalid ${name} reference`);
    }
    if (step?.claimable !== undefined && ![true, false].includes(step.claimable)) errors.push(`step ${step?.id ?? '(missing)'} has an invalid claimable flag`);
  }
  const evidence = plan.validationEvidence ?? plan.evidence;
  if (!Array.isArray(evidence) || !evidence.length || evidence.some(item => !shortReference(item))) errors.push('plan requires short validation evidence references');
  const existing = current.goals?.find(goal => goal.id === goalId);
  if (existing && !isDeepStrictEqual(normalizePlan(plan), normalizeGoal(existing))) errors.push(`goal already exists with different content: ${goalId}`);
  return { ok: errors.length === 0, errors, normalized: normalizePlan(plan) };
}

export async function approvePlan(plan, root = process.cwd(), options = {}) {
  if (plan?.approved !== true) throw new Error('approved: true write flag is required to materialize a plan');
  return withProgressLock(root, async () => {
    const current = await readProgress(root); assertExpectedRevision(current, options.expectedRevision); const result = validatePlan(plan, current);
    if (!result.ok) throw new Error(`Invalid progress plan: ${result.errors.join('; ')}`);
    const archived = (await readProgressArchive(root)).goals.some(entry => entry.goal.id === result.normalized.id);
    if (archived) throw new Error(`goal id is already archived: ${result.normalized.id}`);
    const goal = result.normalized; const next = current.goals.some(item => item.id === goal.id) ? current : { ...current, goals: [...current.goals, goal] };
    if (next !== current) await writeProgress(root, next);
    return next;
  });
}

export async function archiveCompletedProgressGoals(root = process.cwd(), options = {}) {
  return withProgressLock(root, async () => {
    const current = await readProgress(root);
    assertExpectedRevision(current, options.expectedRevision);
    const completed = current.goals.filter(goal => goal.status === 'DONE');
    if (!completed.length) return { archived: 0, remaining: current.goals.length, progress: current };

    const archive = await readProgressArchive(root);
    const known = new Map(archive.goals.map(entry => [entry.goal.id, entry.goal]));
    for (const goal of completed) {
      const archivedGoal = known.get(goal.id);
      if (archivedGoal && !isDeepStrictEqual(normalizeGoal(archivedGoal), normalizeGoal(goal))) throw new Error(`archived goal conflicts with active goal: ${goal.id}`);
    }
    const archivedAt = new Date().toISOString();
    const additions = completed.filter(goal => !known.has(goal.id)).map(goal => ({ archivedAt, goal }));
    const nextArchive = { schemaVersion: 1, goals: [...archive.goals, ...additions] };
    const archiveJson = `${JSON.stringify(nextArchive, null, 2)}\n`;
    if (Buffer.byteLength(archiveJson) > ARCHIVE_BYTES) throw new Error('progress archive exceeds 2 MiB');

    // Archive first: if the process stops between writes, replay sees the goal
    // in both places, avoids a duplicate, and completes the move safely.
    await atomicWrite(resolve(root, PROGRESS_ARCHIVE_PATH), archiveJson);
    const next = { ...current, goals: current.goals.filter(goal => goal.status !== 'DONE') };
    await writeProgress(root, next);
    return { archived: completed.length, remaining: next.goals.length, progress: next };
  });
}

export async function readProgressArchive(root = process.cwd()) {
  try {
    const source = await readFile(resolve(root, PROGRESS_ARCHIVE_PATH), 'utf8');
    if (Buffer.byteLength(source) > ARCHIVE_BYTES) throw new Error('progress archive exceeds 2 MiB');
    const value = JSON.parse(source);
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.goals)) throw new Error('schemaVersion 1 and goals array are required');
    const ids = new Set();
    for (const entry of value.goals) {
      if (!entry || Number.isNaN(Date.parse(entry.archivedAt)) || inspectProgressChecklist({ schemaVersion: 1, goals: [entry.goal] }).length) throw new Error('archive contains an invalid goal');
      if (ids.has(entry.goal.id)) throw new Error(`archive contains duplicate goal: ${entry.goal.id}`);
      ids.add(entry.goal.id);
    }
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, goals: [] };
    throw new Error(`Cannot read progress archive: ${error.message}`);
  }
}

export const progressStatus = value => value.goals.map(goal => withManualReason({ id: goal.id, title: goal.title, status: goal.status, executionMode: normalizeExecutionMode(goal.executionMode), steps: statusCounts(goal.steps) }, goal));
export function progressNext(value, goalId) {
  const goal = value.goals.find(item => item.id === goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);
  const next = goal.steps.filter(step => step.status === 'IN_PROGRESS' || step.status === 'TODO').slice(0, LIMITS.next);
  const blocked = goal.steps.filter(step => step.status === 'BLOCKED').slice(0, LIMITS.next);
  return { goalId: goal.id, mode: normalizeExecutionMode(goal.executionMode), complete: goal.steps.every(step => step.status === 'DONE'), next: next.map(step => ticketSummary(step)), blocked: blocked.map(step => ticketSummary(step)) };
}

export function progressMutationResult(value, goalId, stepId) {
  const goal = value.goals.find(item => item.id === goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);
  const result = { ok: true, revision: progressRevision(value), goal: withManualReason({ id: goal.id, status: goal.status, executionMode: normalizeExecutionMode(goal.executionMode), steps: goal.steps.length }, goal) };
  if (stepId !== undefined) {
    const step = goal.steps.find(item => item.id === stepId);
    if (!step) throw new Error(`Unknown step: ${stepId}`);
    result.ticket = { stepId: step.id, status: step.status, assignee: step.assignee, evidence: step.evidence.slice(0, 3) };
  }
  return result;
}

export async function claimProgressTicket(agentId, goalId, root = process.cwd()) {
  return claimMatchingProgressTicket(agentId, goalId, root, () => true);
}

export async function claimAutomaticProgressTicket(agentId, root = process.cwd()) {
  return claimMatchingProgressTicket(agentId, undefined, root, goal => normalizeExecutionMode(goal.executionMode) === 'automatic', step => step.claimable === true);
}

async function claimMatchingProgressTicket(agentId, goalId, root, eligible, stepEligible = () => true) {
  if (!shortReference(agentId)) throw new Error('agentId must be a short non-secret identifier');
  let claimed;
  await updateProgress(root, current => {
    const goals = goalId ? [current.goals.find(goal => goal.id === goalId)] : current.goals.filter(goal => goal.status === 'ACTIVE');
    if (goals.some(goal => !goal)) throw new Error(`Unknown goal: ${goalId}`);
    for (const goal of goals) {
      const owned = goal.steps.find(step => step.status === 'IN_PROGRESS' && step.assignee === agentId);
      if (owned) { claimed = ticket(goal.id, owned); return current; }
    }
    for (const goal of goals) {
      if (!eligible(goal)) continue;
      const index = goal.steps.findIndex(step => step.status === 'TODO' && stepEligible(step));
      if (index < 0) continue;
      const steps = [...goal.steps]; steps[index] = { ...steps[index], status: 'IN_PROGRESS', assignee: agentId };
      claimed = ticket(goal.id, steps[index]);
      return { ...current, goals: current.goals.map(item => item.id === goal.id ? withDerivedStatus(goal, steps) : item) };
    }
    return current;
  });
  return { claimed: Boolean(claimed), ticket: claimed };
}

export async function releaseProgressClaims(assigneePrefix, root = process.cwd(), options = {}) {
  if (!shortReference(assigneePrefix)) throw new Error('assigneePrefix must be a short non-secret identifier');
  let released = 0;
  const progress = await updateProgress(root, current => {
    let changed = false;
    const goals = current.goals.map(goal => {
      let goalChanged = false;
      const steps = goal.steps.map(step => {
        if (step.status !== 'IN_PROGRESS' || !step.assignee?.startsWith(assigneePrefix)) return step;
        const releasedStep = { ...step, status: 'TODO' };
        delete releasedStep.assignee;
        released += 1;
        goalChanged = true;
        changed = true;
        return releasedStep;
      });
      return goalChanged ? withDerivedStatus(goal, steps) : goal;
    });
    return changed ? { ...current, goals } : current;
  }, options);
  return { released, progress };
}

export async function setProgressMode(goalId, mode, manualReason, root = process.cwd(), options = {}) {
  if (![...EXECUTION_MODES, ...LEGACY_EXECUTION_MODES].includes(mode)) throw new Error(`mode must be one of: ${EXECUTION_MODES.join(', ')}`);
  const normalizedMode = normalizeExecutionMode(mode);
  if (normalizedMode === 'manual' && !MANUAL_REASONS.includes(manualReason)) throw new Error('manual mode requires reason visual-review or important-decision');
  return updateProgress(root, current => {
    const index = current.goals.findIndex(goal => goal.id === goalId);
    if (index < 0) throw new Error(`Unknown goal: ${goalId}`);
    const goals = [...current.goals]; goals[index] = { ...goals[index], executionMode: normalizedMode, manualReason: normalizedMode === 'manual' ? manualReason : null, modeOffered: true };
    return { ...current, goals };
  }, options);
}

export async function updateProgressGoal(goalId, { title }, root = process.cwd(), options = {}) {
  return updateProgress(root, current => {
    const goalIndex = findGoalIndex(current, goalId);
    const goals = [...current.goals]; goals[goalIndex] = { ...goals[goalIndex], title };
    return { ...current, goals };
  }, options);
}

export async function updateProgressStep({ goalId, stepId, agentId, status, title, claimable, acceptance, files, commands, evidence }, root = process.cwd(), options = {}) {
  if (status !== undefined && !STATUSES.has(status)) throw new Error(`status must be one of: ${[...STATUSES].join(', ')}`);
  if (claimable !== undefined && ![true, false].includes(claimable)) throw new Error('claimable must be a boolean');
  return updateProgress(root, current => {
    const goalIndex = findGoalIndex(current, goalId);
    const goal = current.goals[goalIndex]; const stepIndex = goal.steps.findIndex(step => step.id === stepId);
    if (stepIndex < 0) throw new Error(`Unknown step: ${stepId}`);
    const existing = goal.steps[stepIndex];
    if (agentId !== undefined && existing.assignee !== agentId) throw new Error(existing.assignee === undefined ? `Ticket ${stepId} must be claimed before agent reporting` : `Ticket ${stepId} is assigned to ${existing.assignee}`);
    const changed = { ...existing };
    if (status !== undefined) changed.status = status;
    if (agentId !== undefined && status === 'IN_PROGRESS') changed.assignee = agentId;
    if (status === 'TODO') delete changed.assignee;
    if (title !== undefined) changed.title = title;
    if (claimable !== undefined) changed.claimable = claimable;
    if (acceptance !== undefined) changed.acceptance = copyList(acceptance);
    if (files !== undefined) changed.files = copyList(files);
    if (commands !== undefined) changed.commands = copyList(commands);
    if (evidence !== undefined) changed.evidence = copyList(evidence);
    if (changed.status === 'DONE' && changed.evidence.length === 0) throw new Error('DONE requires at least one evidence reference');
    if (agentId !== undefined && ['DONE', 'BLOCKED'].includes(changed.status) && changed.evidence.length === 0) throw new Error('agent final reporting requires at least one evidence reference');
    const steps = [...goal.steps]; steps[stepIndex] = changed;
    const goals = [...current.goals]; goals[goalIndex] = withDerivedStatus(goal, steps);
    return { ...current, goals };
  }, options);
}

export async function addProgressStep(goalId, step, root = process.cwd(), options = {}) {
  return updateProgress(root, current => {
    const goalIndex = findGoalIndex(current, goalId); const goal = current.goals[goalIndex];
    if (goal.steps.some(item => item.id === step?.id)) throw new Error(`Duplicate step id: ${step.id}`);
    const added = { id: step?.id, title: step?.title, status: step?.status ?? 'TODO', claimable: step?.claimable ?? false, acceptance: copyList(step?.acceptance), files: copyList(step?.files), commands: copyList(step?.commands), evidence: copyList(step?.evidence ?? []) };
    if (added.status === 'DONE' && added.evidence.length === 0) throw new Error('DONE requires at least one evidence reference');
    const goals = [...current.goals]; goals[goalIndex] = withDerivedStatus(goal, [...goal.steps, added]);
    return { ...current, goals };
  }, options);
}

export async function deleteProgressStep(goalId, stepId, root = process.cwd(), options = {}) {
  return updateProgress(root, current => {
    const goalIndex = findGoalIndex(current, goalId); const goal = current.goals[goalIndex];
    if (!goal.steps.some(step => step.id === stepId)) throw new Error(`Unknown step: ${stepId}`);
    if (goal.steps.length === 1) throw new Error('Cannot delete the last step');
    const goals = [...current.goals]; goals[goalIndex] = withDerivedStatus(goal, goal.steps.filter(step => step.id !== stepId));
    return { ...current, goals };
  }, options);
}

export async function reorderProgressSteps(goalId, stepIds, root = process.cwd(), options = {}) {
  return updateProgress(root, current => {
    const goalIndex = findGoalIndex(current, goalId); const goal = current.goals[goalIndex];
    if (!Array.isArray(stepIds) || stepIds.length !== goal.steps.length || new Set(stepIds).size !== stepIds.length || stepIds.some(id => !goal.steps.some(step => step.id === id))) throw new Error('stepIds must contain every step id exactly once');
    const byId = new Map(goal.steps.map(step => [step.id, step])); const steps = stepIds.map(id => byId.get(id));
    const goals = [...current.goals]; goals[goalIndex] = withDerivedStatus(goal, steps);
    return { ...current, goals };
  }, options);
}

export async function markModeOffered(goalId, root = process.cwd()) {
  return updateProgress(root, current => {
    const index = current.goals.findIndex(goal => goal.id === goalId); if (index < 0) throw new Error(`Unknown goal: ${goalId}`);
    const goals = [...current.goals]; goals[index] = { ...goals[index], modeOffered: true }; return { ...current, goals };
  });
}
export function renderProgress(value) {
  const lines = ['# Progress checklist', '', `<!-- progress-revision: ${progressRevision(value)} -->`, ''];
  for (const goal of value.goals) { lines.push(`## ${goal.title} — ${goal.status}`, ''); for (const step of goal.steps) { const displayStatus = step.status === 'TODO' ? 'PENDING' : step.status; lines.push(`- [${step.status === 'DONE' ? 'x' : ' '}] **${step.title}** — ${displayStatus}${step.evidence.length ? ` _(evidence: ${step.evidence.slice(0, 3).join(', ')})_` : ''}`); } lines.push(''); }
  if (!value.goals.length) lines.push('_No goals approved yet._', ''); return lines.join('\n');
}
function normalizePlan(plan) { const executionMode = normalizeExecutionMode(plan.executionMode); return { schemaVersion: 1, id: plan.goalId ?? plan.id, title: plan.title, status: plan.status ?? 'ACTIVE', executionMode, manualReason: executionMode === 'manual' ? plan.manualReason : null, modeOffered: false, steps: plan.steps.map(step => ({ id: step.id, title: step.title, status: step.status ?? 'TODO', claimable: step.claimable ?? false, acceptance: step.acceptance, files: step.files ?? [], commands: step.commands ?? [], evidence: step.evidence ?? [] })) }; }
function normalizeGoal(goal) { const normalized = normalizeStoredGoal(goal); return { schemaVersion: 1, id: normalized.id, title: normalized.title, status: normalized.status, executionMode: normalized.executionMode, manualReason: normalized.manualReason, modeOffered: normalized.modeOffered, steps: normalized.steps.map(step => ({ ...step, claimable: step.claimable ?? false })) }; }
function normalizeStoredGoal(goal) { const executionMode = normalizeExecutionMode(goal.executionMode); return { ...goal, executionMode, manualReason: executionMode === 'manual' ? (goal.manualReason ?? null) : null, modeOffered: goal.modeOffered ?? false }; }
function normalizeExecutionMode(mode) { return mode === 'manual' || mode === 'collaborative' ? 'manual' : 'automatic'; }
function isId(value) { return value === String(value) && /^[a-z][a-z0-9-]{0,63}$/u.test(value); }
function text(value) { return value === String(value) && value.trim() && value.length <= LIMITS.text && !SECRET.test(value); }
function shortReference(value) { return value === String(value) && value.length > 0 && value.length <= LIMITS.text && !SECRET.test(value) && ![...value].some(character => character.codePointAt(0) <= 31); }
function safePath(value) {
  if (!shortReference(value) || isAbsolute(value) || value.startsWith('~') || value.split(/[\\/]+/u).includes('..')) return false;
  const normalized = value.replaceAll('\\', '/');
  return relative('.', value).replaceAll('\\', '/') === normalized;
}
async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = await open(temp, 'wx', 0o600);
  try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
  finally { await handle.close(); }
  try { await renameWithRetry(temp, path); }
  catch (error) { await unlink(temp).catch(() => {}); throw error; }
}

export async function renameWithRetry(from, to, options = {}) {
  const operation = options.operation ?? rename;
  const wait = options.wait ?? (milliseconds => new Promise(resolveWait => { setTimeout(resolveWait, milliseconds); }));
  const deadline = performance.now() + (options.waitMs ?? ATOMIC_RENAME_WAIT_MS);
  let attempt = 0;
  while (true) {
    try { return await operation(from, to); }
    catch (error) {
      const remaining = deadline - performance.now();
      if (!['EACCES', 'EPERM'].includes(error.code) || remaining <= 0) throw error;
      attempt += 1;
      const delay = Math.min(remaining, LOCK_RETRY_MIN_MS * (2 ** Math.min(attempt, 6)));
      await wait(delay);
    }
  }
}

async function viewHasRevision(root, revision) {
  try { return (await readFile(resolve(root, PROGRESS_VIEW_PATH), 'utf8')).includes(`<!-- progress-revision: ${revision} -->`); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function updateProgress(root, transform, options = {}) {
  return withProgressLock(root, async () => {
    const current = await readProgress(root); assertExpectedRevision(current, options.expectedRevision); const next = transform(current);
    if (next !== current) await writeProgress(root, next);
    return next;
  }, options);
}

async function writeProgress(root, next) {
  const json = `${JSON.stringify(next, null, 2)}\n`; const errors = inspectProgressChecklist(next);
  if (errors.length) throw new Error(errors.join('; '));
  if (Buffer.byteLength(json) > LIMITS.bytes) throw new Error('progress file exceeds 64 KiB');
  await atomicWrite(resolve(root, PROGRESS_PATH), json); await atomicWrite(resolve(root, PROGRESS_VIEW_PATH), renderProgress(next));
}

async function withProgressLock(root, operation, options = {}) {
  const path = resolve(root, PROGRESS_LOCK_PATH); await mkdir(dirname(path), { recursive: true });
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = performance.now() + (options.lockWaitMs ?? LOCK_WAIT_MS);
  let handle; let attempt = 0; let recoveryChecked = false;
  while (!handle) {
    try { handle = await createLock(path, owner); break; }
    catch (error) {
      if (!isLockContention(error)) throw error;
      if (!recoveryChecked) { recoveryChecked = true; handle = await recoverStaleLock(path, owner); }
      if (handle) break;
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      attempt += 1;
      const ceiling = Math.min(LOCK_RETRY_MAX_MS, LOCK_RETRY_MIN_MS * (2 ** Math.min(attempt, 4)));
      const jittered = LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (ceiling - LOCK_RETRY_MIN_MS + 1));
      await new Promise(resolveWait => { setTimeout(resolveWait, Math.min(remaining, jittered)); });
    }
  }
  if (!handle) { const error = new Error('Progress update is busy; retry later'); error.code = 'PROGRESS_BUSY'; throw error; }
  try { return await operation(); }
  finally { await handle.close(); await releaseOwnedLock(path, owner); }
}

async function createLock(path, owner) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(owner)); return handle; }
  catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }
}

function isLockContention(error) {
  return error.code === 'EEXIST' || (process.platform === 'win32' && error.code === 'EPERM');
}

async function recoverStaleLock(path, owner) {
  try { if (Date.now() - (await stat(path)).mtimeMs <= LOCK_STALE_MS) return undefined; }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  const recoveryPath = `${path}.recovery`; const recoveryOwner = { pid: process.pid, token: randomUUID() };
  const recovery = await acquireRecoveryLock(recoveryPath, recoveryOwner);
  if (!recovery) return undefined;
  try {
    const source = await readFile(path, 'utf8'); const details = await stat(path); let current = {};
    try { current = JSON.parse(source); } catch {}
    if (!shortReference(current.token) || Date.now() - details.mtimeMs <= LOCK_STALE_MS || processIsLive(current.pid)) return undefined;
    await releaseOwnedLock(path, current);
    try { return await createLock(path, owner); } catch (error) { if (isLockContention(error)) return undefined; throw error; }
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  finally { await recovery.close(); await releaseOwnedLock(recoveryPath, recoveryOwner); }
}

async function acquireRecoveryLock(path, owner) {
  try { return await createLock(path, owner); }
  catch (error) { if (!isLockContention(error)) throw error; }
  let current; let details;
  try { current = JSON.parse(await readFile(path, 'utf8')); details = await stat(path); }
  catch (error) { if (error.code === 'ENOENT') return undefined; return undefined; }
  if (!shortReference(current.token) || Date.now() - details.mtimeMs <= LOCK_STALE_MS || processIsLive(current.pid)) return undefined;
  await releaseOwnedLock(path, current);
  try { return await createLock(path, owner); }
  catch (error) { if (isLockContention(error)) return undefined; throw error; }
}

async function releaseOwnedLock(path, owner) {
  if (!shortReference(owner.token)) return;
  try { const current = JSON.parse(await readFile(path, 'utf8')); if (current.token === owner.token) await unlink(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function processIsLive(pid) { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }

function findGoalIndex(current, goalId) { const index = current.goals.findIndex(goal => goal.id === goalId); if (index < 0) throw new Error(`Unknown goal: ${goalId}`); return index; }
function copyList(value) { return Array.isArray(value) ? [...value] : value; }
function withDerivedStatus(goal, steps) { const remaining = steps.filter(step => step.status !== 'DONE'); const status = steps.every(step => step.status === 'DONE') ? 'DONE' : remaining.every(step => step.status === 'BLOCKED') ? 'BLOCKED' : 'ACTIVE'; return { ...goal, status, steps }; }
function ticket(goalId, step) { return { goalId, stepId: step.id, title: step.title, status: step.status, claimable: step.claimable ?? false, assignee: step.assignee, acceptance: step.acceptance, files: step.files, commands: step.commands, evidence: step.evidence.slice(0, 3) }; }
function ticketSummary(step) { return { stepId: step.id, title: step.title, status: step.status, claimable: step.claimable ?? false, assignee: step.assignee }; }
function statusCounts(steps) { return { total: steps.length, todo: steps.filter(step => step.status === 'TODO').length, inProgress: steps.filter(step => step.status === 'IN_PROGRESS').length, blocked: steps.filter(step => step.status === 'BLOCKED').length, done: steps.filter(step => step.status === 'DONE').length }; }
function withManualReason(result, goal) { if (normalizeExecutionMode(goal.executionMode) === 'manual') result.manualReason = goal.manualReason ?? null; return result; }

function assertExpectedRevision(current, expectedRevision) {
  if (expectedRevision === undefined) return;
  if (expectedRevision !== progressRevision(current)) {
    const error = new Error('Progress changed since it was loaded');
    error.code = 'PROGRESS_REVISION_CONFLICT';
    throw error;
  }
}
