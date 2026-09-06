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
const report = { schemaVersion: 2, mission_id: 'mission-one', status: 'READY_FOR_VALIDATION', files_touched: ['src/change.mjs'], validation_results: [validationResult], summary: 'Scoped change is ready.' };
const audit = { schemaVersion: 2, audit_id: 'audit-one', audit_type: 'blueprint-audit', subject: { type: 'blueprint', id: 'ctxroute-blueprint' }, signals: ['contracts-closed'], decision: 'accept', evidence_refs: ['tests/orchestrator-contracts.test.mjs'], proposed_action: null, applied_action: null, validations: [validationResult], rollback_ref: null };
const missionRequest = { mission_id: 'mission-one', skill_id: 'blueprint-audit', requested_skill_id: null, skill_version: '2.0.0', file_scope: ['src/'], acceptance: ['Syntax is valid.'], validations: [validation], execution: 'coordinated' };
const missionRecord = { ...missionRequest, response_format: 'worker-report-v2', execution_reason: 'EXPLICIT_COORDINATED', status: 'COMPLETED', worktree_allocation: { path: '.ctxroute/worktrees/mission-one', base_revision: oid, status: 'ACTIVE', recovery_proof: null }, report, validation_receipt: receipt };
const missionView = { mission_id: 'mission-one', skill_id: 'blueprint-audit', skill_version: '2.0.0', file_scope: ['src/'], acceptance: ['Syntax is valid.'], validations: [validation], response_format: 'worker-report-v2', worktree: '.ctxroute/worktrees/mission-one' };
const worktreeOperation = { operation_id: 'operation-one', mission_id: 'mission-one', kind: 'RECONCILE', status: 'COMPLETED', classification: 'ACTIVE_COHERENT', path: '.ctxroute/worktrees/mission-one', base_revision: oid, dirty: false, proof_ref: null, cause: null };
const config = { schemaVersion: 2, defaultMode: 'SWARM_ON', statePath: '.ctxroute/orchestrator/state.json', worktreeRoot: '.ctxroute/worktrees', recoveryRoot: '.ctxroute/recovery', telemetryPath: '.ctxroute/orchestrator/events.jsonl', limits: { stateBytes: 524288, reportBytes: 65536, contextBytes: 16384, lockTimeoutMs: 2000, subprocessTimeoutMs: 30000, parallelWorktrees: 8, minimumFreeBytes: 268435456, telemetryBytes: 1048576, recoveryBytes: 16777216, auditTraceBytes: 2097152, auditTraceFiles: 32 } };
const transaction = { operation_id: 'operation-one', expected_revision: 0, action: 'mission.prepare', payload: { goal_id: 'goal-one', mission: missionRequest } };
const state = { schemaVersion: 2, revision: 1, mode: 'SWARM_ON', telemetry_sequence: 0, migration_receipt: null, goals: [{ goal_id: 'goal-one', title: 'Implement contracts', status: 'ACTIVE', missions: [missionRecord] }], skills: [{ skill_id: 'blueprint-audit', version: '2.0.0', path: '.agents/skills/blueprint-audit', artifact_digest: digest, validation_receipt: receipt, audit_id: 'audit-one', registered_revision: 1 }], audits: [audit], transactions: [{ operation_id: 'operation-one', digest, action: 'mission.prepare', intent: transaction.payload, status: 'COMPLETED', start_revision: 0, end_revision: 1, result: 'CREATED', cause: null }], worktree_operations: [worktreeOperation] };
const event = { schemaVersion: 1, sequence: 1, event_id: 'event-one', event_type: 'TRANSACTION', operation_id: 'operation-one', revision_before: 0, revision_after: 1, entity_type: 'mission', entity_id: 'mission-one', transition: 'PREPARING->ASSIGNED', mode: 'SWARM_ON', mode_source: 'default', skill_id: 'blueprint-audit', skill_version: '2.0.0', validation_id: null, duration_ms: 12, exit_code: 0, git_oid_before: oid, git_oid_after: oid, result: 'SUCCESS', cause: null, timestamp: '2026-09-06T12:00:00Z' };
const eventV2 = { ...event, schemaVersion: 2, policy_id: 'orchestrator-v2', schema_id: 'state-v2', schema_path: '/goals/0/status', keyword: 'enum', evidence_digest: digest };
const bootstrap = { schemaVersion: 2, status: 'READY', inventory_digest: digest, classifications: [], causes: [], recovery_actions: [], changed: false };

