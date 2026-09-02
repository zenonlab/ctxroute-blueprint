import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadProjectConfig } from '../../.githooks/project-policy.mjs';
import { listArchifyDiagrams } from '../../scripts/archify-registry.mjs';
import { markModeOffered, progressNext, readProgress } from '../../scripts/progress-core.mjs';
import { hasAutonomousOffer, hasNextStepHandoff, isExternallyBlocked } from '../../scripts/progress-handoff.mjs';
import { dashboardSessionNotice } from '../../scripts/progress-dashboard-manager.mjs';

async function main() {
  const input = JSON.parse(await stdin());
  if (input.stop_hook_active) {
    await recordPresentedOffer(input);
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
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
    return;
  }

  const continuation = await progressContinuation(input, { changed });
  process.stdout.write(JSON.stringify(continuation ?? { continue: true }));
}

export async function progressContinuation(hookInput, options = {}) {
  const root = options.root ?? process.cwd();
  const changed = options.changed ?? gitChangedFiles(root);
  try {
    const diagrams = options.diagrams ?? listArchifyDiagrams(root).filter(diagram => diagram.audience === 'product');
    const progress = await readProgress(root);
    const goal = progress.goals.find(item => item.status !== 'DONE');
    if (!goal) return null;
    const next = progressNext(progress, goal.id);
    if (next.complete) return null;
    const dashboard = await progressDashboardMessage(hookInput, root, options.dashboardNotice);
    const labels = next.next.map(step => `${step.stepId}: ${step.title} [${step.status}]`).join('\n');
    if (isExternallyBlocked(goal)) {
      return { continue: true, systemMessage: joinDashboard(`Goal ${goal.id} is blocked externally. Handoff:\n${labels}\n${archifyInstruction(changed, diagrams)}`, dashboard) };
    }
    if (next.mode === 'autonomous') {
      return withDashboard({ decision: 'block', reason: `Continue ce goal en mode automatique. Cherche toi-même la solution, exécute les étapes restantes, vérifie tous les critères et ne termine qu'avec des preuves complètes.\n${labels}\n${archifyInstruction(changed, diagrams)}`.slice(0, 1200) }, dashboard);
    }
    if (next.next.length === 0) return null;
    const handoffPresent = hasNextStepHandoff(hookInput.last_assistant_message, next.next);
    const offerPresent = hasAutonomousOffer(hookInput.last_assistant_message);
    if (handoffPresent && (goal.modeOffered || offerPresent)) {
      if (!goal.modeOffered && offerPresent) await markModeOffered(goal.id, root);
      return dashboard ? { continue: true, systemMessage: dashboard } : null;
    }
    let message = `Handoff — prochaines étapes pour ${goal.id}:\n${labels}`;
    message += `\nArchify à produire ou mettre à jour pour cette étape : ${archifyInstruction(changed, diagrams)}`;
    if (!goal.modeOffered) {
      message += '\nJe peux passer ce goal en mode automatique : j’enchaînerai toutes les étapes, chercherai moi-même les solutions et ne reviendrai qu’après vérification complète ou blocage externe réel.';
    }
    return withDashboard({ decision: 'block', reason: message.slice(0, 1200) }, dashboard);
  } catch (error) {
    return { systemMessage: `Progress handoff unavailable: ${String(error.message).slice(0, 240)}` };
  }
}

async function progressDashboardMessage(hookInput, root, notice = dashboardSessionNotice) {
  if (!hookInput.session_id) return '';
  try {
    const dashboard = await notice(hookInput.session_id, root);
    return dashboard ? `Tableau Progress local : ${dashboard.url}` : '';
  } catch (error) {
    return `Progress dashboard unavailable: ${String(error.message).slice(0, 240)}`;
  }
}

function joinDashboard(message, dashboard) { return [message, dashboard].filter(Boolean).join('\n').slice(0, 1200); }
function withDashboard(output, dashboard) { if (dashboard) output.systemMessage = dashboard; return output; }

export async function recordPresentedOffer(hookInput, root = process.cwd()) {
  if (!hasAutonomousOffer(hookInput.last_assistant_message)) return;
  try {
    const progress = await readProgress(root);
    const goal = progress.goals.find(item => item.status !== 'DONE');
    if (goal && !goal.modeOffered) await markModeOffered(goal.id, root);
  } catch {}
}

export function archifyInstruction(changed, diagrams = listArchifyDiagrams(process.cwd()).filter(diagram => diagram.audience === 'product')) {
  const source = changed.find(path => path.startsWith('docs/architecture/src/') && path.endsWith('.json'));
  const selected = source ? diagrams.find(diagram => diagram.source === source) : null;
  if (selected) return `${selected.type} (${selected.id}) — vérifier avec npm run archify:validate -- ${selected.id}`;
  const hint = changed.some(path => /(?:mcp|ctxroute|progress|traffic|dataflow|lineage)/iu.test(path)) ? 'dataflow' : changed.some(path => /(?:api|request|response|sequence|trace|call)/iu.test(path)) ? 'sequence' : changed.some(path => /(?:state|status|retry|wait|lifecycle)/iu.test(path)) ? 'lifecycle' : changed.some(path => /(?:hook|workflow|ci|runbook)/iu.test(path)) ? 'workflow' : 'architecture';
  return `${hint} — choisir la vue Archify qui décrit le résultat, l’ajouter sous docs/architecture/src/, puis lancer npm run archify:validate -- ${hint}`;
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
