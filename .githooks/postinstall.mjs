import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { declaredMaintenanceEntries } from '../.codex/hooks/lifecycle-contract.mjs';
import { handlerPlan, lifecycleEvents } from '../.codex/hooks/lifecycle.mjs';

export { lifecycleEvents };

export function inspectInstallation(root = process.cwd()) {
  const failures = [];
  const installed = readJson(join(root, 'node_modules', 'ctxroute', 'package.json'), failures, 'CTXRoute package');
  if (installed?.version !== '2.0.0') failures.push('CTXRoute 2.0.0 is not installed; run npm install.');

  for (const name of [
    'codex-doc-inject.js',
    'doc-inject.js',
    'ctxroute-reset.js',
  ]) {
    if (!existsSync(join(root, 'node_modules', 'ctxroute', 'src', 'hooks', name))) failures.push(`Installed CTXRoute hook is missing: ${name}`);
  }

  failures.push(...inspectHookConfiguration(root));

  try {
    if (readFileSync(join(root, 'CLAUDE.md'), 'utf8').trim() !== '@AGENTS.md') failures.push('CLAUDE.md must contain only the native @AGENTS.md import.');
  } catch {
    failures.push('CLAUDE.md is missing.');
  }
  return failures;
}

export function inspectHookConfiguration(root = process.cwd()) {
  const failures = [];
  const codex = inspectHarness(root, '.codex/hooks.json', 'codex', failures);
  const claude = inspectHarness(root, '.claude/settings.json', 'claude', failures);
  inspectHarnessParity(codex, claude, failures);
  if (codex && claude) inspectMaintenanceCoverage(root, failures);
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
  if (!config) return null;
  if (harness === 'codex' && JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(['description', 'hooks'])) {
    failures.push(`${relativePath} must contain only Codex-supported top-level fields: description and hooks.`);
  }
  const actualEvents = Object.keys(config?.hooks ?? {});
  if (actualEvents.length !== lifecycleEvents.length || lifecycleEvents.some(event => !actualEvents.includes(event))) {
    failures.push(`${relativePath} must define exactly the six supported lifecycle events.`);
  }
  for (const event of lifecycleEvents) {
    const groups = config?.hooks?.[event] ?? [];
    const entries = groups.flatMap(block => block.hooks ?? []);
    const expected = `node ./.codex/hooks/lifecycle.mjs ${harness} ${event}`;
    const expectedCount = ['PostToolUse', 'UserPromptSubmit'].includes(event) ? 2 : 1;
    const expectedTimeouts = {
      codex: { SessionStart: [30], PreToolUse: [45], PostToolUse: [45, 30], UserPromptSubmit: [30, 10], PreCompact: [15], Stop: [120] },
      claude: { SessionStart: [30], PreToolUse: [45], PostToolUse: [45, 30], UserPromptSubmit: [30, 10], PreCompact: [15], Stop: [30] },
    };
    const expectedMatchers = {
      codex: { PreToolUse: '*', PostToolUse: 'apply_patch|Edit|Write|exec_command|Bash|Shell' },
      claude: { PreToolUse: 'apply_patch|apply_refactor_tool|Edit|Write|exec_command|Bash|Shell', PostToolUse: 'apply_patch|Edit|Write|exec_command|Bash|Shell' },
    };
    const matcher = groups[0]?.matcher;
    const expectedMatcher = expectedMatchers[harness][event];
    if (groups.length !== 1 || matcher !== expectedMatcher) failures.push(`${relativePath} ${event} has an invalid matcher declaration.`);
    if (entries.length !== expectedCount || entries[0]?.command !== expected) failures.push(`${relativePath} ${event} has an invalid synchronous lifecycle handler.`);
    if (expectedCount === 2 && (entries[1]?.command !== `${expected} maintenance` || entries[1]?.async !== true)) failures.push(`${relativePath} ${event} has an invalid maintenance lifecycle handler.`);
    if (entries.some(entry => entry.type !== 'command')) failures.push(`${relativePath} ${event} supports command handlers only.`);
    if (JSON.stringify(entries.map(entry => entry.timeout)) !== JSON.stringify(expectedTimeouts[harness][event])) failures.push(`${relativePath} ${event} timeouts differ from the intentional host contract.`);
    if (!Number.isFinite(entries[0]?.timeout) || entries[0].timeout <= 0) failures.push(`${relativePath} ${event} must declare an explicit positive timeout.`);
    if ('statusMessage' in (entries[0] ?? {})) failures.push(`${relativePath} ${event} must not declare a noisy statusMessage.`);
    if (entries.some(entry => !Number.isFinite(entry.timeout) || entry.timeout <= 0)) failures.push(`${relativePath} ${event} handlers must declare explicit positive timeouts.`);
    if (harness === 'codex') {
      const supportsContext = !['PreCompact', 'Stop'].includes(event);
      if (supportsContext && entries[0]?.additionalContextLimit !== 1200) failures.push(`${relativePath} ${event} synchronous context limit must be 1200.`);
      if (!supportsContext && 'additionalContextLimit' in (entries[0] ?? {})) failures.push(`${relativePath} ${event} must not declare an unsupported synchronous context limit.`);
      if (entries.slice(1).some(entry => entry.additionalContextLimit !== 0)) failures.push(`${relativePath} ${event} maintenance context limit must be 0.`);
    }
  }
  return config;
}

function inspectHarnessParity(codex, claude, failures) {
  if (!codex || !claude) return;
  for (const event of lifecycleEvents) {
    const codexEntries = codex.hooks[event].flatMap(group => group.hooks ?? []);
    const claudeEntries = claude.hooks[event].flatMap(group => group.hooks ?? []);
    const codexLaneContract = codexEntries.map(entry => ({ type: entry.type, async: entry.async === true }));
    const claudeLaneContract = claudeEntries.map(entry => ({ type: entry.type, async: entry.async === true }));
    if (JSON.stringify(codexLaneContract) !== JSON.stringify(claudeLaneContract)) failures.push(`Codex and Claude ${event} lane contracts must remain identical.`);
  }
}

function inspectMaintenanceCoverage(root, failures) {
  const entries = declaredMaintenanceEntries(root);
  const keys = new Set();
  for (const entry of entries) {
    const key = `${entry.harness}:${entry.event}`;
    if (keys.has(key)) failures.push(`Duplicate async maintenance entry: ${key}.`);
    keys.add(key);
    if (!handlerPlan(entry.harness, entry.event, root, 'maintenance').length) failures.push(`Async maintenance entry has no benchmarkable handler plan: ${key}.`);
    if (entry.command !== `node ./.codex/hooks/lifecycle.mjs ${entry.harness} ${entry.event} maintenance`) failures.push(`Async maintenance entry has an unbenchmarkable command: ${key}.`);
  }
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
  console.log('CTXRoute on-demand context and six minimal lifecycle hooks are installed and verified.');
  console.log('Codex local step: open /hooks and approve the six workspace definitions.');
  const globalHooks = inspectGlobalCtxrouteHooks();
  if (globalHooks.length) {
    console.warn(`Warning: ${globalHooks.length} global CTXRoute hook(s) were found in Codex config. Local project hooks are valid, but the global definitions will run in addition and may cause duplicate output. Disable the legacy global definitions manually after approving this workspace.`);
  }
}
