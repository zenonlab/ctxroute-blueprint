import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { get as requestLoopback } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { actionableStderr, applicableHandlers, dispatch, executeHandler, handlerPlan, lifecycleEvents, mergeOutputs } from '../.codex/hooks/lifecycle.mjs';
import { progressContext } from '../.codex/hooks/progress-context.mjs';
import { archifyInstruction, checkSyntax, progressContinuation } from '../.codex/hooks/stop-review.mjs';
import { handleProgressLifecycle, isProgressWorker, parseProgressResult, sessionOwnerPrefix, subagentOwner } from '../.codex/hooks/progress-subagent.mjs';
import { approvePlan, readProgress } from '../scripts/progress-core.mjs';
import { inspectGlobalCtxrouteHooks, inspectInstallation } from '../.githooks/postinstall.mjs';
import { isArchitectureEvidence, validateProjectConfig } from '../.githooks/project-policy.mjs';
import { runStep } from '../.githooks/setup.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const isolatedCtxrouteState = mkdtempSync(join(tmpdir(), 'hooks-ctxroute-state-'));
process.env.CTXROUTE_STATE_DIR = isolatedCtxrouteState;
process.on('exit', () => rmSync(isolatedCtxrouteState, { recursive: true, force: true }));

function expectedHookCommand(harness, event, lane = '') {
  const suffix = lane ? ` ${lane}` : '';
  return harness === 'codex'
    ? `node "$(git rev-parse --show-toplevel)/.codex/hooks/lifecycle.mjs" codex ${event}${suffix}`
    : `node "\${CLAUDE_PROJECT_DIR}/.codex/hooks/lifecycle.mjs" claude ${event}${suffix}`;
}

test('Codex and Claude expose matching lifecycle handlers with portable commands and valid event budgets', () => {
  const contextEvents = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SubagentStart']);
  for (const [file, harness] of [['.codex/hooks.json', 'codex'], ['.claude/settings.json', 'claude']]) {
    const config = JSON.parse(readFileSync(join(root, file), 'utf8'));
    assert.deepEqual(Object.keys(config.hooks).sort(), [...lifecycleEvents].sort());
    for (const event of lifecycleEvents) {
      const handlers = config.hooks[event].flatMap(block => block.hooks ?? []);
      assert.equal(handlers.length, event === 'PostToolUse' ? 2 : 1, `${file} ${event}`);
      assert.equal(handlers[0].command, expectedHookCommand(harness, event));
      for (const handler of handlers) {
        assert.ok(handler.timeout > 0, `${file} ${event} timeout`);
        assert.equal('statusMessage' in handler, false, `${file} ${event} should remain quiet`);
      }
      if (event === 'PostToolUse') {
        assert.equal(handlers[1].command, expectedHookCommand(harness, 'PostToolUse', 'maintenance'));
        assert.equal(handlers[1].async, true);
      }
      if (harness === 'codex') for (const handler of handlers) {
        if (contextEvents.has(event)) assert.equal(handler.additionalContextLimit, event === 'SubagentStart' ? 2500 : 1200, `${file} ${event} context limit`);
        else assert.equal('additionalContextLimit' in handler, false, `${file} ${event} must not configure unsupported context`);
        assert.match(handler.commandWindows, /git rev-parse --show-toplevel/u);
      }
    }
    assert.equal(config.hooks.PostToolUse[0].matcher, 'apply_patch|Edit|Write');
    assert.equal(config.hooks.PreToolUse[0].matcher, 'apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell');
    assert.equal(config.hooks.SubagentStart[0].matcher, '^progress[-_]worker$');
    assert.equal(config.hooks.SubagentStop[0].matcher, '^progress[-_]worker$');
    assert.equal(config.hooks.SubagentStop[0].hooks[0].timeout, 5);
    assert.equal(config.hooks.SessionEnd[0].hooks[0].timeout, 3);
  }
});

