import { mkdir, readFile, rename, open } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export const PROGRESS_PATH = '.project/progress.json';
export const PROGRESS_VIEW_PATH = 'docs/progress.md';
export const LIMITS = { bytes: 64 * 1024, goals: 20, steps: 30, evidence: 10, text: 500, next: 3 };
const STATUSES = new Set(['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE']);
export const EXECUTION_MODES = Object.freeze(['collaborative', 'autonomous']);
const SECRET = /(api[_-]?key|secret|password|token|private[_-]?key|authorization)\s*[:=]/iu;

export const emptyProgress = () => ({ schemaVersion: 1, goals: [] });

export async function readProgress(root = process.cwd()) {
  try {
    const source = await readFile(resolve(root, PROGRESS_PATH), 'utf8');
    if (Buffer.byteLength(source) > LIMITS.bytes) throw new Error('progress file exceeds 64 KiB');
    const value = JSON.parse(source); const errors = inspectProgressChecklist(value);
    if (errors.length) throw new Error(errors.join('; '));
    return { ...value, goals: value.goals.map(goal => ({ ...goal, executionMode: goal.executionMode ?? 'collaborative', modeOffered: goal.modeOffered ?? false })) };
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
    if (goal?.executionMode !== undefined && !EXECUTION_MODES.includes(goal.executionMode)) errors.push(`goal ${goal?.id ?? '(missing)'} has an invalid executionMode`);
    if (goal?.modeOffered !== undefined && typeof goal.modeOffered !== 'boolean') errors.push(`goal ${goal?.id ?? '(missing)'} has an invalid modeOffered`);
    if (!Array.isArray(goal?.steps) || goal.steps.length > LIMITS.steps) { errors.push(`goal ${goal?.id ?? '(missing)'} needs at most ${LIMITS.steps} steps`); continue; }
    const stepIds = new Set();
    for (const step of goal.steps) {
      if (!isId(step?.id) || stepIds.has(step.id)) errors.push(`goal ${goal.id} has duplicate or invalid step id`); stepIds.add(step?.id);
      if (!text(step?.title) || !STATUSES.has(step?.status)) errors.push(`step ${step?.id ?? '(missing)'} has invalid title or status`);
      for (const [name, list] of Object.entries({ acceptance: step?.acceptance, files: step?.files, commands: step?.commands, evidence: step?.evidence })) {
        if (!Array.isArray(list) || (name === 'acceptance' && !list.length)) errors.push(`step ${step?.id ?? '(missing)'} needs ${name}`);
        for (const item of list ?? []) if (!shortReference(item) || (name === 'files' && !safePath(item))) errors.push(`step ${step?.id ?? '(missing)'} contains an invalid ${name} reference`);
      }
      if ((step?.evidence?.length ?? 0) > LIMITS.evidence) errors.push(`step ${step.id} has too many evidence references`);
    }
  }
  return errors;
}

// Kept as the public API name used by the CLI, MCP server, and consumers.
export const validateProgress = inspectProgressChecklist;

export function validatePlan(plan, current = emptyProgress()) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan must be an object'] };
  const goalId = plan.goalId ?? plan.id;
  if (!isId(goalId)) errors.push('plan requires a safe goalId');
  if (!text(plan.title)) errors.push('plan requires a title');
  if (!Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > LIMITS.steps) errors.push(`plan requires 1-${LIMITS.steps} steps`);
  const ids = new Set();
  for (const step of plan.steps ?? []) {
    if (!isId(step?.id) || ids.has(step.id)) errors.push('plan step ids must be unique safe identifiers'); ids.add(step?.id);
    if (!text(step?.title)) errors.push('each step requires a title');
    for (const [name, list] of Object.entries({ acceptance: step?.acceptance, files: step?.files, commands: step?.commands })) {
      if (!Array.isArray(list) || !list.length) errors.push(`step ${step?.id ?? '(missing)'} requires ${name}`);
      for (const item of list ?? []) if (!shortReference(item) || (name === 'files' && !safePath(item))) errors.push(`unsafe or invalid ${name} reference`);
    }
  }
  const evidence = plan.validationEvidence ?? plan.evidence;
  if (!Array.isArray(evidence) || !evidence.length || evidence.some(item => !shortReference(item))) errors.push('plan requires short validation evidence references');
  const existing = current.goals?.find(goal => goal.id === goalId);
  if (existing && JSON.stringify(normalizePlan(plan)) !== JSON.stringify(normalizeGoal(existing))) errors.push(`goal already exists with different content: ${goalId}`);
  return { ok: errors.length === 0, errors, normalized: normalizePlan(plan) };
}

