import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_CONTEXT_LIMIT = 1200;
const DEFAULT_TIMEOUT_MS = 30_000;

function commandHook(config, event, lane) {
  const groups = config?.hooks?.[event] ?? [];
  const hooks = groups.flatMap(group => group.hooks ?? []);
  return hooks.find(hook => Boolean(hook.async) === (lane === 'maintenance'))
    ?? hooks.find(hook => !hook.async)
    ?? hooks[0];
}

function readConfig(root, harness) {
  const path = harness === 'claude' ? join(root, '.claude', 'settings.json') : join(root, '.codex', 'hooks.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function hookContract(harness, event, lane = 'synchronous', root = projectRoot) {
  const selected = commandHook(readConfig(root, harness), event, lane);
  // Codex declares the portable output envelope. Claude does not expose an
  // equivalent field, so both dispatchers deliberately use the same cap.
  const portable = commandHook(readConfig(root, 'codex'), event, lane);
  return {
    timeoutMs: Math.max(250, Number(selected?.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000),
    contextLimit: Number(portable?.additionalContextLimit ?? DEFAULT_CONTEXT_LIMIT),
  };
}

export function portableContextLimit(event, root = projectRoot) {
  return hookContract('codex', event, 'synchronous', root).contextLimit;
}

export function handlerContextBudget(event, root = projectRoot) {
  const hostLimit = portableContextLimit(event, root);
  // CTXRoute uses its budget to rank/pack documents before the dispatcher
  // enforces the final host envelope. PreToolUse needs a little selection
  // headroom; session context intentionally leaves room for Progress.
  return Math.max(256, Math.floor(hostLimit * (event === 'PreToolUse' ? 1.5 : 0.75)));
}
