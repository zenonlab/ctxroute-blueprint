import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadProjectConfig } from '../../.githooks/project-policy.mjs';
import { listArchifyDiagrams } from '../../scripts/archify-registry.mjs';
import { progressNext, readProgress } from '../../scripts/progress-core.mjs';
import { hasNextStepHandoff, isExternallyBlocked, isFullyBlocked, selectProgressGoal } from '../../scripts/progress-handoff.mjs';

async function main() {
  const input = JSON.parse(await stdin());
  if (input.stop_hook_active) {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const changed = gitChangedFiles();
  const candidates = changed.filter(path => /(?:^|\/)(?:tmp|temp|coverage|dist|build)(?:\/|$)|(?:\.tmp|\.bak|\.old|~)$/iu.test(path));
  const syntaxFailures = checkSyntax(changed);
  const { failures: configFailures } = loadProjectConfig();
  const lines = [
    syntaxFailures.length ? `Syntax failures: ${syntaxFailures.join(', ')}` : '',
    candidates.length ? `Review cleanup candidates: ${candidates.join(', ')}` : '',
    configFailures.length ? `Configuration failures: ${configFailures.join(', ')}` : '',
  ].filter(Boolean);
  const continuation = await progressContinuation(input, { changed });
  const review = lines.join('\n').slice(0, 1200);
  if (continuation?.decision === 'block') {
    if (review) continuation.reason = `${review}\n${continuation.reason}`.slice(0, 1200);
    process.stdout.write(JSON.stringify(continuation));
    return;
  }
  const systemMessage = [review, continuation?.systemMessage].filter(Boolean).join('\n').slice(0, 1200);
  process.stdout.write(JSON.stringify(systemMessage ? { continue: true, systemMessage } : { continue: true }));
}

export async function progressContinuation(hookInput, options = {}) {
  const root = options.root ?? process.cwd();
  const changed = options.changed ?? gitChangedFiles(root);
  try {
    const diagrams = options.diagrams ?? listArchifyDiagrams(root).filter(diagram => diagram.audience === 'product');
    const progress = await readProgress(root);
    const goal = selectProgressGoal(progress, hookInput.last_assistant_message);
    if (!goal) return null;
    const next = progressNext(progress, goal.id);
    if (next.complete) return null;
    const labels = [...next.next, ...(next.blocked ?? [])].map(step => `${step.stepId}: ${step.title} [${step.status}]`).join('\n');
    const archify = archifyInstruction(changed, diagrams);
    if (isExternallyBlocked(goal)) {
      return { continue: true, systemMessage: [`Goal ${goal.id} is blocked externally. Handoff:\n${labels}`, archify].filter(Boolean).join('\n').slice(0, 1200) };
    }
    if (isFullyBlocked(goal) || next.mode === 'automatic') return null;
    if (next.next.length === 0) return null;
    const handoffPresent = hasNextStepHandoff(hookInput.last_assistant_message, next.next);
    if (handoffPresent) return null;
    const request = goal.manualReason === 'visual-review'
      ? 'validation visuelle ciblée requise; présentez l’artefact et le verdict attendu'
      : 'décision importante requise; présentez les options, leurs compromis et la question non résolue';
    let message = `Pause manuelle — ${request} pour ${goal.id}:\n${labels}`;
    if (archify) message += `\n${archify}`;
    return { decision: 'block', reason: message.slice(0, 1200) };
  } catch (error) {
    return { systemMessage: `Progress handoff unavailable: ${String(error.message).slice(0, 240)}` };
  }
}

export function archifyInstruction(changed, diagrams = listArchifyDiagrams(process.cwd()).filter(diagram => diagram.audience === 'product')) {
  const source = changed.find(path => path.startsWith('docs/architecture/src/') && path.endsWith('.json'));
  const selected = source ? diagrams.find(diagram => diagram.source === source) : null;
  if (selected) return `${selected.type} (${selected.id}) — vérifier avec npm run archify:validate -- ${selected.id}`;
  if (source) return `source Archify ${source} — vérifier le registre et lancer npm run archify:validate`;
  return '';
}

function gitChangedFiles(root = process.cwd()) {
  const files = new Set();
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['diff', '--cached', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    try {
      const output = execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
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

function stdin() {
  return new Promise(resolveInput => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => resolveInput(value || '{}'));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