test('configured lifecycle commands resolve the repository from a nested working directory', { skip: process.platform === 'win32' }, () => {
  for (const [file, harness] of [['.codex/hooks.json', 'codex'], ['.claude/settings.json', 'claude']]) {
    const config = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const command = config.hooks.SessionEnd[0].hooks[0].command;
    const result = spawnSync('/bin/sh', ['-lc', command], {
      cwd: join(root, 'docs'),
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ session_id: `nested-${harness}`, hook_event_name: 'SessionEnd', cwd: join(root, 'docs') }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('resume context is silent without active work and bounded when work exists', async () => {
  const empty = progressHookWorkspace();
  assert.equal(await progressContext(empty, 'SessionStart'), null);
  await approvePlan({ ...progressPlan(1), approved: true }, empty);
  const result = await progressContext(empty, 'SessionStart');
  assert.equal(result.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(result.hookSpecificOutput.additionalContext, /never a permission gate/u);
  assert.match(result.hookSpecificOutput.additionalContext, /step-1/u);
  assert.ok(result.hookSpecificOutput.additionalContext.length <= 600);
});

test('initialize refuses an incomplete template without changing status', () => {
  const cwd = initializationWorkspace({ incomplete: true });
  const configPath = join(cwd, '.project/project-config.json');
  const before = JSON.parse(readFileSync(configPath, 'utf8'));
  const result = spawnSync(process.execPath, [join(root, '.githooks/initialize.mjs')], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_execpath: join(cwd, 'npm-cli.mjs') },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /Initialization blocked/u);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).status, before.status);
});

test('initialize accepts completed documents containing Markdown links', () => {
  const cwd = initializationWorkspace({ incomplete: false });
  const configPath = join(cwd, '.project/project-config.json');
  const result = spawnSync(process.execPath, [join(root, '.githooks/initialize.mjs')], { cwd, encoding: 'utf8', env: { ...process.env, npm_execpath: join(cwd, 'npm-cli.mjs') } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(configPath, 'utf8')).status, 'initialized');
});

test('project configuration inspection accepts the declared internal/product split', () => {
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  assert.deepEqual(validateProjectConfig(config, root, { supportedStatuses: ['template', 'initialized'] }), []);
});

test('project configuration inspection rejects overlapping diagram audiences', () => {
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  config.architecture.documents = [config.architecture.internalDocuments[0]];
  assert.match(validateProjectConfig(config, root, { supportedStatuses: ['template', 'initialized'] }).join(' '), /both product and internal/u);
});

test('project configuration inspection validates Sensor languages and extension ownership', () => {
  const base = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  const unknown = structuredClone(base);
  unknown.quality.sensor.languages = ['unknown-language'];
  unknown.quality.sensor.antiSlopEffect = 'sometimes';
  assert.match(validateProjectConfig(unknown, root, { supportedStatuses: ['template', 'initialized'] }).join(' '), /known catalogue identifiers/u);
  assert.match(validateProjectConfig(unknown, root, { supportedStatuses: ['template', 'initialized'] }).join(' '), /auto, enabled, or disabled/u);
  const mismatch = structuredClone(base);
  mismatch.quality.sensor.languages = ['json'];
  assert.match(validateProjectConfig(mismatch, root, { supportedStatuses: ['template', 'initialized'] }).join(' '), /codeExtensions .js requires/u);
});

test('architecture evidence recognizes explicitly declared sources', () => {
  const config = { architecture: { documents: ['docs/architecture/src/product.sequence.json'], internalDocuments: ['docs/architecture/src/control.dataflow.json'] } };
  assert.equal(isArchitectureEvidence('docs/architecture/src/product.sequence.json', config), true);
  assert.equal(isArchitectureEvidence('docs/architecture/src/control.dataflow.json', config), true);
});

test('architecture evidence recognizes a newly typed Archify source', () => {
  assert.equal(isArchitectureEvidence('docs/architecture/src/checkout.lifecycle.json', { architecture: { documents: [], internalDocuments: [] } }), true);
});

test('architecture evidence rejects unrelated documentation', () => {
  assert.equal(isArchitectureEvidence('docs/guide.md', { architecture: { documents: [], internalDocuments: [] } }), false);
});

test('the lifecycle dispatcher declares every event and the required sequence', () => {
  const expected = {
    SessionStart: ['session-inject.js', 'progress-context.mjs'],
    PreToolUse: ['pre-tool-architecture.mjs', 'codex-doc-inject.js'],
    PostToolUse: ['codex-doc-write-guard.js', 'post-tool-sensor.mjs', 'post-tool-audit.mjs'],
    UserPromptSubmit: ['turn-count.js', 'canary-check.js', 'problem-memory.mjs'],
    PreCompact: ['ctxroute-reset.js'],
    Stop: ['stop-review.mjs'],
    SubagentStart: ['progress-subagent.mjs'],
    SubagentStop: ['progress-subagent.mjs'],
    SessionEnd: ['progress-subagent.mjs', 'ctxroute-reset.js'],
  };
  for (const event of lifecycleEvents) {
    assert.deepEqual(handlerPlan('codex', event, root).map(handler => handler.name), expected[event]);
    const called = [];
    dispatch({
      harness: 'codex',
      event,
      input: '{}',
      root,
      execute(handler) { called.push(handler.name); return { outputs: [] }; },
    });
    assert.deepEqual(called, expected[event], `${event} simulation`);
  }
  assert.equal(handlerPlan('claude', 'PreToolUse', root)[1].name, 'doc-inject.js');
  assert.equal(handlerPlan('claude', 'PostToolUse', root)[0].name, 'doc-write-guard.js');
  assert.deepEqual(handlerPlan('codex', 'PostToolUse', root, 'maintenance').map(handler => handler.name), ['post-tool-crg.mjs', 'problem-memory.mjs', 'archify-preview.mjs']);
  assert.deepEqual(applicableHandlers(handlerPlan('codex', 'PostToolUse', root, 'maintenance'), 'PostToolUse', JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'README.md' }, tool_response: {} })), []);
  assert.deepEqual(applicableHandlers(handlerPlan('codex', 'PostToolUse', root, 'maintenance'), 'PostToolUse', JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' }, tool_response: {} })).map(handler => handler.name), ['post-tool-crg.mjs']);
  assert.deepEqual(applicableHandlers(handlerPlan('codex', 'PostToolUse', root, 'maintenance'), 'PostToolUse', JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/src/system.architecture.json' }, tool_response: { is_error: true } })).map(handler => handler.name), ['problem-memory.mjs', 'archify-preview.mjs']);
  const codexInjection = handlerPlan('codex', 'PreToolUse', root)[1];
  assert.equal(codexInjection.path, join(root, 'node_modules', 'ctxroute', 'src', 'hooks', 'codex-doc-inject.js'));
  assert.deepEqual(codexInjection.args, ['--budget', '1800']);
  assert.notEqual(codexInjection.path, join(root, '.codex', 'hooks', 'ctxroute.mjs'));
});

test('subagent ownership is opaque and separates sessions and agents', () => {
  assert.notEqual(subagentOwner('codex', 'session-a', 'agent-1'), subagentOwner('codex', 'session-b', 'agent-1'));
  assert.notEqual(subagentOwner('codex', 'session-a', 'agent-1'), subagentOwner('codex', 'session-a', 'agent-2'));
  assert.equal(subagentOwner('codex', 'session-a', 'agent-1').startsWith(sessionOwnerPrefix('codex', 'session-a')), true);
  assert.doesNotMatch(subagentOwner('codex', 'raw-session', 'raw-agent'), /raw-(?:session|agent)/u);
});

test('automatic Progress assignment is explicit to progress workers', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1), approved: true }, directory);
  assert.equal(isProgressWorker('Explore'), false);
  assert.equal(isProgressWorker('progress-worker'), true);
  assert.equal(await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify({ session_id: 'session-a', agent_id: 'agent-1', agent_type: 'Explore' }), directory), null);
  assert.equal((await readProgress(directory)).goals[0].steps[0].status, 'TODO');
});

test('progress result parsing requires a strict final footer and bounded evidence', () => {
  assert.deepEqual(parseProgressResult('work complete\nPROGRESS_RESULT: {"status":"DONE","evidence":["npm test"]}'), { status: 'DONE', evidence: ['npm test'] });
  assert.deepEqual(parseProgressResult('PROGRESS_RESULT: {"status":"BLOCKED","evidence":["missing fixture"]}\n\n'), { status: 'BLOCKED', evidence: ['missing fixture'] });
  for (const message of [
    'finish',
    'PROGRESS_RESULT: {bad}',
    'PROGRESS_RESULT: {"status":"DONE","evidence":[]}',
    '```\nPROGRESS_RESULT: {"status":"DONE","evidence":["npm test"]}\n```',
    '```text\nPROGRESS_RESULT: {"status":"DONE","evidence":["npm test"]}',
    'PROGRESS_RESULT: {"status":"TODO","evidence":["npm test"]}',
    'PROGRESS_RESULT: {"status":"DONE","evidence":["npm test"],"extra":true}',
    'PROGRESS_RESULT: {"status":"DONE","evidence":["Bearer abcdefghijklmnop"]}',
    'PROGRESS_RESULT: {"status":"DONE","evidence":["ghp_abcdefghijklmnop"]}',
    'PROGRESS_RESULT: {"status":"DONE","evidence":["sk-abcdefghijklmnop"]}',
  ]) assert.equal(parseProgressResult(message), undefined, message);
});

test('SubagentStop ignores a non-progress agent even if an owner-shaped claim exists', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1), approved: true }, directory);
  const identity = { session_id: 'session-a', agent_id: 'agent-1', agent_type: 'progress-worker' };
  await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(identity), directory);
  await handleProgressLifecycle('codex', 'SubagentStop', JSON.stringify({ ...identity, agent_type: 'Explore', last_assistant_message: 'PROGRESS_RESULT: {"status":"DONE","evidence":["npm test"]}' }), directory);
  assert.equal((await readProgress(directory)).goals[0].steps[0].status, 'IN_PROGRESS');
});

