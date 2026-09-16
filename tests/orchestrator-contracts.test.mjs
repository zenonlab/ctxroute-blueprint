import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ORCHESTRATOR_SCHEMA_IDS,
  assertOrchestratorContract,
  getOrchestratorValidator,
  listOrchestratorContracts,
  validateOrchestratorContract,
} from '../scripts/orchestrator-contracts.mjs';

const oid = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const validation = { id: 'syntax', executable: 'node', args: ['--check', 'src/change.mjs'], cwd: '.', timeout_ms: 30000 };
const validationResult = { id: 'syntax', status: 'PASSED', exit_code: 0, duration_ms: 12, timed_out: false, cause: null, diagnostic: null };
const receipt = { receipt_id: 'receipt-one', mission_id: 'mission-one', status: 'PASSED', results: [validationResult], completed_at: '2026-09-06T12:00:00Z' };
const report = { mission_id: 'mission-one', status: 'READY_FOR_VALIDATION', files_touched: ['src/change.mjs'], validation_results: [validationResult], summary: 'Scoped change is ready.' };
const audit = { audit_id: 'audit-one', audit_type: 'blueprint-audit', subject: { type: 'blueprint', id: 'ctxroute-blueprint' }, signals: ['contracts-closed'], decision: 'accept', evidence_refs: ['tests/orchestrator-contracts.test.mjs'], proposed_action: null, applied_action: null, validations: [validationResult], rollback_ref: null };
const missionRequest = { mission_id: 'mission-one', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '2.0.0', file_scope: ['src/'], acceptance: ['Syntax is valid.'], validations: [validation], execution: 'coordinated' };
const missionRecord = { ...missionRequest, response_format: 'worker-report', execution_reason: 'EXPLICIT_COORDINATED', status: 'COMPLETED', worktree_allocation: { path: '.ctxroute/worktrees/mission-one', base_revision: oid, status: 'ACTIVE', recovery_proof: null }, report, validation_receipt: receipt };
const missionView = { goal_id: 'goal-one', goal_title: 'Implement contracts', mission_id: 'mission-one', skill_id: 'blueprint-audit', skill_version: '2.0.0', file_scope: ['src/'], acceptance: ['Syntax is valid.'], validations: [validation], response_format: 'worker-report', worktree: '.ctxroute/worktrees/mission-one' };
const worktreeOperation = { operation_id: 'operation-one', mission_id: 'mission-one', kind: 'RECONCILE', status: 'COMPLETED', classification: 'ACTIVE_COHERENT', path: '.ctxroute/worktrees/mission-one', base_revision: oid, dirty: false, proof_ref: null, cause: null };
const config = { defaultMode: 'SWARM_ON', statePath: '.ctxroute/orchestrator/state.json', worktreeRoot: '.ctxroute/worktrees', recoveryRoot: '.ctxroute/recovery', telemetryPath: '.ctxroute/orchestrator/events.jsonl', workerRuntime: 'auto', limits: { stateBytes: 524288, reportBytes: 65536, contextBytes: 16384, lockTimeoutMs: 2000, subprocessTimeoutMs: 30000, goalTimeoutMs: 900000, workerTimeoutMs: 300000, parallelWorktrees: 8, workerStdoutBytes: 65536, workerStderrBytes: 16384, minimumFreeBytes: 268435456, telemetryBytes: 1048576, recoveryBytes: 16777216, auditTraceBytes: 2097152, auditTraceFiles: 32 } };
const transaction = { operation_id: 'operation-one', expected_revision: 0, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: missionRequest } };
const state = { revision: 1, mode: 'SWARM_ON', telemetry_sequence: 0, goals: [{ goal_id: 'goal-one', title: 'Implement contracts', status: 'ACTIVE', missions: [missionRecord] }], skills: [{ skill_id: 'blueprint-audit', version: '2.0.0', path: '.agents/skills/blueprint-audit', artifact_digest: digest, validation_receipt: receipt, audit_id: 'audit-one', registered_revision: 1 }], audits: [audit], transactions: [{ operation_id: 'operation-one', digest, action: 'mission.prepare', intent: transaction.payload, status: 'COMPLETED', start_revision: 0, end_revision: 1, result: 'CREATED', cause: null }], worktree_operations: [worktreeOperation] };
const event = { sequence: 1, event_id: 'event-one', event_type: 'TRANSACTION', operation_id: 'operation-one', revision_before: 0, revision_after: 1, entity_type: 'mission', entity_id: 'mission-one', transition: 'PREPARING->ASSIGNED', mode: 'SWARM_ON', mode_source: 'default', skill_id: 'blueprint-audit', skill_version: '2.0.0', validation_id: null, duration_ms: 12, exit_code: 0, git_oid_before: oid, git_oid_after: oid, result: 'SUCCESS', cause: null, policy_id: 'orchestrator', schema_id: 'state', schema_path: '/goals/0/status', keyword: 'enum', evidence_digest: digest, timestamp: '2026-09-06T12:00:00Z' };
const bootstrap = { status: 'READY', inventory_digest: digest, classifications: [], causes: [], recovery_actions: [], changed: false };
const goalRunRequest = { goal_id: 'goal-one', title: 'Implement contracts', objective: 'Implement bounded contracts.', acceptance_criteria: ['Contracts validate.'], suggested_paths: ['src/'], expected_revision: 0 };
const plannedMission = { ...missionRequest, objective: 'Implement bounded contracts.', dependencies: [], acceptance_criteria: ['criterion-1'], skill_path: '.agents/skills/blueprint-audit/SKILL.md' };
const goalPlan = { goal_id: 'goal-one', missions: [plannedMission], criterion_coverage: [{ criterion_id: 'criterion-1', mission_ids: ['mission-one'] }] };
const workerDispatch = { dispatch_id: 'dispatch-one', runtime: 'fixture', phase: 'work', mission: missionView, skill_path: '.agents/skills/blueprint-audit/SKILL.md', output_contract: 'worker-report' };
const goalAcceptanceReport = { goal_id: 'goal-one', decision: 'accept', criteria: [{ criterion_id: 'criterion-1', status: 'PROVED', evidence_refs: ['src/change.mjs'], mission_ids: ['mission-one'] }], repair_missions: [], summary: 'All criteria are proved.' };
const providerCapabilities = { adapter: 'codex', capabilities: ['code', 'structured-output'], context_classes: ['medium'], efforts: ['low', 'medium'], access_modes: ['read-only', 'workspace-write'], web_access: true };
const modelDescriptor = { adapter: 'codex', model_id: 'model-one', provider_family: 'openai', level: 'small', capabilities: ['code', 'structured-output'], context_class: 'medium', cost_class: 'low', efforts: ['low', 'medium'], access_modes: ['read-only', 'workspace-write'], status: 'available', verified_at: '2026-09-16T12:00:00Z', verification_source: 'https://developers.openai.com/example', evaluation_score: 0.8 };
const consumptionPolicy = { preset: 'balanced', max_duration_ms: 900000, max_normalized_units: 100, max_cost_usd: null, allowed_providers: ['codex', 'claude'], denied_models: [], prefer_local: false, local_only: false };
const taskAssessment = { assessment_id: 'assessment-one', importance: 'normal', change_kind: 'feature', minimum_level: 'L1', context_class: 'small', risk_signals: [], reproducibility: 'not-applicable', validation_strength: 'strong', rollback: 'bounded', ambiguity: 'low', failure_count: 0, reasons: ['Bounded feature work requires L1.'] };
const routingDecision = { decision_id: 'route-one', phase: 'work', level: 'L1', selected: { adapter: 'codex', model_id: 'model-one', provider_family: 'openai', normalized_units: 2 }, effort: 'low', access_mode: 'workspace-write', required_capabilities: ['code', 'structured-output'], cascade: [{ source: 'safety-floor', effect: 'minimum L1' }], rejected: [], independence_required: false, reason: 'Selected the smallest qualified model.' };
const executionReceipt = { receipt_id: 'execution-one', dispatch_id: 'dispatch-one', phase: 'work', adapter: 'codex', model_id: 'model-one', provider_family: 'openai', effort: 'low', duration_ms: 50, normalized_units: 2, input_tokens: 10, output_tokens: 5, cost_usd: null, outcome: 'success', cause: null };
const escalationEvent = { event_id: 'escalation-one', mission_id: 'mission-one', from_level: 'L1', to_level: 'L2', cause: 'VALIDATION_FAILED', attempt: 1, timestamp: '2026-09-16T12:00:00Z' };
const modelEvaluation = { model_id: 'model-one', phase: 'work', samples: 10, success_rate: 0.9, structured_output_rate: 1, scope_rate: 0.9, median_duration_ms: 50, confidence: 'measured', promotion_eligible: false, degraded: false, updated_at: '2026-09-16T12:00:00Z' };
const documentationRequirement = { requirement_id: 'documentation-one', subject: 'sdk-one', installed_version: '1.0.0', reason: 'The SDK behavior is external.', freshness: 'per-goal', primary_required: true };
const documentationSource = { source_id: 'source-one', requirement_ids: ['documentation-one'], url: 'https://example.com/docs', domain: 'example.com', authority: 'official', title: 'Official documentation', version: '1.0.0', accessed_at: '2026-09-16T12:00:00Z', digest, claims: ['The supported behavior is documented.'] };
const documentationEvidenceReport = { report_id: 'documentation-report', goal_id: 'goal-one', status: 'SATISFIED', requirements: [documentationRequirement], sources: [documentationSource], justification: 'Primary evidence covers the requirement.', created_at: '2026-09-16T12:00:00Z', digest, blocked_cause: null };
const documentationFreshnessReceipt = { receipt_id: 'freshness-one', report_id: 'documentation-report', goal_id: 'goal-one', dispatch_id: null, status: 'CURRENT', checked_at: '2026-09-16T12:00:00Z', source_digests: [digest], cause: null };

