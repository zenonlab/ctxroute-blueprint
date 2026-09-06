import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadProjectConfig } from '../../.githooks/project-policy.mjs';

export function stopReview(input = {}, root = process.cwd()) {
  if (input.stop_hook_active) return { continue: true };
  const changed = gitChangedFiles(root);
  const syntaxFailures = checkSyntax(changed, root);
  const validationFailures = runValidations(root);
  const { failures: configFailures } = loadProjectConfig(root);
  const diagnostics = [
    syntaxFailures.length ? `Syntax failures: ${syntaxFailures.join(', ')}` : '',
    validationFailures.length ? `Validation failures: ${validationFailures.join(' | ')}` : '',
    configFailures.length ? `Configuration failures: ${configFailures.join(', ')}` : '',
  ].filter(Boolean);
  return diagnostics.length
    ? { continue: true, systemMessage: `Stop review failed open; no task was rescheduled. ${diagnostics.join('\n').slice(0, 1800)}` }
    : { continue: true };
}

function gitChangedFiles(root) {
  const files = new Set();
  for (const args of [['diff', '--name-only', '-z'], ['diff', '--cached', '--name-only', '-z'], ['ls-files', '--others', '--exclude-standard', '-z']]) {
    try { execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).forEach(path => files.add(path)); } catch {}
  }
  return [...files].sort();
}

function checkSyntax(paths, root) {
  const failures = [];
  for (const path of paths.filter(path => existsSync(`${root}/${path}`))) {
    try {
      if (/\.(?:js|mjs|cjs)$/iu.test(path)) execFileSync(process.execPath, ['--check', path], { cwd: root, stdio: 'pipe' });
      else if (/\.json$/iu.test(path)) JSON.parse(readFileSync(`${root}/${path}`, 'utf8'));
      else if (process.platform !== 'win32' && (path.endsWith('.sh') || /^\.githooks\/(?:pre-commit|pre-push|commit-msg)$/u.test(path))) execFileSync('sh', ['-n', path], { cwd: root, stdio: 'pipe' });
    } catch { failures.push(path); }
  }
  return failures;
}

function runValidations(root) {
  const failures = [];
  for (const [name, args] of [
    ['configuration', ['.githooks/validate-project-config.mjs']],
    ['CTXRoute', ['.githooks/validate-ctxroute.mjs']],
    ['documentation', ['.githooks/validate-docs.mjs', '--all']],
    ['blueprint review', ['scripts/blueprint-review.mjs']],
  ]) {
    try { execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) { failures.push(`${name}: ${String(error.stderr ?? '').trim().split(/\r?\n/u)[0] || 'failed'}`); }
  }
  return failures;
}

async function stdin() {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) value += chunk;
  return value || '{}';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let input = {};
  try { input = JSON.parse(await stdin()); } catch {}
  process.stdout.write(JSON.stringify(stopReview(input)));
}