test('subagent lifecycle claims distinct automatic tickets and replays idempotently', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(3), approved: true }, directory);
  const firstInput = JSON.stringify({ session_id: 'session-a', agent_id: 'agent-1', agent_type: 'progress-worker' });
  const first = await handleProgressLifecycle('codex', 'SubagentStart', firstInput, directory);
  const repeated = await handleProgressLifecycle('codex', 'SubagentStart', firstInput, directory);
  const second = await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify({ session_id: 'session-a', agent_id: 'agent-2', agent_type: 'progress-worker' }), directory);
  const otherSession = await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify({ session_id: 'session-b', agent_id: 'agent-1', agent_type: 'progress-worker' }), directory);
  assert.equal(first.hookSpecificOutput.additionalContext, repeated.hookSpecificOutput.additionalContext);
  assert.match(first.hookSpecificOutput.additionalContext, /Acceptance:[\s\S]*Files:[\s\S]*Commands:[\s\S]*PROGRESS_RESULT/u);
  const steps = (await readProgress(directory)).goals[0].steps;
  assert.equal(new Set(steps.map(step => step.assignee)).size, 3);
  assert.notEqual(second.hookSpecificOutput.additionalContext, otherSession.hookSpecificOutput.additionalContext);
});

test('subagent ticket context stays below both harness limits and preserves the footer', async () => {
  const directory = progressHookWorkspace();
  const reference = (prefix, index) => `${prefix}-${index}-${'x'.repeat(470)}`;
  const step = {
    id: 'step-1',
    title: 'Maximum bounded ticket',
    claimable: true,
    acceptance: Array.from({ length: 30 }, (_, index) => reference('acceptance', index)),
    files: Array.from({ length: 30 }, (_, index) => reference('file', index)),
    commands: Array.from({ length: 30 }, (_, index) => reference('command', index)),
  };
  await approvePlan({ goalId: 'large-ticket', title: 'Bound context', executionMode: 'automatic', steps: [step], validationEvidence: ['audit'], approved: true }, directory);
  const result = await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify({ session_id: 'session', agent_id: 'agent', agent_type: 'progress-worker' }), directory);
  const context = result.hookSpecificOutput.additionalContext;
  assert.ok(context.length <= 2500);
  assert.match(context, /ticket details truncated/u);
  assert.match(context.split(/\r?\n/u).findLast(line => line.trim()), /^Use status BLOCKED/u);
  assert.match(context, /PROGRESS_RESULT:/u);
});

test('a busy SubagentStop fails open once without a second lock wait', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1), approved: true }, directory);
  const identity = { session_id: 'session', agent_id: 'agent', agent_type: 'progress-worker' };
  await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(identity), directory);
  const lock = join(directory, '.ctxroute/state/progress.lock');
  mkdirSync(join(directory, '.ctxroute/state'), { recursive: true });
  writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'live-test-lock' }));
  const started = Date.now();
  const result = await handleProgressLifecycle('codex', 'SubagentStop', JSON.stringify({ ...identity, last_assistant_message: 'PROGRESS_RESULT: {"status":"DONE","evidence":["test"]}' }), directory);
  const elapsed = Date.now() - started;
  rmSync(lock, { force: true });
  assert.match(result.systemMessage, /busy/u);
  assert.ok(elapsed >= 2_500 && elapsed < 4_500, `unexpected lock wait: ${elapsed}ms`);
});

test('subagent lifecycle skips manual goals and settles only the owned ticket', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1, { goalId: 'manual', executionMode: 'manual', manualReason: 'important-decision' }), approved: true }, directory);
  await approvePlan({ ...progressPlan(2), approved: true }, directory);
  const first = { session_id: 'session-a', agent_id: 'agent-1', agent_type: 'progress-worker' };
  const second = { session_id: 'session-b', agent_id: 'agent-1', agent_type: 'progress-worker' };
  await handleProgressLifecycle('claude', 'SubagentStart', JSON.stringify(first), directory);
  await handleProgressLifecycle('claude', 'SubagentStart', JSON.stringify(second), directory);
  await handleProgressLifecycle('claude', 'SubagentStop', JSON.stringify({ ...first, last_assistant_message: 'done\nPROGRESS_RESULT: {"status":"DONE","evidence":["node --test"]}' }), directory);
  let progress = await readProgress(directory);
  assert.equal(progress.goals.find(goal => goal.id === 'manual').steps[0].status, 'TODO');
  assert.equal(progress.goals.find(goal => goal.id === 'goal-9').steps.filter(step => step.status === 'DONE').length, 1);
  assert.equal(progress.goals.find(goal => goal.id === 'goal-9').steps.filter(step => step.status === 'IN_PROGRESS').length, 1);
  await handleProgressLifecycle('claude', 'SubagentStop', JSON.stringify({ ...second, last_assistant_message: 'PROGRESS_RESULT: {"status":"BLOCKED","evidence":["external dependency"]}' }), directory);
  progress = await readProgress(directory);
  assert.equal(progress.goals.find(goal => goal.id === 'goal-9').status, 'BLOCKED');
  assert.deepEqual(progress.goals.find(goal => goal.id === 'goal-9').steps.map(step => step.status), ['DONE', 'BLOCKED']);
});

test('a valid DONE footer completes a goal and repeated SubagentStop is a no-op', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1), approved: true }, directory);
  const owner = { session_id: 'session-a', agent_id: 'agent-1', agent_type: 'progress-worker' };
  await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(owner), directory);
  const stop = JSON.stringify({ ...owner, last_assistant_message: 'PROGRESS_RESULT: {"status":"DONE","evidence":["npm test"]}' });
  await handleProgressLifecycle('codex', 'SubagentStop', stop, directory);
  const completed = await readProgress(directory);
  await handleProgressLifecycle('codex', 'SubagentStop', stop, directory);
  assert.equal(completed.goals[0].status, 'DONE');
  assert.deepEqual(await readProgress(directory), completed);
});

test('the real subagent hook process claims and settles a fixture ticket', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(1), approved: true }, directory);
  const script = join(root, '.codex/hooks/progress-subagent.mjs');
  const identity = { session_id: 'real-session', agent_id: 'real-agent', agent_type: 'progress-worker' };
  const started = spawnSync(process.execPath, [script, 'codex', 'SubagentStart'], { cwd: directory, input: JSON.stringify(identity), encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  assert.match(JSON.parse(started.stdout).hookSpecificOutput.additionalContext, /Ticket: step-1/u);
  const stopped = spawnSync(process.execPath, [script, 'codex', 'SubagentStop'], { cwd: directory, input: JSON.stringify({ ...identity, last_assistant_message: 'PROGRESS_RESULT: {"status":"DONE","evidence":["real process"]}' }), encoding: 'utf8' });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal((await readProgress(directory)).goals[0].status, 'DONE');
});

test('subagent Progress failures stay fail-open with a short diagnostic', async () => {
  const directory = progressHookWorkspace();
  mkdirSync(join(directory, '.project'), { recursive: true });
  writeFileSync(join(directory, '.project/progress.json'), '{invalid');
  const result = await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify({ session_id: 'session-a', agent_id: 'agent-a', agent_type: 'progress-worker' }), directory);
  assert.match(result.systemMessage, /^Progress SubagentStart failed open:/u);
  assert.ok(result.systemMessage.length < 300);
});