export async function approvePlan(plan, root = process.cwd()) {
  if (plan?.approved !== true) throw new Error('explicit approval is required: approved must be true');
  const current = await readProgress(root); const result = validatePlan(plan, current);
  if (!result.ok) throw new Error(`Invalid progress plan: ${result.errors.join('; ')}`);
  const goal = result.normalized; const next = current.goals.some(item => item.id === goal.id) ? current : { ...current, goals: [...current.goals, goal] };
  const json = `${JSON.stringify(next, null, 2)}\n`; if (Buffer.byteLength(json) > LIMITS.bytes) throw new Error('progress file exceeds 64 KiB');
  await atomicWrite(resolve(root, PROGRESS_PATH), json); await atomicWrite(resolve(root, PROGRESS_VIEW_PATH), renderProgress(next)); return next;
}

export const progressStatus = value => value.goals.map(goal => ({ id: goal.id, title: goal.title, status: goal.status, executionMode: goal.executionMode ?? 'collaborative', modeOffered: goal.modeOffered ?? false, steps: goal.steps.map(step => ({ id: step.id, title: step.title, status: step.status, evidence: step.evidence.slice(0, 3) })) }));
export function progressNext(value, goalId) {
  const goal = value.goals.find(item => item.id === goalId);
  if (!goal) throw new Error(`Unknown goal: ${goalId}`);
  const priority = { IN_PROGRESS: 0, BLOCKED: 1, TODO: 2, DONE: 3 };
  const next = goal.steps.filter(step => step.status !== 'DONE').sort((a, b) => priority[a.status] - priority[b.status] || goal.steps.indexOf(a) - goal.steps.indexOf(b)).slice(0, LIMITS.next);
  return { goalId: goal.id, mode: goal.executionMode ?? 'collaborative', complete: goal.steps.every(step => step.status === 'DONE'), next: next.map(step => ({ stepId: step.id, title: step.title, status: step.status, evidence: step.evidence.slice(0, 3) })) };
}

export async function setProgressMode(goalId, mode, userConfirmed, root = process.cwd()) {
  if (!EXECUTION_MODES.includes(mode)) throw new Error(`mode must be one of: ${EXECUTION_MODES.join(', ')}`);
  if (mode === 'autonomous' && userConfirmed !== true) throw new Error('autonomous mode requires explicit userConfirmed: true');
  return updateProgress(root, current => {
    const index = current.goals.findIndex(goal => goal.id === goalId);
    if (index < 0) throw new Error(`Unknown goal: ${goalId}`);
    const goals = [...current.goals]; goals[index] = { ...goals[index], executionMode: mode, modeOffered: true };
    return { ...current, goals };
  });
}

