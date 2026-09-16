import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { assertOrchestratorContract } from './orchestrator-contracts.mjs';

const MANIFESTS = new Set(['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod']);
const EXTERNAL_PATTERN = /\b(?:api|authentication|authorization|cloud|cli|framework|library|model|oauth|openai|anthropic|claude|gemini|sdk|standard|protocol|pricing|quota|security|permissions|latest|current)\b/iu;
const VOLATILE_PATTERN = /\b(?:latest|current|availability|incident|price|pricing|quota|model)\b/iu;

export async function inventoryDocumentationRequirements(request, root = process.cwd()) {
  const text = `${request.title ?? ''}\n${request.objective ?? ''}\n${(request.acceptance_criteria ?? []).join('\n')}`;
  const paths = request.suggested_paths ?? [];
  const manifestTargets = paths.filter(path => MANIFESTS.has(basename(path)));
  const dependencies = await relevantDependencies(text, root);
  if (!EXTERNAL_PATTERN.test(text) && !manifestTargets.length && !dependencies.length) return [];
  const subjects = dependencies.length ? dependencies : manifestTargets.length ? manifestTargets.map(basename) : ['external-platform'];
  return [...new Map(subjects.map(subject => [subject.name ?? subject, subject])).values()].slice(0, 32).map((subject, index) => ({
    requirement_id: `${request.goal_id}-documentation-${index + 1}`,
    subject: normalizeIdentifier(subject), installed_version: dependencies.find(item => item === subject)?.version ?? null,
    reason: `The goal depends on current external behavior for ${subject.name ?? subject}.`, freshness: VOLATILE_PATTERN.test(text) ? 'per-dispatch' : 'per-goal', primary_required: true,
  })).map(requirement => { if (requirement.installed_version === undefined) requirement.installed_version = null; assertOrchestratorContract('documentation-requirement', requirement); return requirement; });
}

export async function documentationGate({ request, root = process.cwd(), dispatch, consumption, now = () => new Date() }) {
  const requirements = await inventoryDocumentationRequirements(request, root);
  if (!requirements.length) return finalizeReport({ report_id: `${request.goal_id}-documentation`, goal_id: request.goal_id, status: 'NOT_APPLICABLE', requirements: [], sources: [], justification: 'No external dependency, evolving standard, provider behavior, or current recommendation is in the bounded goal.', created_at: now().toISOString(), digest: '0'.repeat(64), blocked_cause: null });
  if (consumption.local_only) return finalizeReport({ report_id: `${request.goal_id}-documentation`, goal_id: request.goal_id, status: 'BLOCKED', requirements, sources: [], justification: 'Current external evidence is required but local-only policy forbids Web research.', created_at: now().toISOString(), digest: '0'.repeat(64), blocked_cause: 'FRESH_DOCUMENTATION_UNAVAILABLE' });
  if (!dispatch) return finalizeReport({ report_id: `${request.goal_id}-documentation`, goal_id: request.goal_id, status: 'BLOCKED', requirements, sources: [], justification: 'No Web-capable documentation researcher is available.', created_at: now().toISOString(), digest: '0'.repeat(64), blocked_cause: 'FRESH_DOCUMENTATION_UNAVAILABLE' });
  let result;
  try {
    result = await dispatch({ dispatch_id: `${request.goal_id}-documentation`, phase: 'research', mission: { goal_id: request.goal_id, importance: request.importance ?? 'normal', requirements }, skill_path: '.agents/skills/documentation-researcher/SKILL.md', output_contract: 'documentation-evidence-report', worktree: '.' });
  } catch {
    return finalizeReport({ report_id: `${request.goal_id}-documentation`, goal_id: request.goal_id, status: 'BLOCKED', requirements, sources: [], justification: 'The documentation researcher could not produce a valid closed report.', created_at: now().toISOString(), digest: '0'.repeat(64), blocked_cause: 'FRESH_DOCUMENTATION_UNAVAILABLE' });
  }
  const report = { ...result.report, report_id: `${request.goal_id}-documentation`, goal_id: request.goal_id, requirements, created_at: now().toISOString() };
  const coverage = new Set(report.sources.flatMap(source => source.requirement_ids));
  const missing = requirements.filter(requirement => !coverage.has(requirement.requirement_id));
  const secondaryOnly = requirements.filter(requirement => requirement.primary_required && !report.sources.some(source => source.requirement_ids.includes(requirement.requirement_id) && source.authority !== 'secondary'));
  if (missing.length || secondaryOnly.length || report.status !== 'SATISFIED') return finalizeReport({ ...report, status: 'BLOCKED', justification: 'One or more requirements lack current primary evidence.', blocked_cause: 'FRESH_DOCUMENTATION_UNAVAILABLE' });
  return finalizeReport({ ...report, status: 'SATISFIED', blocked_cause: null });
}

export function documentationFreshness(report, { dispatch_id = null, now = () => new Date() } = {}) {
  assertOrchestratorContract('documentation-evidence-report', report);
  const perDispatch = report.requirements.some(requirement => requirement.freshness === 'per-dispatch');
  const status = report.status === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : report.status === 'SATISFIED' && (!perDispatch || dispatch_id) ? 'CURRENT' : 'STALE';
  const receipt = { receipt_id: `${report.report_id}-${dispatch_id ?? 'goal'}-freshness`, report_id: report.report_id, goal_id: report.goal_id, dispatch_id, status, checked_at: now().toISOString(), source_digests: report.sources.map(source => source.digest).sort(), cause: status === 'STALE' ? 'DOCUMENTATION_STALE' : null };
  assertOrchestratorContract('documentation-freshness-receipt', receipt);
  return receipt;
}

export function assertDocumentCitations(report, sourceIds) {
  const ledger = new Set(report.sources.map(source => source.source_id));
  const unknown = sourceIds.filter(source => !ledger.has(source));
  if (unknown.length) { const error = new Error(`worker cited documentation outside the goal ledger: ${unknown.join(', ')}`); error.causeCode = 'DOCUMENTATION_LEDGER_MISMATCH'; throw error; }
}

function finalizeReport(report) {
  const digest = createHash('sha256').update(stableJson({ ...report, digest: undefined })).digest('hex');
  const finalized = { ...report, digest };
  assertOrchestratorContract('documentation-evidence-report', finalized);
  return finalized;
}

async function relevantDependencies(text, root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8').catch(() => '{}'));
  const entries = Object.entries({ ...manifest.dependencies, ...manifest.devDependencies });
  return entries.filter(([name]) => text.toLocaleLowerCase('en-US').includes(name.toLocaleLowerCase('en-US'))).map(([name, version]) => ({ name, version: String(version).slice(0, 128) }));
}
function normalizeIdentifier(value) { return String(value.name ?? value).toLocaleLowerCase('en-US').replace(/[^a-z0-9._-]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 128) || 'external'; }
function stableJson(value) { if (value === undefined) return 'null'; if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`; if (value && value === Object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`; return JSON.stringify(value); }
