import { extractPathEntries } from './path-extraction.mjs';
import { analyzePaths, isSupportedSourcePath } from '../../.githooks/sensor-engine.mjs';
import process from 'node:process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeStateDirectory } from '../../scripts/safe-state-directory.mjs';

export function postToolSensor(rawInput, options = {}) {
  const root = options.root ?? process.cwd();
  let input;
  try { input = rawInput === String(rawInput) ? JSON.parse(rawInput || '{}') : rawInput; }
  catch (error) { return { systemMessage: `PostToolUse Sensor failed open: invalid JSON input (${error.message})` }; }
  const deletion = /\b(?:delete|remove|unlink)\b/iu.test(String(input.tool_name ?? ''));
  const entries = extractPathEntries(input.tool_input ?? input);
  const supported = entries
    .filter(({ path, key }) => isSupportedSourcePath(path) && key !== 'old_path')
    .filter(({ path }) => path !== '.project/sensor-rules.json')
    .filter(({ path }) => !deletion || existsSync(resolve(root, path)))
    .map(({ path }) => path);
  if (supported.length) {
    const result = analyzePaths(supported, { root });
    if (result.verdict !== 'SAFE') {
      const details = result.diagnostics.slice(0, 5).map(item => `${item.path}:${item.line} ${item.rule}`).join(', ');
      if (result.verdict === 'WARN') {
        if (firstWarning(input, result, options)) {
          const message = `Sensor WARN: ${result.diagnostics.length} diagnostic(s)${details ? ` — ${details}` : ''}. Review when relevant.`;
          return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message.slice(0, 300) } };
        }
      } else {
        const summary = JSON.stringify({ verdict: result.verdict, coverage: result.coverage, diagnostics: result.diagnostics.slice(0, 5) });
        const message = `Sensor ${result.verdict}: ${result.diagnostics.length} diagnostic(s)${details ? ` — ${details}` : ''}. The change already exists: inspect and repair the current file; do not replay the patch.\n${summary}`;
        return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message.slice(0, 1800) } };
      }
    }
  }
  return null;
}

function firstWarning(input, result, options) {
  const identity = JSON.stringify({ session: input.session_id ?? 'session', findings: result.diagnostics.map(item => [item.path, item.rule, item.line]) });
  const key = createHash('sha256').update(identity).digest('hex');
  const directory = safeStateDirectory(options.stateDirectory ?? process.env.CTXROUTE_STATE_DIR ?? resolve(options.root ?? process.cwd(), '.ctxroute/state'), options.root ?? process.cwd());
  const marker = join(directory, `sensor-warn-${key}`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(marker, '', { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    return error.code !== 'EEXIST';
  }
}

function stdin() { return new Promise(resolve => { let value = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { value += chunk; }); process.stdin.on('end', () => resolve(value || '{}')); }); }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = postToolSensor(await stdin());
  if (output) process.stdout.write(JSON.stringify(output));
}
