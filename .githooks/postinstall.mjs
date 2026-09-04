import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { lifecycleEvents } from '../.codex/hooks/lifecycle.mjs';

export { lifecycleEvents };

export function inspectInstallation(root = process.cwd()) {
  const failures = [];
  const installed = readJson(join(root, 'node_modules', 'ctxroute', 'package.json'), failures, 'CTXRoute package');
  if (installed?.version !== '2.0.0') failures.push('CTXRoute 2.0.0 is not installed; run npm install.');

  for (const name of [
    'session-inject.js',
    'codex-doc-inject.js',
    'doc-inject.js',
    'codex-doc-write-guard.js',
    'doc-write-guard.js',
    'turn-count.js',
    'canary-check.js',
    'ctxroute-reset.js',
  ]) {
    if (!existsSync(join(root, 'node_modules', 'ctxroute', 'src', 'hooks', name))) failures.push(`Installed CTXRoute hook is missing: ${name}`);
  }

  inspectHarness(root, '.codex/hooks.json', 'codex', failures);
  inspectHarness(root, '.claude/settings.json', 'claude', failures);
  inspectProgressWorkers(root, failures);

  try {
    if (readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim() !== '@AGENTS.md') failures.push('CLAUDE.md must contain only the native @AGENTS.md import.');
  } catch {
    failures.push('CLAUDE.md is missing.');
  }
  return failures;
}

export function inspectGlobalCtxrouteHooks(configPath = join(process.env.CODEX_HOME?.trim() || join(homedir(), '.codex'), 'config.toml')) {
  let source;
  try { source = readFileSync(configPath, 'utf8'); }
  catch { return []; }

  const hooks = [];
  let event = '';
  for (const line of source.split(/\r?\n/u)) {
    const header = line.match(/^\s*\[\[hooks\.([A-Za-z]+)\.hooks\]\]\s*$/u);
    if (header) {
      event = header[1];
      continue;
    }
    if (/^\s*\[/u.test(line)) event = '';
    const command = event && line.match(/^\s*command\s*=\s*["']([^"']*ctxroute[^"']*)["']\s*$/iu);
    if (command) hooks.push({ event, command: command[1] });
  }
  return hooks;
}

function inspectHarness(root, relativePath, harness, failures) {
  const config = readJson(join(root, relativePath), failures, relativePath);
  const actualEvents = Object.keys(config?.hooks ?? {});
  if (actualEvents.length !== lifecycleEvents.length || lifecycleEvents.some(event => !actualEvents.includes(event))) {
    failures.push(`${relativePath} must define exactly the nine supported lifecycle events.`);
  }
  for (const event of lifecycleEvents) {
    const entries = (config?.hooks?.[event] ?? []).flatMap(block => block.hooks ?? []);
    const expected = expectedHookCommand(harness, event);
    const expectedEntries = event === 'PostToolUse' ? 2 : 1;
    if (entries.length !== expectedEntries || entries[0]?.command !== expected) failures.push(`${relativePath} ${event} must contain the expected local lifecycle handlers.`);
    if (event === 'PostToolUse' && (entries[1]?.command !== expectedHookCommand(harness, event, 'maintenance') || entries[1]?.async !== true)) failures.push(`${relativePath} PostToolUse maintenance must run asynchronously.`);
    for (const entry of entries) {
      if (!Number.isFinite(entry?.timeout) || entry.timeout <= 0) failures.push(`${relativePath} ${event} must declare explicit positive timeouts.`);
      if ('statusMessage' in entry) failures.push(`${relativePath} ${event} must not declare a noisy statusMessage.`);
      if (harness === 'codex' && entry.commandWindows !== expectedWindowsHookCommand(event, entry.async ? 'maintenance' : '')) failures.push(`${relativePath} ${event} must resolve its Windows command from the Git root.`);
      const supportsContext = ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SubagentStart'].includes(event);
      if (harness === 'codex' && supportsContext && (!Number.isInteger(entry.additionalContextLimit) || entry.additionalContextLimit < 1 || entry.additionalContextLimit > 2500)) failures.push(`${relativePath} ${event} must declare a bounded supported context limit.`);
      if (harness === 'codex' && !supportsContext && 'additionalContextLimit' in entry) failures.push(`${relativePath} ${event} cannot declare additionalContextLimit.`);
    }
    if (harness === 'codex' && event === 'SessionEnd' && entries[0]?.timeout > 3) failures.push(`${relativePath} SessionEnd timeout cannot exceed Codex's three-second limit.`);
    if (event === 'PostToolUse' && config?.hooks?.[event]?.[0]?.matcher !== 'apply_patch|Edit|Write') {
      failures.push(`${relativePath} PostToolUse must target only structured editing tools.`);
    }
    if ((event === 'SubagentStart' || event === 'SubagentStop') && config?.hooks?.[event]?.[0]?.matcher !== '^progress[-_]worker$') failures.push(`${relativePath} ${event} must target only progress-worker.`);
  }
}

function expectedHookCommand(harness, event, lane = '') {
  const suffix = lane ? ` ${lane}` : '';
  return harness === 'codex'
    ? `node "$(git rev-parse --show-toplevel)/.codex/hooks/lifecycle.mjs" codex ${event}${suffix}`
    : `node "\${CLAUDE_PROJECT_DIR}/.codex/hooks/lifecycle.mjs" claude ${event}${suffix}`;
}

function expectedWindowsHookCommand(event, lane = '') {
  const suffix = lane ? ` ${lane}` : '';
  return `powershell.exe -NoProfile -Command "$root = git rev-parse --show-toplevel; node (Join-Path $root '.codex/hooks/lifecycle.mjs') codex ${event}${suffix}"`;
}

function inspectProgressWorkers(root, failures) {
  let codex = '';
  let claude = '';
  try { codex = readFileSync(join(root, '.codex/agents/progress-worker.toml'), 'utf8'); }
  catch { failures.push('Codex progress-worker definition is missing.'); }
  try { claude = readFileSync(join(root, '.claude/agents/progress-worker.md'), 'utf8'); }
  catch { failures.push('Claude progress-worker definition is missing.'); }
  for (const field of ['name', 'description', 'developer_instructions']) if (!new RegExp(`^${field}\\s*=`, 'mu').test(codex)) failures.push(`Codex progress-worker must define ${field}.`);
  if (!/^name:\s*progress-worker\s*$/mu.test(claude) || !/^description:\s*\S+/mu.test(claude)) failures.push('Claude progress-worker must define name and description frontmatter.');
  for (const source of [codex, claude]) if (!source.includes('PROGRESS_RESULT')) failures.push('Every progress-worker must document its final PROGRESS_RESULT footer.');
}

function readJson(path, failures, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { failures.push(`${label} is missing or invalid.`); return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const failures = inspectInstallation(resolve(process.cwd()));
  if (failures.length) {
    console.error([...new Set(failures)].join('\n'));
    process.exit(1);
  }
  console.log('CTXRoute and nine lifecycle hooks are installed and verified.');
  console.log('Codex local step: open /hooks and approve the nine workspace definitions.');
  const globalHooks = inspectGlobalCtxrouteHooks();
  if (globalHooks.length) {
    console.warn(`Warning: ${globalHooks.length} global CTXRoute hook(s) were found in Codex config. Local project hooks are valid, but the global definitions will run in addition and may cause duplicate output. Disable the legacy global definitions manually after approving this workspace.`);
  }
}
