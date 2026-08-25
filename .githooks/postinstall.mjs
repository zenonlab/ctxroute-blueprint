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
    failures.push(`${relativePath} must define exactly the six supported lifecycle events.`);
  }
  for (const event of lifecycleEvents) {
    const entries = (config?.hooks?.[event] ?? []).flatMap(block => block.hooks ?? []);
    const expected = `node ./.codex/hooks/lifecycle.mjs ${harness} ${event}`;
    if (entries.length !== 1 || entries[0]?.command !== expected) failures.push(`${relativePath} ${event} must contain exactly one local lifecycle handler.`);
    if (!Number.isFinite(entries[0]?.timeout) || entries[0].timeout <= 0) failures.push(`${relativePath} ${event} must declare an explicit positive timeout.`);
    if ('statusMessage' in (entries[0] ?? {})) failures.push(`${relativePath} ${event} must not declare a noisy statusMessage.`);
    if (event === 'PostToolUse' && config?.hooks?.[event]?.[0]?.matcher !== 'apply_patch|Edit|Write|exec_command|Bash|Shell') {
      failures.push(`${relativePath} PostToolUse must target only mutation-capable tools.`);
    }
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
  console.log('CTXRoute and six lifecycle hooks are installed and verified.');
  console.log('Codex local step: open /hooks and approve the six workspace definitions.');
  const globalHooks = inspectGlobalCtxrouteHooks();
  if (globalHooks.length) {
    console.warn(`Warning: ${globalHooks.length} global CTXRoute hook(s) were found in Codex config. Disable the legacy global definitions after approving this workspace to avoid duplicate runs and latency.`);
  }
}