export async function updateProgressStep({ goalId, stepId, status, evidence = [] }, root = process.cwd()) {
  if (!STATUSES.has(status)) throw new Error(`status must be one of: ${[...STATUSES].join(', ')}`);
  if (!Array.isArray(evidence) || evidence.length > LIMITS.evidence || evidence.some(item => !shortReference(item))) throw new Error('evidence must contain short safe references');
  return updateProgress(root, current => {
    const goalIndex = current.goals.findIndex(goal => goal.id === goalId);
    if (goalIndex < 0) throw new Error(`Unknown goal: ${goalId}`);
    const goal = current.goals[goalIndex]; const stepIndex = goal.steps.findIndex(step => step.id === stepId);
    if (stepIndex < 0) throw new Error(`Unknown step: ${stepId}`);
    if (status === 'DONE' && evidence.length === 0 && goal.steps[stepIndex].evidence.length === 0) throw new Error('DONE requires at least one evidence reference');
    const steps = [...goal.steps]; steps[stepIndex] = { ...steps[stepIndex], status, evidence: evidence.length ? [...new Set(evidence)] : steps[stepIndex].evidence };
    const remaining = steps.filter(step => step.status !== 'DONE');
    const goalStatus = steps.every(step => step.status === 'DONE') ? 'DONE' : remaining.length > 0 && remaining.every(step => step.status === 'BLOCKED') ? 'BLOCKED' : 'ACTIVE';
    const goals = [...current.goals]; goals[goalIndex] = { ...goal, status: goalStatus, steps };
    return { ...current, goals };
  });
}

export async function markModeOffered(goalId, root = process.cwd()) {
  return updateProgress(root, current => {
    const index = current.goals.findIndex(goal => goal.id === goalId); if (index < 0) throw new Error(`Unknown goal: ${goalId}`);
    const goals = [...current.goals]; goals[index] = { ...goals[index], modeOffered: true }; return { ...current, goals };
  });
}
export function renderProgress(value) {
  const lines = ['# Progress checklist', ''];
  for (const goal of value.goals) { lines.push(`## ${goal.title} — ${goal.status}`, ''); for (const step of goal.steps) { const displayStatus = step.status === 'TODO' ? 'PENDING' : step.status; lines.push(`- [${step.status === 'DONE' ? 'x' : ' '}] **${step.title}** — ${displayStatus}${step.evidence.length ? ` _(evidence: ${step.evidence.slice(0, 3).join(', ')})_` : ''}`); } lines.push(''); }
  if (!value.goals.length) lines.push('_No goals approved yet._', ''); return lines.join('\n');
}
function normalizePlan(plan) { return { schemaVersion: 1, id: plan.goalId ?? plan.id, title: plan.title, status: plan.status ?? 'ACTIVE', executionMode: 'collaborative', modeOffered: false, steps: plan.steps.map(step => ({ id: step.id, title: step.title, status: step.status ?? 'TODO', acceptance: step.acceptance, files: step.files, commands: step.commands, evidence: step.evidence ?? [] })) }; }
function normalizeGoal(goal) { return { schemaVersion: 1, id: goal.id, title: goal.title, status: goal.status, executionMode: goal.executionMode ?? 'collaborative', modeOffered: goal.modeOffered ?? false, steps: goal.steps }; }
function isId(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(value); }
function text(value) { return typeof value === 'string' && value.trim() && value.length <= LIMITS.text && !SECRET.test(value); }
function shortReference(value) { return typeof value === 'string' && value.length > 0 && value.length <= LIMITS.text && !SECRET.test(value) && ![...value].some(character => character.codePointAt(0) <= 31); }
function safePath(value) {
  if (!shortReference(value) || isAbsolute(value) || value.startsWith('~') || value.split(/[\\/]+/u).includes('..')) return false;
  const normalized = value.replaceAll('\\', '/');
  return relative('.', value).replaceAll('\\', '/') === normalized;
}
async function atomicWrite(path, content) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.${Date.now()}.tmp`; const handle = await open(temp, 'wx', 0o600); try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); } await rename(temp, path); }

async function updateProgress(root, transform) {
  const current = await readProgress(root); const next = transform(current); const json = `${JSON.stringify(next, null, 2)}\n`;
  if (Buffer.byteLength(json) > LIMITS.bytes) throw new Error('progress file exceeds 64 KiB');
  await atomicWrite(resolve(root, PROGRESS_PATH), json); await atomicWrite(resolve(root, PROGRESS_VIEW_PATH), renderProgress(next)); return next;
}
