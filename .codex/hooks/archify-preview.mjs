import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { get as requestLoopback } from 'node:http';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { selectArchifyDiagrams } from '../../scripts/archify-registry.mjs';

const root = resolve(process.cwd());
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = await readInput();
  if (input && isRelevantMutation(input)) {
    const preview = await ensurePreview(input);
    if (preview) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Archify preview disponible : ${preview.url}`,
        },
      }));
    }
  }
}

async function ensurePreview(input) {
  const stateDirectory = resolve(process.env.CTXROUTE_STATE_DIR ?? join(root, '.ctxroute', 'state'));
  const diagram = selectPreviewDiagram(input, selectArchifyDiagrams('all', root));
  if (!diagram) return null;
  const source = diagram.source;
  const statePath = join(stateDirectory, `archify-preview-${diagram.id}.json`);
  mkdirSync(stateDirectory, { recursive: true });
  const existing = readJson(statePath);
  if (existing?.source === source && existing?.pid && existing?.url && processAlive(existing.pid) && await isHealthy(existing.url)) return existing;

  const logPath = join(stateDirectory, `archify-preview-${diagram.id}.log`);
  const log = openSync(logPath, 'a');
  const child = spawn(process.execPath, ['.githooks/archify', 'preview', diagram.id, '--no-open'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, CTXROUTE_STATE_DIR: stateDirectory },
  });
  child.unref();

  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const url = previewUrl(logPath);
    if (url && await isHealthy(url)) {
      const next = { pid: child.pid, url, root, source, startedAt: new Date().toISOString() };
      writeFileSync(statePath, `${JSON.stringify(next)}\n`);
      return next;
    }
    await wait(100);
  }
  appendFileSync(logPath, `\nArchify preview hook timeout for pid ${child.pid}.\n`);
  return null;
}

export function selectPreviewDiagram(input, diagrams) {
  if (!Array.isArray(diagrams) || diagrams.length === 0) return null;
  const mutation = JSON.stringify(input?.tool_input ?? {});
  const matching = diagrams.filter(diagram => mutation.includes(diagram.source) || mutation.includes(diagram.id));
  if (matching.length === 1) return matching[0];
  return null;
}

function isRelevantMutation(value) {
  const tool = String(value.tool_name ?? '');
  if (/^(?:apply_patch|Edit|Write)$/iu.test(tool)) return true;
  if (!/^(?:exec_command|Bash|Shell)$/iu.test(tool)) return false;
  const command = String(value.tool_input?.cmd ?? value.tool_input?.command ?? '');
  return /(?:>>?|<<|\b(?:tee|touch|mkdir|cp|mv|rm|unlink|install|apply_patch)\b|\b(?:sed|perl)\s+-i\b|\bgit\s+(?:apply|checkout|restore)\b)/iu.test(command);
}

function previewUrl(logPath) {
  const text = readFileSync(logPath, 'utf8');
  return normalizePreviewUrl(text.match(/\bpreview\s+(https?:\/\/[^\s\r\n]+)/iu)?.[1]);
}

export function normalizePreviewUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (url.protocol !== 'http:' || !loopbackHosts.has(url.hostname) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function isHealthy(url) {
  return new Promise(resolveHealth => {
    const request = requestLoopback(url, response => {
      response.resume();
      resolveHealth(response.statusCode === 200);
    });
    request.setTimeout(500, () => { request.destroy(); resolveHealth(false); });
    request.on('error', () => resolveHealth(false));
  });
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function wait(milliseconds) { return new Promise(resolveWait => { setTimeout(resolveWait, milliseconds); }); }
async function readInput() { let value = ''; for await (const chunk of process.stdin) value += chunk; try { return JSON.parse(value || '{}'); } catch { return null; } }
