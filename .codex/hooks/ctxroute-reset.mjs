import { readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIXES = Object.freeze(['doc-seen-', 'ctxroute-seen-', 'turn-count-', 'plan-', 'remainder-']);

export async function resetCtxrouteContext(rawInput, root = process.cwd(), environment = process.env) {
  let input;
  try { input = rawInput === String(rawInput) ? JSON.parse(rawInput || '{}') : rawInput; }
  catch { return null; }
  const session = sanitize(input?.session_id);
  if (!session) return null;
  const agent = sanitize(input?.agent_id);
  const scope = agent ? `${session}--agent-${agent}` : session;
  const directory = environment.CTXROUTE_STATE_DIR ?? resolve(root, '.ctxroute/state');
  const names = await readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
  const targets = names.filter(name => PREFIXES.some(prefix => name.startsWith(`${prefix}${scope}`)) && name.endsWith('.json'));
  await Promise.all(targets.map(name => unlink(join(directory, name)).catch(() => {})));
  return null;
}

function sanitize(value) {
  const normalized = String(value ?? '').replace(/[^A-Za-z0-9._-]/gu, '-').slice(0, 128);
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : '';
}

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await resetCtxrouteContext(await stdin());