const examples = {
  config,
  state,
  transaction,
  missionRequest,
  missionRecord,
  missionView,
  workerReport: report,
  auditReport: audit,
  validationReceipt: receipt,
  worktreeOperation,
  decisionEvent: event,
  bootstrapReport: bootstrap,
  goalRunRequest,
  goalPlan,
  workerDispatch,
  goalAcceptanceReport,
  providerCapabilities,
  modelDescriptor,
  consumptionPolicy,
  taskAssessment,
  routingDecision,
  executionReceipt,
  escalationEvent,
  modelEvaluation,
  documentationRequirement,
  documentationSource,
  documentationEvidenceReport,
  documentationFreshnessReceipt,
};

test('all public orchestrator schemas compile once and accept their canonical examples', () => {
  assert.equal(listOrchestratorContracts().length, 28);
  for (const [name, value] of Object.entries(examples)) {
    assert.equal(validateOrchestratorContract(name, value).valid, true, name);
    assert.equal(getOrchestratorValidator(name), getOrchestratorValidator(ORCHESTRATOR_SCHEMA_IDS[name]));
    assert.equal(assertOrchestratorContract(name, value), value);
  }
});

test('every object contract rejects missing and unknown root fields', () => {
  for (const [name, value] of Object.entries(examples)) {
    const required = Object.keys(value)[0];
    const missing = structuredClone(value);
    delete missing[required];
    assert.equal(validateOrchestratorContract(name, missing).valid, false, `${name} missing ${required}`);
    assert.equal(validateOrchestratorContract(name, { ...value, conversation_history: [] }).valid, false, `${name} unknown history`);
  }
});

