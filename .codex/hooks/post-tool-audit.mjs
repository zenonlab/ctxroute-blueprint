import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { isSourcePath, isTestPath, isGeneratedPath, isContractPath, loadProjectConfig } from '../../.githooks/project-policy.mjs';
import { applicableAdrs, decisionDiagnostics, loadAdrs, normalizePath } from './decision-memory.mjs';
import { extractPaths } from './path-extraction.mjs';

const input = JSON.parse(await stdin());
const toolInput = input.tool_input ?? {};
const paths = extractPaths(toolInput).map(normalizePath);
const codePaths = paths.filter(path => /\.(?:c|cc|cpp|cs|css|gd|go|h|hpp|java|js|jsx|mjs|py|php|rs|sass|scss|shader|sql|swift|ts|tsx|vue)$/iu.test(path));
const policyPaths = paths.filter(path => /(?:^|\/)(?:AGENTS\.md|agents\.md|CLAUDE\.md|\.project\/project-config\.json|\.codex\/(?:hooks\.json|architecture-policy\.json|hooks\/[^/]+)|\.githooks\/[^/]+)/iu.test(path));
const docPaths = paths.filter(path => /\.(?:md|mmd)$/iu.test(path));
const { config } = loadProjectConfig();
const architecturalPaths = config ? paths.filter(path => isSourcePath(path, config) && !isTestPath(path, config) && !isGeneratedPath(path, config)) : [];
const contractPaths = config ? paths.filter(path => isContractPath(path, config)) : [];
const applicable = applicableAdrs(paths);
const decisionStatus = decisionDiagnostics(paths);
const changedDecisionPaths = paths.filter(path => /^docs\/decisions\/ADR-(?!0000-).+\.md$/u.test(path));
const changedDecisions = loadAdrs().filter(adr => changedDecisionPaths.includes(adr.file));
const findings = [];
for (const path of changedDecisionPaths) {
  const adr = changedDecisions.find(item => item.file === path);
  if (adr && isTracked(path) && !adr.metadata.revised && !adr.metadata['superseded-by']) findings.push(`${path} was modified without revised: true or superseded-by.`);
}
if ((architecturalPaths.length || contractPaths.length) && !applicable.length && !paths.some(path => path.startsWith('docs/decisions/'))) {
  findings.push(`No applicable ADR for ${[...architecturalPaths, ...contractPaths].join(', ')}. Add one only if this materially changes a boundary, contract, dependency, or cross-component flow.`);
}
if (decisionStatus.conflicts.length && !paths.some(path => path.startsWith('docs/decisions/'))) {
  findings.push('Applicable ADRs explicitly conflict. Revise or replace them before committing the governed change.');
}

if (findings.length || process.env.CODEX_POST_TOOL_AUDIT === '1') {
  const lines = findings.length
    ? ['PostToolUse findings. The change already exists: inspect and repair the current file; do not replay the patch.', ...findings]
    : ['Audit required before continuing.'];
  if (codePaths.length) {
    lines.push(`Code : ${codePaths.join(', ')}`);
    lines.push('Read relevant documentation and diagrams before changing code.');
    lines.push('Check placement, architecture, structure, reuse, duplication, regressions, deletions, and side effects.');
    lines.push('Update documentation when architecture, contracts, flows, state, or dependencies change.');
  }
  if (docPaths.length) {
    lines.push(`Documentation : ${docPaths.join(', ')}`);
    lines.push('Check consistency, links, Archify JSON IR, and related documents.');
  }
  if (policyPaths.length) {
    lines.push(`Instructions/hooks : ${policyPaths.join(', ')}`);
    lines.push('Check scope, consistency, format, security, fail-open behavior, and actual behavior.');
  }
  if (applicable.length) lines.push(`Applicable ADRs: ${applicable.map(adr => adr.file).join(', ')}. Confirm the decision remains valid.`);
  lines.push('Review the diff and run the relevant validation.');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') },
  }));
}

function isTracked(path) {
  try { execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { stdio: 'ignore' }); return true; }
  catch { return false; }
}


function stdin() {
  return new Promise(resolve => {
    let value = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { value += chunk; });
    process.stdin.on('end', () => resolve(value || '{}'));
  });
}