test('invalid subagent results release only that claim and session cleanup is scoped and idempotent', async () => {
  const directory = progressHookWorkspace();
  await approvePlan({ ...progressPlan(3), approved: true }, directory);
  const ownerA = { session_id: 'session-a', agent_id: 'agent-1', agent_type: 'progress-worker' };
  const ownerB = { session_id: 'session-a', agent_id: 'agent-2', agent_type: 'progress-worker' };
  const ownerC = { session_id: 'session-b', agent_id: 'agent-1', agent_type: 'progress-worker' };
  for (const owner of [ownerA, ownerB, ownerC]) await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(owner), directory);
  await handleProgressLifecycle('codex', 'SubagentStop', JSON.stringify({ ...ownerA, last_assistant_message: 'PROGRESS_RESULT: {"status":"DONE","evidence":["api_key: secret"]}' }), directory);
  let progress = await readProgress(directory);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'TODO').length, 1);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'IN_PROGRESS').length, 2);
  await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(ownerA), directory);
  await handleProgressLifecycle('codex', 'SubagentStop', JSON.stringify({ ...ownerA, last_assistant_message: `PROGRESS_RESULT: {"status":"DONE","evidence":["${'x'.repeat(501)}"]}` }), directory);
  await handleProgressLifecycle('codex', 'SubagentStart', JSON.stringify(ownerA), directory);
  await handleProgressLifecycle('codex', 'SubagentStop', JSON.stringify({ ...ownerA, last_assistant_message: 'footer missing' }), directory);
  progress = await readProgress(directory);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'TODO').length, 1);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'IN_PROGRESS').length, 2);
  await handleProgressLifecycle('codex', 'SessionEnd', JSON.stringify({ session_id: 'session-a' }), directory);
  await handleProgressLifecycle('codex', 'SessionEnd', JSON.stringify({ session_id: 'session-a' }), directory);
  progress = await readProgress(directory);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'TODO').length, 2);
  assert.equal(progress.goals[0].steps.filter(step => step.status === 'IN_PROGRESS').length, 1);
});

test('the lifecycle dispatcher executes sequentially and merges non-blocking context', () => {
  const called = [];
  const result = dispatch({
    harness: 'codex',
    event: 'PreToolUse',
    input: '{}',
    root,
    execute(handler) {
      called.push(handler.name);
      return { outputs: [{ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: handler.name } }] };
    },
  });
  assert.deepEqual(called, ['pre-tool-architecture.mjs', 'codex-doc-inject.js']);
  assert.equal(result.hookSpecificOutput.additionalContext, 'pre-tool-architecture.mjs\n\ncodex-doc-inject.js');
});

test('the lifecycle dispatcher skips architecture policy for read-only tools', () => {
  const called = [];
  dispatch({
    harness: 'codex',
    event: 'PreToolUse',
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'src/main.ts' } }),
    root,
    execute(handler) { called.push(handler.name); return { outputs: [] }; },
  });
  assert.deepEqual(called, ['codex-doc-inject.js']);
});

test('applicable lifecycle handlers reserve architecture policy for mutations', () => {
  const plan = [
    { name: 'pre-tool-architecture.mjs' },
    { name: 'codex-doc-inject.js' },
  ];
  assert.deepEqual(
    applicableHandlers(plan, 'PreToolUse', JSON.stringify({ tool_name: 'Read' })).map(handler => handler.name),
    ['codex-doc-inject.js'],
  );
  assert.deepEqual(
    applicableHandlers(plan, 'PreToolUse', JSON.stringify({ tool_name: 'Edit' })).map(handler => handler.name),
    ['pre-tool-architecture.mjs', 'codex-doc-inject.js'],
  );
});

test('the lifecycle dispatcher delegates ADR context injection to CTXRoute', () => {
  const called = [];
  const result = dispatch({
    harness: 'codex',
    event: 'PreToolUse',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'scripts/crg-runner.mjs' } }),
    root,
    execute(handler) {
      called.push(handler.name);
      return { outputs: handler.name === 'pre-tool-architecture.mjs' ? [{ hookSpecificOutput: { additionalContext: 'Architecture gate' } }] : [] };
    },
  });
  assert.deepEqual(called, ['pre-tool-architecture.mjs', 'codex-doc-inject.js']);
  assert.match(result.hookSpecificOutput.additionalContext, /Architecture gate/u);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /Applicable architectural decisions/u);
});

