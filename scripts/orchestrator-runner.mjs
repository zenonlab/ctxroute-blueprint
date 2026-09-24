import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadOrchestratorConfig, readOrchestratorState, transactOrchestrator } from './orchestrator-core.mjs';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';
import { commitMission, integrateMission, readCoordination, submitWorkerReport } from './orchestrator-service.mjs';
import { verifyWorkerRoots } from './orchestrator-worker-roots.mjs';

const ADAPTERS = Object.freeze({
  codex: { executable: 'codex', args: ['exec', '--json', '--sandbox', 'workspace-write', '-c', 'features.multi_agent=false', '-'] },
  claude: { executable: 'claude', args: ['-p', '--output-format', 'text', '--disallowedTools', 'Task'] },
  opencode: { executable: 'opencode', args: ['run', '--format', 'json'] },
});

export async function runMissionAdapter(adapter, view, worktree, limits, environment = process.env, dependencies = {}) {
  const definition = ADAPTERS[adapter];
  if (!definition) throw new Error(`unknown worker adapter: ${adapter}`);
  const prompt = `Complete only this CTXRoute mission. Do not delegate or start subagents. Do not commit or integrate. Change only file_scope in the assigned worktree. Return only a JSON worker-report object matching response_format.\n${JSON.stringify(view)}`;
  const args = adapter === 'opencode' ? [...definition.args, prompt] : definition.args;
  const workerEnvironment = { ...environment, CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: view.mission_id, CTXROUTE_PRIMARY_ROOT: view.primary_root, CTXROUTE_WORKTREE: worktree, CTXROUTE_POLICY_DIGEST: view.policy_digest, CTXROUTE_POLICY_SNAPSHOT: view.policy_snapshot, CTXROUTE_WORKFLOW: view.workflow, CTXROUTE_STAGE: view.stage, CTXROUTE_STRATEGY: view.strategy, CTXROUTE_ACCESS: view.access };
  if (adapter === 'opencode') workerEnvironment.OPENCODE_PERMISSION = JSON.stringify({ task: 'deny', external_directory: 'deny' });
  const output = await (dependencies.launch ?? launch)(definition.executable, args, { cwd: worktree, env: workerEnvironment, input: adapter === 'opencode' ? '' : prompt, timeoutMs: limits.subprocessTimeoutMs, maxBytes: limits.reportBytes });
  const report = parseReport(adapter, output);
  assertOrchestratorContract('worker-report', report);
  if (report.mission_id !== view.mission_id) throw categorized('INVALID_WORKER_REPORT', 'worker report identifies another mission');
  return report;
}

function launch(executable, args, options) {
  return new Promise((resolveLaunch, rejectLaunch) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let stdout = '';
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, options.timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; if (Buffer.byteLength(stdout) > options.maxBytes) { overflow = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); rejectLaunch(categorized(error.code === 'ENOENT' ? 'WORKER_CLI_MISSING' : 'WORKER_LAUNCH_FAILED', 'worker executable could not start')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) rejectLaunch(categorized('WORKER_TIMEOUT', 'worker exceeded execution time'));
      else if (overflow) rejectLaunch(categorized('WORKER_OUTPUT_LIMIT', 'worker output exceeded report budget'));
      else if (code !== 0) rejectLaunch(categorized('WORKER_EXIT_FAILED', `worker exited with code ${code}`));
      else resolveLaunch(stdout);
    });
    child.stdin.end(options.input);
  });
}

function parseReport(adapter, output) {
  try {
    let text = output.trim();
    if (adapter === 'codex' || adapter === 'opencode') {
      const lines = text.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const content = lines.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').map(event => event.item.text)
        .concat(lines.filter(event => event.type === 'text' && event.part?.text).map(event => event.part.text));
      if (content.length) text = content.at(-1);
    }
    if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '');
    return JSON.parse(text);
  } catch { throw categorized('INVALID_WORKER_REPORT', 'worker did not return a valid JSON report'); }
}

