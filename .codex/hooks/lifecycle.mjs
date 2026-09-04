import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const lifecycleEvents = [
  'SessionStart',
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'PreCompact',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'SessionEnd',
];

const MAX_CONTEXT_LENGTH = 4096;
const MAX_SUBAGENT_CONTEXT_LENGTH = 64 * 1024;
const CTXROUTE_BUDGET = '0';
const MAX_SYSTEM_MESSAGE_LENGTH = 1000;

export function handlerPlan(harness, event, root = projectRoot, lane = 'synchronous') {
  const local = name => ({ name, path: join(root, '.codex', 'hooks', name), args: [] });
  const problemMemory = event => ({ name: 'problem-memory.mjs', path: join(root, '.codex', 'hooks', 'problem-memory.mjs'), args: [event] });
  const progressSubagent = event => ({ name: 'progress-subagent.mjs', path: join(root, '.codex', 'hooks', 'progress-subagent.mjs'), args: [harness, event] });
  const direct = (name, ...args) => ({ name, path: join(root, 'node_modules', 'ctxroute', 'src', 'hooks', name), args });
  const ctxroute = harness === 'codex' || harness === 'claude' ? direct : null;
  if (!ctxroute) return [];

  if (event === 'PostToolUse' && lane === 'maintenance') {
    return [local('post-tool-crg.mjs'), problemMemory('PostToolUse'), local('archify-preview.mjs')];
  }

  return {
    SessionStart: [ctxroute('session-inject.js', '--budget', CTXROUTE_BUDGET), local('crg-context.mjs')],
    PreToolUse: [local('pre-tool-architecture.mjs'), ctxroute(harness === 'codex' ? 'codex-doc-inject.js' : 'doc-inject.js', '--budget', CTXROUTE_BUDGET)],
    PostToolUse: [ctxroute(harness === 'codex' ? 'codex-doc-write-guard.js' : 'doc-write-guard.js'), local('post-tool-sensor.mjs'), local('post-tool-audit.mjs')],
    UserPromptSubmit: [ctxroute('turn-count.js'), ctxroute('canary-check.js'), problemMemory('UserPromptSubmit')],
    PreCompact: [ctxroute('ctxroute-reset.js')],
    Stop: [local('stop-review.mjs')],
    SubagentStart: [progressSubagent('SubagentStart')],
    SubagentStop: [progressSubagent('SubagentStop')],
    SessionEnd: [progressSubagent('SessionEnd')],
  }[event] ?? [];
}

export function mergeOutputs(event, outputs, notices = []) {
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

  if (contexts.length) hookSpecificOutput.additionalContext = limit(contexts.join('\n\n'), event === 'SubagentStart' ? MAX_SUBAGENT_CONTEXT_LENGTH : MAX_CONTEXT_LENGTH);
  if (Object.keys(hookSpecificOutput).length) {
    hookSpecificOutput.hookEventName ??= event;
    merged.hookSpecificOutput = hookSpecificOutput;
  }
  if (systemMessages.length) merged.systemMessage = systemMessages.join(' · ');
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

export function dispatch({ harness, event, input, root = projectRoot, execute = executeHandler, lane = 'synchronous' }) {
  const plan = applicableHandlers(handlerPlan(harness, event, root, lane), event, input);
  if (!lifecycleEvents.includes(event) || !plan.length) {
    return { systemMessage: `Lifecycle ${event || '(missing)'} failed open: unsupported ${harness || '(missing)'} configuration.` };
  }

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
  return mergeOutputs(event, outputs, notices);
}

export function applicableHandlers(plan, event, input) {
  if (event !== 'PreToolUse') return plan;
  let toolName;
  try { toolName = JSON.parse(input || '{}')?.tool_name; }
  catch { return plan; }
  if (!toolName || /^(?:apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell)$/iu.test(String(toolName))) return plan;
  return plan.filter(handler => handler.name !== 'pre-tool-architecture.mjs');
}

export function executeHandler(handler, input, root) {
  const result = spawnSync(process.execPath, [handler.path, ...handler.args], {
    cwd: root,
    env: ctxrouteEnvironment(root),
    input,
    encoding: 'utf8',
    timeout: 30_000,
  });
  const stderr = actionableStderr(result.stderr);
  if (result.error || (result.status !== 0 && result.status !== null)) {
    return { error: result.error?.message ?? `exit ${result.status}`, stderr, outputs: [] };
  }

  const stdout = String(result.stdout ?? '').trim();
  if (!stdout) return { stderr, outputs: [] };
  try {
    return { stderr, outputs: [JSON.parse(stdout)] };
  } catch {
    return { error: `invalid JSON output: ${stdout.slice(0, 160)}`, stderr, outputs: [] };
  }
}

export function actionableStderr(value) {
  return String(value ?? '')
    .replace(/^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n(?:\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n?)?/gmu, '')
    .trim();
}

function ctxrouteEnvironment(root) {
  return {
    ...process.env,
    CTXROUTE_CONFIG_PATH: join(root, 'ctxroute-config.json'),
    CTXROUTE_DOCS_DIR: join(root, 'docs', 'mcp'),
    CTXROUTE_FILEDOCS_DIR: join(root, '.claude', 'hooks', 'docs'),
    CTXROUTE_FLEET_HOOKS_DIR: join(root, '.claude', 'hooks'),
    CTXROUTE_SESSIONDOCS_DIR: join(root, 'docs', 'session'),
    CTXROUTE_STATE_DIR: process.env.CTXROUTE_STATE_DIR || join(root, '.ctxroute', 'state'),
  };
}

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = dispatch({ harness: process.argv[2], event: process.argv[3], lane: process.argv[4], input: await stdin() });
  if (result) process.stdout.write(JSON.stringify(result));
}