const examples = {
  configV2: config,
  stateV2: state,
  transactionV2: transaction,
  missionRequestV2: missionRequest,
  missionRecordV2: missionRecord,
  missionViewV2: missionView,
  workerReportV2: report,
  auditReportV2: audit,
  validationReceiptV2: receipt,
  worktreeOperationV2: worktreeOperation,
  decisionEventV1: event,
  decisionEventV2: eventV2,
  bootstrapReportV2: bootstrap,
};

test('all public orchestrator schemas compile once and accept their canonical examples', () => {
  assert.equal(listOrchestratorContracts().length, 13);
  for (const [name, value] of Object.entries(examples)) {
    assert.equal(validateOrchestratorContract(name, value).valid, true, name);
    assert.equal(getOrchestratorValidator(name), getOrchestratorValidator(ORCHESTRATOR_SCHEMA_IDS[name]));
    assert.equal(assertOrchestratorContract(name, value), value);
  }
});

test('every V2 object contract rejects missing and unknown root fields', () => {
  for (const [name, value] of Object.entries(examples)) {
    const required = Object.keys(value)[0];
    const missing = structuredClone(value);
    delete missing[required];
    assert.equal(validateOrchestratorContract(name, missing).valid, false, `${name} missing ${required}`);
    assert.equal(validateOrchestratorContract(name, { ...value, conversation_history: [] }).valid, false, `${name} unknown history`);
  }
});

test('paths, enums, cardinality, duplicates, and bounded text fail closed', () => {
  assert.equal(validateOrchestratorContract('config-v2', { ...config, statePath: '../state.json' }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request-v2', { ...missionRequest, execution: 'maybe' }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request-v2', { ...missionRequest, file_scope: [] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request-v2', { ...missionRequest, file_scope: ['src/', 'src/'] }).valid, false);
  assert.equal(validateOrchestratorContract('worker-report-v2', { ...report, summary: 'x'.repeat(1025) }).valid, false);
  assert.equal(validateOrchestratorContract('audit-report-v2', { ...audit, decision: 'correct-through-orchestrator' }).valid, false);
  assert.equal(validateOrchestratorContract('decision-event-v1', { ...event, mode_source: 'process' }).valid, false);
});

test('transaction action payloads are closed and cannot hide replay differences', () => {
  assert.equal(validateOrchestratorContract('transaction-v2', transaction).valid, true);
  assert.equal(validateOrchestratorContract('transaction-v2', { ...transaction, payload: { ...transaction.payload, goal_id: 'goal-two', extra: true } }).valid, false);
  assert.equal(validateOrchestratorContract('transaction-v2', { ...transaction, prompt: 'private' }).valid, false);
  assert.equal(validateOrchestratorContract('transaction-v2', { ...transaction, action: 'shell.run' }).valid, false);
});

test('structured validations reject shell-shaped and control-bearing values', () => {
  const shellValidation = { ...validation, executable: 'node\nsh', args: ['--check', 'src/change.mjs'] };
  assert.equal(validateOrchestratorContract('mission-request-v2', { ...missionRequest, validations: [shellValidation] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-request-v2', { ...missionRequest, validations: [{ ...validation, cwd: '/tmp' }] }).valid, false);
  assert.equal(validateOrchestratorContract('mission-view-v2', { ...missionView, response_format: 'worker-report-v1' }).valid, false);
});

test('validation errors expose schema locations but never rejected values', () => {
  const secret = 'super-secret-value';
  const result = validateOrchestratorContract('worker-report-v2', { ...report, summary: secret, environment: { TOKEN: secret } });
  assert.equal(result.valid, false);
  assert.equal(JSON.stringify(result.errors).includes(secret), false);
  assert.throws(() => assertOrchestratorContract('worker-report-v2', { ...report, environment: secret }), error => error.code === 'ORCHESTRATOR_CONTRACT_INVALID' && !error.message.includes(secret));
  assert.throws(() => getOrchestratorValidator('missing-contract'), /Unknown orchestrator contract/u);
});
