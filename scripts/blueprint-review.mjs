import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { validateBlueprintSkills } from './validate-blueprint-skills.mjs';

export function reviewBlueprint(root = process.cwd()) {
  const errors = [...validateBlueprintSkills(root)];
  const runtimePaths = ['package.json', '.mcp.json', '.codex/config.toml', '.codex/hooks/lifecycle.mjs', '.codex/hooks/stop-review.mjs', 'scripts/integration-check.mjs', 'scripts/validate-mcp-installation.mjs'];
  for (const path of runtimePaths) {
    const source = readFileSync(`${root}/${path}`, 'utf8');
    if (/ctxroute-progress|progress:(?:mcp|approve|update|next|mode)/iu.test(source)) errors.push(`${path}: Progress remains in the execution path`);
  }
  const lifecycle = readFileSync(`${root}/.codex/hooks/lifecycle.mjs`, 'utf8');
  if (/PreToolUse:[^\n]*(?:doc-inject|session-inject)/u.test(lifecycle)) errors.push('PreToolUse must not perform automatic CTXRoute injection');
  const stop = readFileSync(`${root}/.codex/hooks/stop-review.mjs`, 'utf8');
  if (/decision:\s*['"]block/u.test(stop) || /progressContinuation/u.test(stop)) errors.push('Stop must be fail-open and must not continue orchestrated work');
  const changed = changedFiles(root);
  return {
    ok: errors.length === 0,
    changed_files: changed,
    errors: [...new Set(errors)],
    rollback: changed.length ? 'revert the reviewed commit or apply the orchestrator-recorded inverse patch' : 'not required',
  };
}

function changedFiles(root) {
  const paths = new Set();
  for (const args of [['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).forEach(path => paths.add(path));
  }
  return [...paths].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const report = reviewBlueprint();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
