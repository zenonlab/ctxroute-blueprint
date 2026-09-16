import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

let source = '';
for await (const chunk of process.stdin) source += chunk;
const { phase, dispatch } = JSON.parse(source || '{}');
const mission = dispatch.mission ?? dispatch;
const scenario = process.env.CTXROUTE_FIXTURE_SCENARIO ?? 'success';
if (scenario === 'timeout') await new Promise(resolveWait => { setTimeout(resolveWait, 3_600_000); });
if (scenario === 'crash') process.exit(17);
if (scenario === 'invalid-json') { process.stdout.write('{not-json'); process.exit(0); }
if (phase === 'research') {
  const requirements = mission.requirements ?? [];
  const accessedAt = '2026-09-16T00:00:00Z';
  const sources = requirements.map((requirement, index) => ({ source_id: `fixture-source-${index + 1}`, requirement_ids: [requirement.requirement_id], url: 'https://example.invalid/official-documentation', domain: 'example.invalid', authority: 'official', title: 'Fixture official documentation', version: requirement.installed_version, accessed_at: accessedAt, digest: 'd'.repeat(64), claims: [`Current fixture evidence covers ${requirement.subject}.`] }));
  process.stdout.write(JSON.stringify({ report_id: `${mission.goal_id}-documentation`, goal_id: mission.goal_id, status: requirements.length ? 'SATISFIED' : 'NOT_APPLICABLE', requirements, sources, justification: requirements.length ? 'Fixture primary evidence covers every requirement.' : 'No external facts are required.', created_at: accessedAt, digest: 'e'.repeat(64), blocked_cause: null }));
} else if (phase === 'plan') {
  const paths = mission.suggested_paths.length ? mission.suggested_paths : ['src/goal-change.mjs'];
  const criterionIds = mission.acceptance_criteria.map((_, index) => `criterion-${index + 1}`);
  const selectedSkill = process.env.CTXROUTE_FIXTURE_MISSING_SKILL ?? 'blueprint-audit';
  const missionIds = scenario === 'parallel' ? [`${mission.goal_id}-mission-1`, `${mission.goal_id}-mission-2`] : [`${mission.goal_id}-mission-1`];
  const plannedMissions = missionIds.map((missionId, index) => {
    const path = paths[index] ?? `src/goal-change-${index + 1}.mjs`;
    return { mission_id: missionId, skill_id: selectedSkill, requested_skill_id: null, skill_version: '1.0.0', skill_path: `.agents/skills/${selectedSkill}/SKILL.md`, objective: mission.objective, dependencies: [], acceptance_criteria: criterionIds.filter((_, criterionIndex) => criterionIndex % missionIds.length === index), file_scope: [path], acceptance: mission.acceptance_criteria, validations: [{ id: `fixture-syntax-${index + 1}`, executable: 'node', args: ['--check', path], cwd: '.', timeout_ms: 30000 }], execution: 'coordinated' };
  });
  process.stdout.write(JSON.stringify({
    goal_id: mission.goal_id,
    missions: plannedMissions,
    criterion_coverage: criterionIds.map((criterion_id, index) => ({ criterion_id, mission_ids: [missionIds[index % missionIds.length]] })),
  }));
} else if (phase === 'work') {
  let targets;
  if (mission.skill_id === 'skill-creator') {
    const skillRoot = mission.file_scope[0].replace(/\/$/u, '');
    const skillId = skillRoot.split('/').at(-1);
    targets = [`${skillRoot}/SKILL.md`, `${skillRoot}/blueprint.json`];
    await mkdir(resolve(process.cwd(), skillRoot), { recursive: true });
    const prior = await readFile(resolve(process.cwd(), targets[0]), 'utf8').catch(() => '');
    const repairMarker = prior ? '\nRepair evidence: repair-pass.\n' : '';
    await writeFile(resolve(process.cwd(), targets[0]), `---\nname: ${skillId}\ndescription: Handle ${skillId} missions.\n---\n\n# ${skillId}\n\nFollow the bounded mission and return structured evidence.${repairMarker}\n`);
    await writeFile(resolve(process.cwd(), targets[1]), `${JSON.stringify({ schemaVersion: 2, skillId, version: '1.0.0', modes: ['SWARM_ON', 'SWARM_OFF'], mutationAuthority: 'orchestrator', researchLabels: [], validations: [{ id: 'syntax', executable: 'node', args: ['--check', 'scripts/orchestrator-core.mjs'], cwd: '.', timeout_ms: 30000 }] }, null, 2)}\n`);
  } else {
    const target = mission.file_scope.find(path => !path.endsWith('/')) ?? `${mission.file_scope[0].replace(/\/$/u, '')}/goal-change.mjs`;
    targets = [target];
    await mkdir(dirname(resolve(process.cwd(), target)), { recursive: true });
    await writeFile(resolve(process.cwd(), target), 'export const orchestrated = true;\n');
  }
  if (scenario === 'crash-after-change') process.exit(18);
  process.stdout.write(JSON.stringify({ mission_id: mission.mission_id, status: 'READY_FOR_VALIDATION', files_touched: targets, validation_results: mission.validations.map(item => ({ id: item.id, status: 'PASSED', exit_code: 0, duration_ms: 1, timed_out: false, cause: null, diagnostic: null })), summary: 'Fixture worker completed the scoped change.' }));
} else if (phase === 'goal-audit') {
  process.stdout.write(JSON.stringify({ goal_id: mission.goal_id, decision: scenario === 'reject' ? 'reject' : 'accept', criteria: mission.acceptance_criteria.map((_, index) => ({ criterion_id: `criterion-${index + 1}`, status: scenario === 'reject' ? 'MISSING' : 'PROVED', evidence_refs: mission.evidence_refs ?? [], mission_ids: mission.mission_ids ?? [] })), repair_missions: [], summary: scenario === 'reject' ? 'Fixture rejected evidence.' : 'All criteria have integrated evidence.' }));
} else {
  const skillFile = mission.file_scope?.[0] ? resolve(process.cwd(), mission.file_scope[0], 'SKILL.md') : null;
  const repaired = skillFile ? /repair-pass/u.test(await readFile(skillFile, 'utf8').catch(() => '')) : false;
  const decision = scenario === 'reject' ? 'reject' : scenario === 'repair-once' && !repaired ? 'repair' : 'accept';
  process.stdout.write(JSON.stringify({ audit_id: `${mission.mission_id ?? mission.goal_id}-audit-${decision}`, audit_type: 'blueprint-audit', subject: { type: 'skill', id: mission.skill_id ?? 'skill' }, signals: ['fixture-audit'], decision, evidence_refs: mission.file_scope ?? [], proposed_action: decision === 'repair' ? 'Add repair evidence.' : null, applied_action: null, validations: [], rollback_ref: null }));
}