export async function runGoalMissions(goalId, adapter = 'codex', root = process.cwd(), dependencies = {}) {
  if (!ADAPTERS[adapter]) throw new Error(`unknown worker adapter: ${adapter}`);
  const config = await loadOrchestratorConfig(root);
  const state = await readOrchestratorState(root);
  const goal = state.goals.find(item => item.goal_id === goalId);
  if (!goal || goal.status !== 'ACTIVE') throw new Error('run requires an active goal');
  const running = state.goals.flatMap(item => item.missions).filter(item => item.status === 'RUNNING');
  for (const mission of running) {
    if (mission.attempt && !processAlive(mission.attempt.supervisor_pid)) {
      await finishAttempt(goalIdFor(state, mission.mission_id), mission, 'BLOCKED', 'SUPERVISOR_INTERRUPTED', root);
    }
  }
  const refreshed = await readOrchestratorState(root);
  const occupied = refreshed.goals.flatMap(item => item.missions).filter(item => item.status === 'RUNNING');
  const available = Math.max(0, config.parallelWorktrees - occupied.length);
  const selected = [];
  for (const mission of refreshed.goals.find(item => item.goal_id === goalId).missions) {
    if (selected.length >= available) break;
    if (mission.status !== 'ASSIGNED' || !mission.worktree_allocation?.path) continue;
    if ([...occupied, ...selected].some(other => scopesOverlap(mission.file_scope, other.file_scope))) continue;
    selected.push(mission);
  }
  const results = await Promise.all(selected.map(mission => runOne(goalId, mission, adapter, root, config, dependencies)));
  for (const result of results) {
    if (result.status !== 'COMPLETED' || result.access !== 'write') continue;
    try {
      let current = await readOrchestratorState(root);
      const entry = current.goals.find(item => item.goal_id === goalId).missions.find(item => item.mission_id === result.mission_id);
      if (!entry.orchestrator_commit) {
        await commitMission(command('mission.commit', { goal_id: goalId, mission_id: result.mission_id, message: `feat: complete ${result.mission_id}` }, current), root);
      }
    } catch (error) { result.integration_error = error.causeCode ?? 'INTEGRATION_FAILED'; }
  }
  const integrations = [];
  const after = await readOrchestratorState(root);
  if (after.goals.find(item => item.goal_id === goalId).stage === 'integration') {
    for (const mission of after.goals.find(item => item.goal_id === goalId).missions.filter(item => item.status === 'COMPLETED' && item.orchestrator_commit && !item.integrated_commit)) {
      try {
        const current = await readOrchestratorState(root);
        await integrateMission(command('mission.integrate', { goal_id: goalId, mission_id: mission.mission_id, commit_oid: mission.orchestrator_commit }, current), root);
        integrations.push({ mission_id: mission.mission_id, status: 'INTEGRATED' });
      } catch (error) { integrations.push({ mission_id: mission.mission_id, status: 'BLOCKED', cause: error.causeCode ?? 'INTEGRATION_FAILED' }); }
    }
  }
  return { goal_id: goalId, selected: selected.map(item => item.mission_id), results, integrations };
}

async function runOne(goalId, mission, adapter, root, config, dependencies) {
  const attemptId = `attempt-${randomUUID()}`;
  const worktree = resolve(root, mission.worktree_allocation.path);
  try {
    await verifyWorkerRoots(root, worktree, dependencies);
    let state;
    for (let retry = 0; retry < 8; retry += 1) {
      state = await readOrchestratorState(root);
      try {
        await transactOrchestrator(command('mission.attempt.start', { goal_id: goalId, mission_id: mission.mission_id, attempt_id: attemptId, adapter, supervisor_pid: process.pid, started_at: new Date().toISOString() }, state), root);
        break;
      } catch (error) {
        if (!/revision conflict/u.test(error.message) || retry === 7) throw error;
      }
    }
    const view = await readCoordination(root, { CTXROUTE_AGENT_ROLE: 'worker', CTXROUTE_MISSION_ID: mission.mission_id, CTXROUTE_WORKTREE: worktree });
    const report = await runMissionAdapter(adapter, { ...view, primary_root: resolve(root) }, worktree, config, process.env, dependencies);
    await finishAttempt(goalId, { ...mission, attempt: { attempt_id: attemptId } }, 'SUCCEEDED', null, root);
    const outcome = await withRevisionRetry(root, state => submitWorkerReport(command('report.submit', { goal_id: goalId, report }, state), root));
    const updated = outcome.state.goals.find(item => item.goal_id === goalId).missions.find(item => item.mission_id === mission.mission_id);
    return { mission_id: mission.mission_id, attempt_id: attemptId, status: updated.status, access: updated.access };
  } catch (error) {
    await finishAttempt(goalId, { ...mission, attempt: { attempt_id: attemptId } }, 'BLOCKED', error.causeCode ?? 'WORKER_FAILED', root).catch(() => {});
    return { mission_id: mission.mission_id, attempt_id: attemptId, status: 'BLOCKED', cause: error.causeCode ?? 'WORKER_FAILED' };
  }
}

async function finishAttempt(goalId, mission, status, cause, root) {
  return withRevisionRetry(root, state => transactOrchestrator(command('mission.attempt.finish', { goal_id: goalId, mission_id: mission.mission_id, attempt_id: mission.attempt.attempt_id, status, finished_at: new Date().toISOString(), cause }, state), root));
}

async function withRevisionRetry(root, operation) {
  for (let retry = 0; retry < 8; retry += 1) {
    const state = await readOrchestratorState(root);
    try { return await operation(state); }
    catch (error) { if (!/revision conflict/u.test(error.message) || retry === 7) throw error; }
  }
}

function command(action, payload, state) { return { operation_id: `operation-${randomUUID()}`, expected_revision: state.revision, action, payload }; }
function goalIdFor(state, missionId) { return state.goals.find(goal => goal.missions.some(mission => mission.mission_id === missionId)).goal_id; }
function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } }
function scopesOverlap(left, right) { return left.some(a => right.some(b => { const first = a.replace(/\/$/u, '').toLowerCase(); const second = b.replace(/\/$/u, '').toLowerCase(); return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`); })); }
function categorized(causeCode, message) { const error = new Error(message); error.causeCode = causeCode; return error; }
