import process from 'node:process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hookContract } from './lifecycle-contract.mjs';
import { classifyGitCommand } from '../../scripts/git-command-policy.mjs';
import { adaptHostDecision } from './host-policy-adapter.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const lifecycleEvents = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'PreCompact',
  'Stop',
];

const MAX_CONTEXT_LENGTH = 4096;
const MAX_SYSTEM_MESSAGE_LENGTH = 1000;

export function handlerPlan(harness, event, root = projectRoot, lane = 'synchronous') {
  const local = (name, failureClass, run) => ({ name, failureClass, run });
  const memory = memoryEvent => local('problem-memory.mjs', 'maintenance', async (input, project, environment) => (await import('./problem-memory.mjs')).handle(input, memoryEvent, { stateDirectory: environment.CTXROUTE_STATE_DIR, projectRoot: project }));
  if (harness !== 'codex' && harness !== 'claude') return [];

  const plans = {
    synchronous: {
      SessionStart: [local('worktree-reconcile.mjs', 'advisory', async (_input, project) => (await import('./worktree-reconcile.mjs')).reconcileHook(project)), local('mission-context.mjs', 'advisory', async (_input, project, environment) => (await import('./mission-context.mjs')).missionContext(environment.CTXROUTE_MISSION_ID, project))],
      PreToolUse: [local('pre-tool-architecture.mjs', 'critical-mutation-gate', async (input, project) => (await import('./pre-tool-architecture.mjs')).preToolArchitecture(input, project))],
      PostToolUse: [local('post-tool-sensor.mjs', 'advisory', async (input, project, environment) => (await import('./post-tool-sensor.mjs')).postToolSensor(input, { stateDirectory: environment.CTXROUTE_STATE_DIR, root: project })), local('post-tool-audit.mjs', 'advisory', async (input, project) => (await import('./post-tool-audit.mjs')).postToolAudit(input, project))],
      UserPromptSubmit: [],
      PreCompact: [local('ctxroute-reset.mjs', 'advisory', async (input, project, environment) => (await import('./ctxroute-reset.mjs')).resetCtxrouteContext(input, project, environment))],
      Stop: [local('worker-restitution.mjs', 'advisory', async (_input, project, environment) => (await import('./worker-restitution.mjs')).restituteWorker(environment.CTXROUTE_WORKER_REPORT, project, environment)), local('ctxroute-reset.mjs', 'advisory', async (input, project, environment) => (await import('./ctxroute-reset.mjs')).resetCtxrouteContext(input, project, environment)), local('stop-review.mjs', 'advisory', async input => (await import('./stop-review.mjs')).stopReview(parseInput(input), root))],
    },
    maintenance: {
      PostToolUse: [memory('PostToolUse'), local('post-tool-crg.mjs', 'maintenance', async (input, project, environment) => (await import('./post-tool-crg.mjs')).runCrgMaintenance(input, { root: project, stateDirectory: environment.CTXROUTE_STATE_DIR }))],
      UserPromptSubmit: [memory('UserPromptSubmit')],
    },
    manual: {
      PostToolUse: [local('archify-preview.mjs', 'maintenance', async () => null)],
    },
  };
  return plans[lane]?.[event] ?? [];
}

export function mergeOutputs(event, outputs, notices = [], contextMaximum = MAX_CONTEXT_LENGTH) {
  const merged = {};
  const hookSpecificOutput = {};
  const contexts = [];
  const systemMessages = [...notices];

  for (const output of outputs) {
    if (!output || output !== Object(output)) continue;
    for (const [key, value] of Object.entries(output)) {
      if (key === 'hookSpecificOutput' || key === 'systemMessage') continue;
      merged[key] = value;
    }
    if (output.systemMessage === String(output.systemMessage) && output.systemMessage.trim()) systemMessages.push(limit(output.systemMessage.trim(), MAX_SYSTEM_MESSAGE_LENGTH));
    if (output.hookSpecificOutput && output.hookSpecificOutput === Object(output.hookSpecificOutput)) {
      for (const [key, value] of Object.entries(output.hookSpecificOutput)) {
        if (key === 'additionalContext') {
          if (value === String(value) && value.trim()) contexts.push(limit(value.trim(), MAX_CONTEXT_LENGTH));
        } else {
          hookSpecificOutput[key] = value;
        }
      }
    }
  }

  if (contexts.length) hookSpecificOutput.additionalContext = limit(contexts.join('\n\n'), Math.min(contextMaximum, MAX_CONTEXT_LENGTH));
  if (Object.keys(hookSpecificOutput).length) {
    hookSpecificOutput.hookEventName ??= event;
    merged.hookSpecificOutput = hookSpecificOutput;
  }
  if (systemMessages.length) merged.systemMessage = limit(systemMessages.join(' · '), MAX_SYSTEM_MESSAGE_LENGTH);
  return Object.keys(merged).length ? merged : null;
}

function limit(value, maximum) {
  if (value.length <= maximum) return value;
  return `${value.slice(0, maximum - 32)}\n[… contexte tronqué …]`;
}

export function isBlocking(output) {
  return output?.decision === 'block'
    || output?.permissionDecision === 'deny'
    || output?.hookSpecificOutput?.permissionDecision === 'deny'
    || output?.continue === false;
}