test('CTXRoute emits one compact frame without queued ADR bodies', () => {
  const state = mkdtempSync(join(tmpdir(), 'ctxroute-budget-'));
  const input = JSON.stringify({
    session_id: `budget-${process.pid}-${Date.now()}`,
    cwd: root,
    tool_name: 'apply_patch',
    tool_input: { patch: '*** Begin Patch\n*** Update File: scripts/progress-core.mjs\n@@\n-before\n+after\n*** End Patch' },
  });
  try {
    const invoke = () => spawnSync(process.execPath, [join(root, '.codex/hooks/lifecycle.mjs'), 'codex', 'PreToolUse'], {
      cwd: root,
      input,
      encoding: 'utf8',
      env: { ...process.env, CTXROUTE_STATE_DIR: state },
    });
    const first = invoke();
    const second = invoke();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    const firstContext = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
    const secondContext = second.stdout ? JSON.parse(second.stdout).hookSpecificOutput?.additionalContext ?? '' : '';
    assert.doesNotMatch(firstContext, /DEFERRED|# ADR-\d{4}/u);
    assert.ok(firstContext.length <= 2_200);
    assert.ok(secondContext.length <= 2_200);
    assert.doesNotMatch(`${firstContext}\n${secondContext}`, /contexte tronqué/u);
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
});

test('the lifecycle dispatcher returns the first refusal unchanged', () => {
  const reason = 'Architecture decision required.';
  let calls = 0;
  const result = dispatch({
    harness: 'codex',
    event: 'PreToolUse',
    input: '{}',
    root,
    execute() {
      calls += 1;
      return { outputs: [{ decision: 'block', reason }] };
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { decision: 'block', reason });
});

test('the lifecycle dispatcher keeps failures fail-open and visible', () => {
  let calls = 0;
  const result = dispatch({
    harness: 'codex',
    event: 'UserPromptSubmit',
    input: '{}',
    root,
    execute(handler) {
      calls += 1;
      if (handler.name === 'turn-count.js') return { error: 'simulated failure', outputs: [] };
      return { outputs: [] };
    },
  });
  assert.equal(calls, 3);
  assert.match(result.systemMessage, /turn-count\.js failed open: simulated failure/u);
});

test('the lifecycle dispatcher hides only the Node 22 SQLite stability warning', () => {
  const warning = '(node:14537) ExperimentalWarning: SQLite is an experimental feature and might change at any time\n(Use `node --trace-warnings ...` to show where the warning was created)';
  assert.equal(actionableStderr(warning), '');
  assert.equal(actionableStderr(`${warning}\nreal diagnostic`), 'real diagnostic');
});

test('the lifecycle handler executor suppresses the SQLite warning but preserves diagnostics', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'lifecycle-handler-'));
  const hook = join(cwd, 'fixture.mjs');
  writeFileSync(hook, [
    "process.stderr.write('(node:14537) ExperimentalWarning: SQLite is an experimental feature and might change at any time\\n');",
    "process.stderr.write('(Use `node --trace-warnings ...` to show where the warning was created)\\n');",
    "process.stderr.write('real diagnostic\\n');",
    "process.stdout.write(JSON.stringify({ continue: true }));",
  ].join('\n'));
  try {
    assert.deepEqual(executeHandler({ path: hook, args: [] }, '{}', cwd), {
      stderr: 'real diagnostic',
      outputs: [{ continue: true }],
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('merged lifecycle output preserves messages and context', () => {
  const result = mergeOutputs('PostToolUse', [
    { systemMessage: 'first', hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'alpha' } },
    { systemMessage: 'second', hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'beta' } },
  ]);
  assert.equal(result.systemMessage, 'first · second');
  assert.equal(result.hookSpecificOutput.additionalContext, 'alpha\n\nbeta');
});

test('CLAUDE.md is the single effective import of AGENTS.md', () => {
  assert.equal(readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim(), '@AGENTS.md');
});

test('postinstall verifies the complete local installation', () => {
  assert.deepEqual(inspectInstallation(root), []);
  const result = spawnSync('node', [join(root, '.githooks/postinstall.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /open \/hooks and approve the nine workspace definitions/u);
});

test('postinstall diagnoses a missing CTXRoute installation', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'postinstall-missing-'));
  const result = spawnSync('node', [join(root, '.githooks/postinstall.mjs')], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CTXRoute 2\.0\.0 is not installed; run npm install/u);
});

test('postinstall detects legacy global CTXRoute hooks without changing them', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'global-ctxroute-hooks-'));
  const configPath = join(cwd, 'config.toml');
  writeFileSync(configPath, [
    '[[hooks.PreToolUse]]',
    'matcher = "*"',
    '[[hooks.PreToolUse.hooks]]',
    'type = "command"',
    'command = "node /opt/ctxroute/codex-doc-inject.js"',
    '[hooks.state]',
    'command = "node /opt/ctxroute/ignored-state.js"',
  ].join('\n'));
  assert.deepEqual(inspectGlobalCtxrouteHooks(configPath), [
    { event: 'PreToolUse', command: 'node /opt/ctxroute/codex-doc-inject.js' },
  ]);
});

test('both lifecycle dialects inject a matching project rule', () => {
  for (const harness of ['codex', 'claude']) {
    const session = `dispatcher-${harness}-${process.pid}-${Date.now()}`;
    const pseudoPatch = ['***', 'Update File: .project/project-config.json'].join(' ');
    const result = spawnSync('node', [join(root, '.codex/hooks/lifecycle.mjs'), harness, 'PreToolUse'], {
      cwd: root,
      input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'apply_patch', tool_input: { patch: pseudoPatch } }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Project governance/u, harness);
    assert.match(result.stdout, /architecture\.documents/u, harness);
    assert.doesNotMatch(result.stdout, /docs\/architecture\/src\/blueprint\.architecture\.json/u, harness);
  }
});

test('both host dispatchers report an unsafe file without hiding the completed write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lifecycle-post-tool-'));
  const path = join(directory, 'query.js');
  writeFileSync(path, "db.query('SELECT * FROM users WHERE id = ' + userId);\n");
  for (const harness of ['codex', 'claude']) {
    const result = spawnSync(process.execPath, [join(root, '.codex/hooks/lifecycle.mjs'), harness, 'PostToolUse'], {
      cwd: root,
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path } }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal('decision' in output, false, harness);
    assert.match(output.hookSpecificOutput.additionalContext, /sensor\/sql-injection/u, harness);
    assert.match(output.hookSpecificOutput.additionalContext, /already exists/u, harness);
  }
});

function run(script, input, options = {}) {
  return spawnSync('node', [join(root, script)], { cwd: options.cwd ?? root, input: JSON.stringify(input), encoding: 'utf8' });
}

function stopProcessTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-pid, 'SIGTERM'); }
  catch { try { process.kill(pid, 'SIGTERM'); } catch {} }
}

async function waitForPreviewStop(url) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const alive = await new Promise(resolveAlive => {
      const request = requestLoopback(url, response => { response.resume(); resolveAlive(true); });
      request.setTimeout(100, () => { request.destroy(); resolveAlive(false); });
      request.on('error', () => resolveAlive(false));
    });
    if (!alive) return true;
    await new Promise(resolveWait => { setTimeout(resolveWait, 50); });
  }
  return false;
}

test('PostToolUse audits a direct code path', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/main.ts' } });
  assert.equal(result.stdout, '');
});

test('PostToolUse also audits a root document', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Write', tool_input: { file_path: 'README.md' } });
  assert.equal(result.stdout, '');
});

test('PostToolUse audits instructions and hooks', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Write', tool_input: { file_path: '.codex/hooks.json' } });
  assert.equal(result.stdout, '');
});

test('PostToolUse reminds about documentation after a code change', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/engine.ts' } });
  assert.equal(result.stdout, '');
});

test('PostToolUse audits documents and Archify sources', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/runtime-loop.mmd' } });
  assert.equal(result.stdout, '');
});

test('Archify preview health checks accept only unauthenticated loopback HTTP URLs', async () => {
  const { normalizePreviewUrl, selectPreviewDiagram } = await import('../.codex/hooks/archify-preview.mjs');
  assert.equal(normalizePreviewUrl('http://127.0.0.1:4173/preview'), 'http://127.0.0.1:4173/preview');
  assert.equal(normalizePreviewUrl('http://localhost:4173/preview'), 'http://localhost:4173/preview');
  assert.equal(normalizePreviewUrl('https://127.0.0.1:4173/preview'), null);
  assert.equal(normalizePreviewUrl('http://example.test/preview'), null);
  assert.equal(normalizePreviewUrl('http://user:password@localhost:4173/preview'), null);
  const diagrams = [{ id: 'system.architecture', source: 'docs/architecture/src/system.architecture.json' }, { id: 'traffic.dataflow', source: 'docs/architecture/src/traffic.dataflow.json' }];
  assert.deepEqual(selectPreviewDiagram({ tool_input: { file_path: diagrams[1].source } }, diagrams), diagrams[1]);
  assert.equal(selectPreviewDiagram({ tool_input: { file_path: 'src/app.ts' } }, diagrams), null);
  assert.equal(selectPreviewDiagram({ tool_input: { file_path: 'src/app.ts' } }, [diagrams[0]]), null);
});

test('Archify preview hook stays quiet when the template has no product diagram', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'archify-preview-empty-'));
  mkdirSync(join(cwd, '.project'), { recursive: true });
  mkdirSync(join(cwd, 'docs/architecture/src'), { recursive: true });
  writeFileSync(join(cwd, '.project/project-config.json'), JSON.stringify({ architecture: { documents: [], internalDocuments: [] } }));
  const result = run('.codex/hooks/archify-preview.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } }, { cwd });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(readFileSync(join(root, '.codex/hooks/archify-preview.mjs'), 'utf8'), /'preview', diagram\.id, '--no-open'/u);
});

