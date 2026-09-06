import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOrchestratorConfig, safeRelativePath } from './orchestrator-core.mjs';

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function queryCtxroute({ paths, tool = 'Read', session_id: sessionId }, root = moduleRoot) {
  const config = await loadOrchestratorConfig(root);
  if (!Array.isArray(paths) || paths.length === 0 || paths.some(path => !safeRelativePath(path))) throw new Error('CTXRoute query requires repository-relative paths');
  const outputs = [];
  let usedBytes = 0;
  const session = sessionId || `query-${randomUUID()}`;
  for (const path of paths) {
    const result = spawnSync(process.execPath, [join(root, '.codex/hooks/ctxroute.mjs'), 'codex-doc-inject.js', '--budget', String(config.contextBytes)], {
      cwd: root,
      input: JSON.stringify({ session_id: session, cwd: root, tool_name: tool, tool_input: { file_path: path } }),
      encoding: 'utf8',
      timeout: config.subprocessTimeoutMs,
    });
    if (result.error || (result.status !== 0 && result.status !== null)) throw new Error(`CTXRoute query failed: ${result.error?.message ?? result.stderr.trim() ?? `exit ${result.status}`}`);
    const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : {};
    const context = parsed.hookSpecificOutput?.additionalContext ?? parsed.systemMessage ?? '';
    const remaining = config.contextBytes - usedBytes;
    if (remaining <= 0) break;
    const bounded = Buffer.from(String(context)).subarray(0, remaining).toString('utf8');
    usedBytes += Buffer.byteLength(bounded);
    if (bounded) outputs.push({ path, context: bounded });
  }
  return { session_id: session, bytes: usedBytes, references: outputs };
}
