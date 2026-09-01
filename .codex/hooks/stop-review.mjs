import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { loadProjectConfig } from '../../.githooks/project-policy.mjs';
import { markModeOffered, progressNext, readProgress } from '../../scripts/progress-core.mjs';

const input = JSON.parse(await stdin());
if (input.stop_hook_active) {
  process.stdout.write(JSON.stringify({ continue: true }));
  process.exit(0);
}

const changed = gitChangedFiles();
const candidates = changed.filter(path => /(?:^|\/)(?:tmp|temp|coverage|dist|build)(?:\/|$)|(?:\.tmp|\.bak|\.old|~)$/iu.test(path));
const syntaxFailures = checkSyntax(changed);
const validationFailures = runValidations();
const { failures: configFailures } = loadProjectConfig();
const lines = [
  syntaxFailures.length ? `Syntax failures: ${syntaxFailures.join(', ')}` : '',
  validationFailures.length ? `Validation failures: ${validationFailures.join(' | ')}` : '',
  candidates.length ? `Review cleanup candidates: ${candidates.join(', ')}` : '',
  configFailures.length ? `Configuration failures: ${configFailures.join(', ')}` : '',
].filter(Boolean);
if (lines.length) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: lines.join('\n').slice(0, 2000) }));
  process.exit(0);
}

const continuation = await progressContinuation();
process.stdout.write(JSON.stringify(continuation ?? { continue: true }));

async function progressContinuation() {
  try {
    const progress = await readProgress(process.cwd());
    const goal = progress.goals.find(item => item.status !== 'DONE');
    if (!goal) return null;
    const next = progressNext(progress, goal.id);
    if (next.complete) return null;
    const labels = next.next.map(step => `${step.stepId}: ${step.title} [${step.status}]`).join('\n');
    if (next.mode === 'autonomous') {
      if (next.next.every(step => step.status === 'BLOCKED')) return { continue: true, systemMessage: `Goal ${goal.id} is blocked externally. Handoff:\n${labels}` };
      return { decision: 'block', reason: `Continue ce goal en mode automatique. Cherche toi-même la solution, exécute les étapes restantes, vérifie tous les critères et ne termine qu’avec des preuves complètes.\n${labels}`.slice(0, 1200) };
    }
    if (next.next.length === 0) return null;
    let message = `Handoff — prochaines étapes pour ${goal.id}:\n${labels}`;
    if (!goal.modeOffered) {
      await markModeOffered(goal.id, process.cwd());
      message += '\nJe peux passer ce goal en mode automatique : j’enchaînerai toutes les étapes, chercherai moi-même les solutions et ne reviendrai qu’après vérification complète ou blocage externe réel.';
    }
    return { decision: 'block', reason: message.slice(0, 1200) };
  } catch (error) {
    return { systemMessage: `Progress handoff unavailable: ${String(error.message).slice(0, 240)}` };
  }
}

function gitChangedFiles() {
  const files = new Set();
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    try {
      const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      output.split('\0').filter(Boolean).forEach(path => files.add(path));
    } catch {}
  }
  return [...files].sort();
}

function checkSyntax(paths) {
  const failures = [];
  for (const path of paths.filter(existsSync)) {
    try {
      if (/\.(?:js|mjs|cjs)$/iu.test(path)) execFileSync('node', ['--check', path], { stdio: 'pipe' });
      else if (/\.json$/iu.test(path)) JSON.parse(readFileSync(path, 'utf8'));
      else if (process.platform !== 'win32' && (/\.sh$|^\.githooks\/(?:pre-commit|pre-push|commit-msg)$/u.test(path))) execFileSync('sh', ['-n', path], { stdio: 'pipe' });
    } catch {
      failures.push(path);
    }
  }
  return failures;
}

function runValidations() {
  const failures = [];
  for (const [name, args] of [
    ['configuration', ['.githooks/validate-project-config.mjs']],
    ['CTXRoute', ['.githooks/validate-ctxroute.mjs']],
    ['architecture', ['.githooks/validate-architecture.mjs', '--all']],
    ['documentation', ['.githooks/validate-docs.mjs', '--all']],
  ]) {
    try { execFileSync('node', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) {
      const detail = String(error.stderr ?? '').trim().split(/\r?\n/u)[0];
      failures.push(`${name}${detail ? ` (${detail})` : ''}`);
    }
  }
  return failures;
}

function stdin() {
  return new Promise(resolveInput => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => resolveInput(value || '{}'));
  });
}