test('Archify preview hook serves a temporary product diagram over loopback', { skip: process.env.ARCHIFY_PREVIEW_E2E !== '1' }, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'archify-preview-product-'));
  const stateDirectory = join(cwd, '.ctxroute', 'state');
  let previewPid;
  let previewUrl;
  try {
    for (const directory of ['.githooks', '.project', '.agents/skills', 'docs/architecture/src', 'scripts']) mkdirSync(join(cwd, directory), { recursive: true });
    copyFileSync(join(root, '.githooks/archify'), join(cwd, '.githooks/archify'));
    copyFileSync(join(root, 'scripts/archify-registry.mjs'), join(cwd, 'scripts/archify-registry.mjs'));
    copyFileSync(join(root, '.project/archify-pin.json'), join(cwd, '.project/archify-pin.json'));
    copyFileSync(join(root, 'skills-lock.json'), join(cwd, 'skills-lock.json'));
    copyFileSync(join(root, '.agents/skills/archify/examples/web-app.architecture.json'), join(cwd, 'docs/architecture/src/demo.architecture.json'));
    symlinkSync(join(root, '.agents/skills/archify'), join(cwd, '.agents/skills/archify'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(cwd, '.project/project-config.json'), JSON.stringify({
      architecture: { documents: ['docs/architecture/src/demo.architecture.json'], internalDocuments: [] },
    }));

    const previewEnvironment = { ...process.env, CTXROUTE_STATE_DIR: stateDirectory };
    delete previewEnvironment.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, [join(root, '.codex/hooks/archify-preview.mjs')], {
      cwd,
      env: previewEnvironment,
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/src/demo.architecture.json' } }),
      encoding: 'utf8',
      timeout: 12_000,
    });
    assert.equal(result.status, 0, result.stderr);
    if (!result.stdout) {
      const diagnostics = readdirSync(stateDirectory).filter(path => path.endsWith('.log')).map(path => readFileSync(join(stateDirectory, path), 'utf8')).join('\n');
      assert.fail(`Archify preview produced no hook output. ${diagnostics}`);
    }
    const output = JSON.parse(result.stdout);
    previewUrl = output.hookSpecificOutput.additionalContext.match(/https?:\/\/\S+/u)?.[0];
    assert.ok(previewUrl);
    const status = await new Promise((resolveStatus, rejectStatus) => {
      const request = requestLoopback(previewUrl, response => { response.resume(); resolveStatus(response.statusCode); });
      request.on('error', rejectStatus);
    });
    assert.equal(status, 200);
    const statePath = readdirSync(stateDirectory).find(path => path.endsWith('.json'));
    assert.ok(statePath);
    previewPid = JSON.parse(readFileSync(join(stateDirectory, statePath), 'utf8')).pid;
  } finally {
    if (previewPid) stopProcessTree(previewPid);
    if (previewUrl) await waitForPreviewStop(previewUrl);
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('an active Stop hook does not loop', () => {
  const result = run('.codex/hooks/stop-review.mjs', { stop_hook_active: true });
  assert.match(result.stdout, /continue/u);
});

test('Stop mentions Archify only when a diagram source actually changed', () => {
  assert.equal(archifyInstruction(['scripts/new-feature.mjs'], []), '');
  assert.equal(archifyInstruction(['scripts/progress-core.mjs'], []), '');
  assert.match(archifyInstruction(['docs/architecture/src/traffic.dataflow.json'], [{ id: 'traffic', type: 'dataflow', source: 'docs/architecture/src/traffic.dataflow.json' }]), /dataflow \(traffic\)/u);
});

test('Stop manual policy pauses only for a decision or visual review and accepts a handoff', async () => {
  const cwd = progressWorkspace({ mode: 'manual', statuses: ['TODO'] });
  const first = await progressContinuation({}, { root: cwd, changed: [], diagrams: [] });
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /Pause manuelle/u);
  assert.match(first.reason, /décision importante/u);
  assert.doesNotMatch(first.reason, /\bgo\b/iu);
  assert.doesNotMatch(first.reason, /Archify/u);
  assert.ok(first.reason.length <= 1200);

  const accepted = await progressContinuation({ last_assistant_message: 'Décision requise pour step-1.' }, { root: cwd, changed: [], diagrams: [] });
  assert.equal(accepted, null);

  const visual = progressWorkspace({ mode: 'manual', manualReason: 'visual-review', statuses: ['TODO'] });
  const visualPause = await progressContinuation({}, { root: visual, changed: [], diagrams: [] });
  assert.match(visualPause.reason, /validation visuelle ciblée/u);
  assert.doesNotMatch(visualPause.reason, /\bgo\b/iu);
});