test('paths, enums, cardinality, duplicates, and bounded text fail closed', () => {
  assert.equal(validateOrchestratorContract('config', { ...config, statePath: '../state.json' }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request', { ...missionRequest, execution: 'maybe' }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request', { ...missionRequest, file_scope: [] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request', { ...missionRequest, file_scope: ['src/', 'src/'] }).valid, false);
  assert.equal(validateOrchestratorContract('worker-report', { ...report, summary: 'x'.repeat(1025) }).valid, false);
  assert.equal(validateOrchestratorContract('audit-report', { ...audit, decision: 'correct-through-orchestrator' }).valid, false);
  assert.equal(validateOrchestratorContract('decision-event', { ...event, mode_source: 'process' }).valid, false);
});

test('transaction action payloads are closed and cannot hide replay differences', () => {
  assert.equal(validateOrchestratorContract('transaction', transaction).valid, true);
  assert.equal(validateOrchestratorContract('transaction', { ...transaction, payload: { ...transaction.payload, goal_id: 'goal-two', extra: true } }).valid, false);
  assert.equal(validateOrchestratorContract('transaction', { ...transaction, prompt: 'private' }).valid, false);
  assert.equal(validateOrchestratorContract('transaction', { ...transaction, action: 'shell.run' }).valid, false);
});

test('structured validations reject shell-shaped and control-bearing values', () => {
  const shellValidation = { ...validation, executable: 'node\nsh', args: ['--check', 'src/change.mjs'] };
  assert.equal(validateOrchestratorContract('mission-request', { ...missionRequest, validations: [shellValidation] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request', { ...missionRequest, validations: [{ ...validation, cwd: '/tmp' }] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-view', { ...missionView, response_format: 'unknown-report' }).valid, false);
});

test('validation errors expose schema locations but never rejected values', () => {
  const secret = 'super-secret-value';
  const result = validateOrchestratorContract('worker-report', { ...report, summary: secret, environment: { TOKEN: secret } });
  assert.equal(result.valid, false);
  assert.equal(JSON.stringify(result.errors).includes(secret), false);
  assert.throws(() => assertOrchestratorContract('worker-report', { ...report, environment: secret }), error => error.code === 'ORCHESTRATOR_CONTRACT_INVALID' && !error.message.includes(secret));
  assert.throws(() => getOrchestratorValidator('missing-contract'), /Unknown orchestrator contract/u);
});
