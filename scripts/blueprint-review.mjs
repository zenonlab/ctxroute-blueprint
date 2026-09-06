import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trackedControlFiles } from './blueprint-sync.mjs';
import { validateBlueprintSkills } from './validate-blueprint-skills.mjs';

export const REQUIRED_SKILL_RUNTIME = Object.freeze([
  'scripts/blueprint-review.mjs',
  'scripts/session-audit.mjs',
  'scripts/validate-blueprint-skills.mjs',
  'scripts/verify-blueprint-skills.mjs',
  '.agents/skills/blueprint-audit/SKILL.md',
  '.agents/skills/blueprint-audit/blueprint.json',
  '.agents/skills/session-auditor/SKILL.md',
  '.agents/skills/session-auditor/blueprint.json',
  '.agents/skills/skill-creator/SKILL.md',
  '.agents/skills/skill-creator/blueprint.json',
]);

export function reviewBlueprint(root = process.cwd()) {
  const errors = [...validateBlueprintSkills(root)];
  errors.push(...validateRuntimeAllowlist(root));
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

export function validateRuntimeAllowlist(root = process.cwd()) {
  const selected = new Set(trackedControlFiles(root));
  const errors = REQUIRED_SKILL_RUNTIME.filter(file => !selected.has(file)).map(file => `blueprint runtime allowlist omits ${file}`);
  for (const file of selected) {
    if (!/\.(?:[cm]?js)$/iu.test(file)) continue;
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/gu)) {
      const dependency = resolveLocalDependency(root, file, match[1]);
      if (dependency && !selected.has(dependency)) errors.push(`blueprint runtime allowlist omits transitive dependency ${dependency} imported by ${file}`);
    }
  }
  return [...new Set(errors)];
}

function resolveLocalDependency(root, importer, specifier) {
  const candidate = resolve(dirname(resolve(root, importer)), specifier);
  for (const path of [candidate, `${candidate}.mjs`, `${candidate}.js`, `${candidate}.cjs`, `${candidate}.json`, resolve(candidate, 'index.mjs'), resolve(candidate, 'index.js')]) {
    if (existsSync(path)) return relative(root, path).replaceAll('\\', '/');
  }
  return null;
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