test('Stop does not attach an ambiguous old manual goal to unrelated work', async () => {
  const cwd = progressWorkspace({ mode: 'manual', statuses: ['TODO'] });
  const path = join(cwd, '.project/progress.json');
  const progress = JSON.parse(readFileSync(path, 'utf8'));
  progress.goals.push({
    id: 'goal-current-work', title: 'Current implementation', status: 'ACTIVE', executionMode: 'automatic', manualReason: null, modeOffered: false,
    steps: [{ id: 'step-1', title: 'Implement current surface', status: 'IN_PROGRESS', claimable: false, acceptance: ['verified'], files: [], commands: [], evidence: [] }],
  });
  writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`);
  assert.equal(await progressContinuation({}, { root: cwd, changed: [], diagrams: [] }), null);
  assert.equal(await progressContinuation({ last_assistant_message: 'Current implementation is complete.' }, { root: cwd, changed: [], diagrams: [] }), null);
});

test('Stop stays silent for automatic memory milestones', async () => {
  for (const status of ['TODO', 'IN_PROGRESS']) {
    const cwd = progressWorkspace({ mode: 'automatic', statuses: [status] });
    assert.equal(await progressContinuation({}, { root: cwd, changed: [], diagrams: [] }), null, status);
  }
});

test('Stop hands off only a qualified external block without a continuation loop', async () => {
  for (const mode of ['manual', 'automatic']) {
    const blocked = progressWorkspace({ mode, statuses: ['BLOCKED', 'BLOCKED'] });
    const path = join(blocked, '.project/progress.json');
    const progress = JSON.parse(readFileSync(path, 'utf8'));
    for (const step of progress.goals[0].steps) step.evidence = ['external: dependency unavailable'];
    writeFileSync(path, `${JSON.stringify(progress, null, 2)}\n`);
    const handoff = await progressContinuation({}, { root: blocked, changed: [], diagrams: [] });
    assert.equal(handoff.continue, true, mode);
    assert.match(handoff.systemMessage, /blocked externally/u, mode);
    assert.doesNotMatch(JSON.stringify(handoff), /"decision":"block"|mode automatique/u, mode);
  }

  const done = progressWorkspace({ mode: 'automatic', statuses: ['DONE'], goalStatus: 'DONE' });
  assert.equal(await progressContinuation({}, { root: done, changed: [], diagrams: [] }), null);
});

test('Stop stays silent for unqualified blocked memory', async () => {
  const blocked = progressWorkspace({ mode: 'automatic', statuses: ['BLOCKED'] });
  assert.equal(await progressContinuation({}, { root: blocked, changed: [], diagrams: [] }), null);
});

test('Stop does not run repository-wide validation on ordinary completion', () => {
  const cwd = starterWorkspace();
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'chore: fixture']);
  writeFileSync(join(cwd, 'change.json'), '{}\n');
  const result = run('.codex/hooks/stop-review.mjs', {}, { cwd });
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.equal(output.decision, undefined);
});

test('Stop keeps lightweight JSON checks advisory', () => {
  const cwd = starterWorkspace();
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'chore: fixture']);
  writeFileSync(join(cwd, 'change.json'), '{}\n');
  const result = run('.codex/hooks/stop-review.mjs', {}, { cwd });
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, true);
  assert.equal(output.decision, undefined);
});

test('Stop syntax review reports checked and deferred files under byte budgets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stop-syntax-budget-'));
  const first = join(directory, 'first.json');
  const second = join(directory, 'second.json');
  writeFileSync(first, '{}');
  writeFileSync(second, '{}');
  const result = checkSyntax([first, second], { maximumBytes: 2, maximumMs: 5_000 });
  assert.deepEqual(result.checked, [first]);
  assert.deepEqual(result.deferred, [second]);
  assert.deepEqual(result.failures, []);
});

test('commit-msg accepts Conventional Commits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  mkdirSync(join(directory, '.git'));
  const message = join(directory, '.git', 'COMMIT_EDITMSG');
  writeFileSync(message, 'feat(core): add deterministic loop\n');
  const result = spawnSync('node', [join(root, '.githooks/validate-commit-message.mjs'), message], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('configuration rejects a missing npm script', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.commands.test = 'npm run absent';
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync('node', [join(root, '.githooks/validate-project-config.mjs')], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not exist/u);
});

test('configuration rejects incomplete initialization', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.status = 'initialized';
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync('node', [join(root, '.githooks/validate-project-config.mjs')], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /decisions\.language/u);
  assert.match(result.stderr, /directories\.source/u);
});

test('configuration rejects a missing declared starter file', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.starter.rootFiles.push('MISSING-STARTER.md');
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync('node', [join(root, '.githooks/validate-project-config.mjs')], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing starter root file: MISSING-STARTER\.md/u);
});

test('configuration requires bounded documentation roots and extensions', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.documentation.extensions = ['md'];
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync(process.execPath, [join(root, '.githooks/validate-project-config.mjs')], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /documentation\.extensions/u);
});

test('documentation rejects a broken local link', () => {
  const cwd = starterWorkspace();
  writeFileSync(join(cwd, 'docs/broken.md'), '[Document](missing.md)\n');
  const result = spawnSync('node', [join(root, '.githooks/validate-docs.mjs'), '--all'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /local link not found/u);
});

test('documentation rejects guides after initialization', () => {
  const cwd = initializedWorkspace();
  writeFileSync(join(cwd, 'docs/brief.md'), 'Decision: to be defined\n');
  const result = spawnSync('node', [join(root, '.githooks/validate-docs.mjs'), '--all'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /guide or placeholder/u);
});

test('mutation configured for pre-commit is executed', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.commands.mutation = 'node -e "process.exit(7)"';
  config.quality.mutation.preCommit = true;
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync('node', [join(root, '.githooks/validate-push.mjs'), '--pre-commit'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 7);
});

test('disabled mutation remains skipped for trivial code', () => {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.commands.mutation = 'node -e "process.exit(7)"';
  writeFileSync(configPath, JSON.stringify(config));
  const result = spawnSync('node', [join(root, '.githooks/validate-push.mjs'), '--pre-commit'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('CTXRoute wiring validates and injects a matching project rule', () => {
  const before = readdirSync(isolatedCtxrouteState).sort();
  const validation = spawnSync('node', [join(root, '.githooks/validate-ctxroute.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);
  assert.deepEqual(readdirSync(isolatedCtxrouteState).sort(), before);

  const session = `test-${process.pid}-${Date.now()}`;
  const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '0'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'apply_patch', tool_input: { patch: '*** Update File: package.json' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Project governance/u);
  assert.doesNotMatch(result.stdout, /SEALED INJECTION|###END:/u);

  const repeated = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '0'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Read', tool_input: { file_path: 'package.json' } }),
    encoding: 'utf8',
  });
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /Project governance/u);
});

test('CTXRoute injects Progress guidance across significant repository roots', () => {
  for (const filePath of ['tests/example.test.mjs', '.githooks/example.mjs', 'docs/example.md', 'src/example.ts']) {
    const session = `progress-guidance-${filePath}-${process.pid}-${Date.now()}`;
    const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], {
      cwd: root,
      input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: filePath } }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent progress checklist/u, filePath);
  }
});

test('CTXRoute reinjects bounded context after PreCompact', () => {
  const session = `compact-${process.pid}-${Date.now()}`;
  const input = JSON.stringify({ session_id: session, cwd: root, tool_name: 'apply_patch', tool_input: { patch: '*** Update File: package.json' } });
  const inject = () => spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], { cwd: root, input, encoding: 'utf8' });
  const first = inject();
  assert.equal(first.status, 0, first.stderr);
  const firstContext = JSON.parse(first.stdout).hookSpecificOutput.additionalContext;
  assert.match(firstContext, /Project governance/u);
  assert.ok(firstContext.length <= 3500);
  const compact = spawnSync('node', [join(root, '.codex/hooks/lifecycle.mjs'), 'codex', 'PreCompact'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root }),
    encoding: 'utf8',
  });
  assert.equal(compact.status, 0, compact.stderr);
  const reinjected = inject();
  assert.equal(reinjected.status, 0, reinjected.stderr);
  const reinjectedContext = JSON.parse(reinjected.stdout).hookSpecificOutput.additionalContext;
  assert.ok(reinjectedContext.trim(), 'PreCompact must make bounded context eligible again');
  assert.ok(reinjectedContext.length <= 3500);
});

test('SessionEnd releases CTXRoute state for only that session', () => {
  const session = `ended-${process.pid}-${Date.now()}`;
  const input = JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: 'package.json' } });
  const inject = () => spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], { cwd: root, input, encoding: 'utf8' });
  assert.match(inject().stdout, /Project governance/u);
  assert.doesNotMatch(inject().stdout, /Project governance/u);
  const ended = spawnSync('node', [join(root, '.codex/hooks/lifecycle.mjs'), 'codex', 'SessionEnd'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root }),
    encoding: 'utf8',
  });
  assert.equal(ended.status, 0, ended.stderr);
  assert.match(inject().stdout, /Project governance/u);
});

test('CTXRoute injects UI contract guidance for conventional product UI paths', () => {
  const session = `ui-contract-${process.pid}-${Date.now()}`;
  const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: 'src/Button.tsx' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /UI design contract/u);
});

test('CTXRoute keeps core Sensor guidance stack-neutral', () => {
  const session = `sensor-adapters-${process.pid}-${Date.now()}`;
  const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: '.githooks/sensor-engine.mjs' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sensor adapter registry/u);
  assert.doesNotMatch(result.stdout, /tree-sitter-ruby|PHP Sensor adapter/u);
});

test('CTXRoute routes Sensor details only to their product language', () => {
  const cases = [
    ['src/model.rb', /Ruby Sensor adapter/u, /exact `tree-sitter-ruby` dependency/u, /PHP Sensor adapter/u],
    ['src/Controller.php', /PHP Sensor adapter/u, /explicitly lexical/u, /Ruby Sensor adapter/u],
  ];
  for (const [filePath, title, detail, unrelated] of cases) {
    const session = `sensor-language-${filePath}-${process.pid}-${Date.now()}`;
    const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], {
      cwd: root,
      input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: filePath } }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, title);
    assert.match(result.stdout, detail);
    assert.doesNotMatch(result.stdout, unrelated);
  }
});

test('package metadata does not inject unrelated Sensor ecosystems', () => {
  const session = `package-context-${process.pid}-${Date.now()}`;
  const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '3500'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'Edit', tool_input: { file_path: 'package.json' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Ruby Sensor adapter|PHP Sensor adapter|Sensor adapter registry/u);
});

test('CTXRoute wrapper directs missing installations to npm install', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ctxroute-wrapper-'));
  const hookDirectory = join(cwd, '.codex/hooks');
  mkdirSync(hookDirectory, { recursive: true });
  const hook = join(hookDirectory, 'ctxroute.mjs');
  copyFileSync(join(root, '.codex/hooks/ctxroute.mjs'), hook);
  const result = spawnSync('node', [hook, 'session-inject.js'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Run npm install/u);
});

test('setup prerequisite check is available before dependency installation', { skip: process.platform !== 'linux' }, () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'setup:check'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup prerequisites are available/u);
});

test('setup keeps Sensor pack synchronization quiet unless it fails', () => {
  const success = { logs: [], errors: [], exits: [] };
  runStep('Sensor sync', process.execPath, ['sensor:languages', 'sync'], {
    silent: true,
    spawn: (_command, _args, options) => {
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      return { status: 0, stdout: 'successful child output', stderr: '' };
    },
    log: value => success.logs.push(value),
    error: value => success.errors.push(value),
    terminate: code => success.exits.push(code),
  });
  assert.deepEqual(success, { logs: [], errors: [], exits: [] });

  const failure = { logs: [], errors: [], exits: [] };
  runStep('Sensor sync', process.execPath, ['sensor:languages', 'sync'], {
    silent: true,
    spawn: () => ({ status: 7, stdout: 'rollback complete', stderr: 'parser install failed' }),
    log: value => failure.logs.push(value),
    error: value => failure.errors.push(value),
    terminate: code => failure.exits.push(code),
  });
  assert.deepEqual(failure.logs, []);
  assert.deepEqual(failure.errors, ['rollback complete\nparser install failed', 'Sensor sync failed with status 7.']);
  assert.deepEqual(failure.exits, [7]);
});

function starterWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'starter-validation-'));
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  config.status = 'template';
  for (const key of Object.keys(config.decisions)) config.decisions[key] = null;
  config.directories.source = [];
  config.codeExtensions = [];
  config.quality.mutation.decision = null;
  for (const directory of [...config.starter.infrastructureRoots, '.project', 'docs/architecture/src']) mkdirSync(join(cwd, directory), { recursive: true });
  for (const file of config.starter.rootFiles) {
    if (file === 'package.json') continue;
    writeFileSync(join(cwd, file), file.endsWith('.json') ? '{}\n' : '');
  }
  writeFileSync(join(cwd, '.codex/architecture-policy.json'), JSON.stringify({ policyVersion: 1, projectConfig: '.project/project-config.json', supportedStatuses: ['template', 'initialized'] }));
  writeFileSync(join(cwd, '.project/project-config.json'), JSON.stringify(config));
  writeFileSync(join(cwd, 'docs/architecture/src/blueprint.architecture.json'), '{}\n');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ scripts: { test: 'node --test', 'validate:docs': 'node validate-docs.mjs', 'build:docs': 'node build' } }));
  return cwd;
}

function initializationWorkspace({ incomplete }) {
  const cwd = mkdtempSync(join(tmpdir(), 'initialize-'));
  mkdirSync(join(cwd, '.project'), { recursive: true });
  mkdirSync(join(cwd, 'docs'), { recursive: true });
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  config.status = 'template';
  writeFileSync(join(cwd, '.project/project-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(join(cwd, 'docs/00-project-brief.md'), incomplete ? '# Project brief\n\n[project name]\n' : '# Project brief\n\n[Reference](https://example.test)\n');
  writeFileSync(join(cwd, 'docs/01-technology-decisions.md'), '# Technology decisions\n\nComplete.\n');
  writeFileSync(join(cwd, 'docs/02-quality-strategy.md'), '# Quality strategy\n\nComplete.\n');
  writeFileSync(join(cwd, 'npm-cli.mjs'), 'process.exit(process.argv.slice(2).join(" ") === "run validate" ? 0 : 1);\n');
  return cwd;
}

function initializedWorkspace() {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.status = 'initialized';
  for (const key of Object.keys(config.decisions)) config.decisions[key] = key === 'language' ? 'JavaScript' : 'none';
  config.directories.source = ['src/'];
  config.codeExtensions = ['.js'];
  config.quality.mutation.decision = 'not-applicable';
  config.architecture.documents = ['docs/architecture/src/blueprint.architecture.json'];
  config.architecture.internalDocuments = [];
  writeFileSync(configPath, JSON.stringify(config));
  mkdirSync(join(cwd, 'src'));
  return cwd;
}

function progressHookWorkspace() { return mkdtempSync(join(tmpdir(), 'progress-hook-')); }

function progressPlan(count, overrides = {}) {
  return {
    goalId: 'goal-9',
    title: 'Automatic work',
    validationEvidence: ['node --test'],
    steps: Array.from({ length: count }, (_, index) => ({ id: `step-${index + 1}`, title: `Ticket ${index + 1}`, claimable: true, acceptance: ['verified'], files: ['src/app.js'], commands: ['node --test'] })),
    ...overrides,
  };
}

function progressWorkspace({ mode = 'automatic', manualReason = 'important-decision', statuses, goalStatus = statuses.every(status => status === 'DONE') ? 'DONE' : statuses.every(status => status === 'BLOCKED') ? 'BLOCKED' : 'ACTIVE' }) {
  const cwd = mkdtempSync(join(tmpdir(), 'stop-progress-'));
  mkdirSync(join(cwd, '.project'), { recursive: true });
  mkdirSync(join(cwd, 'docs'), { recursive: true });
  const steps = statuses.map((status, index) => ({
    id: `step-${index + 1}`,
    title: `Step ${index + 1}`,
    status,
    acceptance: ['Policy verified'],
    files: ['tests/hooks.test.mjs'],
    commands: ['npm test'],
    evidence: status === 'DONE' ? ['tests/hooks.test.mjs'] : [],
  }));
  writeFileSync(join(cwd, '.project/progress.json'), `${JSON.stringify({ schemaVersion: 1, goals: [{ id: 'goal-stop', title: 'Stop policy', status: goalStatus, executionMode: mode, manualReason: mode === 'manual' ? manualReason : null, modeOffered: false, steps }] }, null, 2)}\n`);
  return cwd;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
