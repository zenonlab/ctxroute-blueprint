import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatch, handlerPlan, lifecycleEvents, mergeOutputs } from '../.codex/hooks/lifecycle.mjs';
import { inspectGlobalCtxrouteHooks, inspectInstallation } from '../.githooks/postinstall.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Codex and Claude expose exactly one handler for the same six lifecycle events', () => {
  for (const [file, harness] of [['.codex/hooks.json', 'codex'], ['.claude/settings.json', 'claude']]) {
    const config = JSON.parse(readFileSync(join(root, file), 'utf8'));
    assert.deepEqual(Object.keys(config.hooks).sort(), [...lifecycleEvents].sort());
    for (const event of lifecycleEvents) {
      const handlers = config.hooks[event].flatMap(block => block.hooks ?? []);
      assert.equal(handlers.length, 1, `${file} ${event}`);
      assert.equal(handlers[0].command, `node ./.codex/hooks/lifecycle.mjs ${harness} ${event}`);
      assert.ok(handlers[0].timeout > 0, `${file} ${event} timeout`);
      assert.equal('statusMessage' in handlers[0], false, `${file} ${event} should remain quiet`);
    }
    assert.equal(config.hooks.PostToolUse[0].matcher, 'apply_patch|Edit|Write|exec_command|Bash|Shell');
  }
});

test('the lifecycle dispatcher declares every event and the required sequence', () => {
  const expected = {
    SessionStart: ['session-inject.js'],
    PreToolUse: ['pre-tool-architecture.mjs', 'codex-doc-inject.js'],
    PostToolUse: ['codex-doc-write-guard.js', 'post-tool-sensor.mjs', 'problem-memory.mjs', 'post-tool-audit.mjs'],
    UserPromptSubmit: ['turn-count.js', 'canary-check.js', 'problem-memory.mjs'],
    PreCompact: ['ctxroute-reset.js'],
    Stop: ['stop-review.mjs'],
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
  const codexInjection = handlerPlan('codex', 'PreToolUse', root)[1];
  assert.equal(codexInjection.path, join(root, 'node_modules', 'ctxroute', 'src', 'hooks', 'codex-doc-inject.js'));
  assert.notEqual(codexInjection.path, join(root, '.codex', 'hooks', 'ctxroute.mjs'));
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
    input: JSON.stringify({ tool_name: 'view_image', tool_input: { path: 'reference.png' } }),
    root,
    execute(handler) { called.push(handler.name); return { outputs: [] }; },
  });
  assert.deepEqual(called, ['codex-doc-inject.js']);
});

test('the lifecycle dispatcher delegates ADR context injection to CTXRoute', () => {
  const called = [];
  const result = dispatch({
    harness: 'codex',
    event: 'PreToolUse',
    input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'scripts/watch-crg.mjs' } }),
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
  assert.match(result.stdout, /open \/hooks and approve the six workspace definitions/u);
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
  }
});

function run(script, input, options = {}) {
  return spawnSync('node', [join(root, script)], { cwd: options.cwd ?? root, input: JSON.stringify(input), encoding: 'utf8' });
}

test('PostToolUse audits a direct code path', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/main.ts' } });
  assert.match(result.stdout, /src\/main\.ts/u);
});

test('PostToolUse also audits a root document', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Write', tool_input: { file_path: 'README.md' } });
  assert.match(result.stdout, /Documentation/u);
});

test('PostToolUse audits instructions and hooks', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Write', tool_input: { file_path: '.codex/hooks.json' } });
  assert.match(result.stdout, /Instructions\/hooks/u);
});

test('PostToolUse reminds about documentation after a code change', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'src/engine.ts' } });
  assert.match(result.stdout, /Read relevant documentation/u);
  assert.match(result.stdout, /Update documentation/u);
});

test('PostToolUse audits documents and Archify sources', () => {
  const result = run('.codex/hooks/post-tool-audit.mjs', { tool_name: 'Edit', tool_input: { file_path: 'docs/architecture/runtime-loop.mmd' } });
  assert.match(result.stdout, /Archify JSON IR/u);
});

test('an active Stop hook does not loop', () => {
  const result = run('.codex/hooks/stop-review.mjs', { stop_hook_active: true });
  assert.match(result.stdout, /continue/u);
});

test('Stop requires confirmation only for deletion, not verified commits', () => {
  const cwd = starterWorkspace();
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'chore: fixture']);
  writeFileSync(join(cwd, 'change.json'), '{}\n');
  const result = run('.codex/hooks/stop-review.mjs', {}, { cwd });
  assert.match(result.stdout, /request confirmation before deletion/u);
  assert.match(result.stdout, /commit verified work automatically without requesting confirmation/u);
  assert.doesNotMatch(result.stdout, /confirmation before deletion or commit/u);
});

test('Stop recognizes valid JSON', () => {
  const cwd = starterWorkspace();
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'chore: fixture']);
  writeFileSync(join(cwd, 'change.json'), '{}\n');
  const result = run('.codex/hooks/stop-review.mjs', {}, { cwd });
  assert.doesNotMatch(result.stdout, /Syntax failures/u);
  assert.match(result.stdout, /JSON, JavaScript, and supported shell syntax checked/u);
});

test('commit-msg accepts Conventional Commits', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hooks-test-'));
  const message = join(directory, 'message');
  writeFileSync(message, 'feat(core): add deterministic loop\n');
  const result = spawnSync('node', [join(root, '.githooks/validate-commit-message.mjs'), message], { encoding: 'utf8' });
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
  const validation = spawnSync('node', [join(root, '.githooks/validate-ctxroute.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr);

  const session = `test-${process.pid}-${Date.now()}`;
  const result = spawnSync('node', [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', '0'], {
    cwd: root,
    input: JSON.stringify({ session_id: session, cwd: root, tool_name: 'apply_patch', tool_input: { patch: '*** Update File: package.json' } }),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Project governance/u);
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

test('setup prerequisite check is available before dependency installation', () => {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'setup:check'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Setup prerequisites are available/u);
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

function initializedWorkspace() {
  const cwd = starterWorkspace();
  const configPath = join(cwd, '.project/project-config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.status = 'initialized';
  for (const key of Object.keys(config.decisions)) config.decisions[key] = key === 'language' ? 'JavaScript' : 'none';
  config.directories.source = ['src/'];
  config.codeExtensions = ['.js'];
  config.quality.mutation.decision = 'not-applicable';
  writeFileSync(configPath, JSON.stringify(config));
  mkdirSync(join(cwd, 'src'));
  return cwd;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