export function dispatch({ harness, event, input, root = projectRoot, execute, environment = process.env }) {
  const workerPolicy = workerGitPolicyDecision(harness, event, input, environment);
  if (workerPolicy) return workerPolicy;
  const plan = applicableHandlers(handlerPlan(harness, event, root), event, input);
  if (!lifecycleEvents.includes(event)) {
    return { systemMessage: `Lifecycle ${event || '(missing)'} failed open: unsupported ${harness || '(missing)'} configuration.` };
  }
  if (!plan.length) return null;

  const outputs = [];
  const notices = [];
  for (const handler of plan) {
    const result = execute(handler, input, root);
    if (result.error) {
      notices.push(`Lifecycle ${event} handler ${handler.name} failed open: ${result.error}`);
      continue;
    }
    if (result.stderr) notices.push(`Lifecycle ${event} handler ${handler.name}: ${result.stderr}`);
    for (const output of result.outputs ?? []) {
      if (isBlocking(output)) return output;
      outputs.push(output);
    }
  }
  return mergeOutputs(event, outputs, notices, hookContract(harness, event, 'synchronous', root).contextLimit);
}

export async function dispatchLifecycle({ harness, event, input, root = projectRoot, environment = process.env, lane = 'synchronous' }) {
  const workerPolicy = workerGitPolicyDecision(harness, event, input, environment);
  if (workerPolicy) return workerPolicy;
  const plan = applicableHandlers(handlerPlan(harness, event, root, lane), event, input);
  if (event === 'PreToolUse' && plan.length === 0) return null;
  if (lane === 'manual') return null;
  const resolved = lane === 'synchronous'
    ? await (await import('./resolved-policy.mjs')).resolvedPolicyDecision(input, root, environment)
    : { decision: null, source: 'not-required', diagnostic: null };
  if (resolved.decision) {
    const adapted = adaptHostDecision(harness, event, resolved.decision);
    if (adapted.exitCode !== 0) return { __hostExit: adapted };
    return adapted.stdout ? JSON.parse(adapted.stdout) : null;
  }
  if (!lifecycleEvents.includes(event)) {
    return { systemMessage: `Lifecycle ${event || '(missing)'} failed open: unsupported ${harness || '(missing)'} configuration.` };
  }
  if (!plan.length) return null;
  const outputs = [];
  const notices = resolved.source === 'last-valid' && resolved.diagnostic ? [`Lifecycle ${event} policy source ${resolved.source}: ${resolved.diagnostic}`] : [];
  for (const handler of plan) {
    try {
      const output = await handler.run(input, root, environment);
      if (isBlocking(output)) return output;
      if (output) outputs.push(output);
    } catch (error) {
      if (handler.failureClass === 'critical-mutation-gate') {
        const adapted = adaptHostDecision(harness, event, { kind: 'block', cause: 'MUTATION_GATE_FAILURE', invariant: `${handler.name} must succeed before mutation`, recovery: 'repair the local hook and retry' });
        return adapted.stdout ? JSON.parse(adapted.stdout) : { __hostExit: adapted };
      }
      notices.push(`Lifecycle ${event} handler ${handler.name} failed open: ${error.message}`);
    }
  }
  if (lane === 'maintenance') return null;
  return mergeOutputs(event, outputs, notices, hookContract(harness, event, 'synchronous', root).contextLimit);
}

export function workerGitPolicyDecision(harness, event, input, environment = process.env) {
  if (event !== 'PreToolUse' || environment.CTXROUTE_AGENT_ROLE !== 'worker') return null;
  let parsed;
  try { parsed = JSON.parse(input || '{}'); } catch { return null; }
  if (!/^(?:exec_command|Bash|Shell)$/u.test(String(parsed.tool_name ?? ''))) return null;
  const command = parsed.tool_input?.cmd ?? parsed.tool_input?.command;
  const classification = classifyGitCommand(command);
  if (classification.allowed_for_worker) return null;
  const adapted = adaptHostDecision(harness, event, {
    kind: 'block', mode: environment.CTXROUTE_MODE ?? 'SWARM', workflow: environment.CTXROUTE_WORKFLOW ?? 'STANDARD',
    stage: environment.CTXROUTE_STAGE ?? 'work', policy_digest: environment.CTXROUTE_POLICY_DIGEST ?? 'NO_DIGEST',
    cause: 'WORKER_GIT_MUTATION_FORBIDDEN', invariant: 'workers may execute only read-only Git commands',
    recovery: 'use orchestrator_submit_worker_report or the orchestrator CLI',
  });
  return adapted.stdout ? JSON.parse(adapted.stdout) : { decision: 'block', reason: adapted.stderr };
}

export function applicableHandlers(plan, event, input) {
  if (event !== 'PreToolUse') return plan;
  let toolName;
  try { toolName = JSON.parse(input || '{}')?.tool_name; }
  catch { return plan; }
  if (!toolName || /^(?:apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell)$/iu.test(String(toolName))) return plan;
  return plan.filter(handler => handler.name !== 'pre-tool-architecture.mjs');
}

export function actionableStderr(value) {
  return String(value ?? '')
    .replace(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n?)?/gmu, '')
    .trim();
}

function parseInput(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await dispatchLifecycle({ harness: process.argv[2], event: process.argv[3], lane: process.argv[4] ?? 'synchronous', input: await stdin() });
  if (result?.__hostExit) {
    if (result.__hostExit.stdout) process.stdout.write(result.__hostExit.stdout);
    if (result.__hostExit.stderr) process.stderr.write(result.__hostExit.stderr);
    process.exitCode = result.__hostExit.exitCode;
  } else if (result) process.stdout.write(JSON.stringify(result));
}
