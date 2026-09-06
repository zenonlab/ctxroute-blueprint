import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSessions } from '../scripts/session-audit.mjs';
import { validateOrchestratorContract } from '../scripts/orchestrator-contracts.mjs';

test('session audit streams bounded traces, redacts secrets, and detects defective evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-'));
  const path = join(root, 'defective.jsonl');
  writeFileSync(path, [
    JSON.stringify({ mission_id: 'mission-one', skill_id: 'wrong-skill', token: 'must-not-leak', file_path: 'outside/file.mjs' }),
    JSON.stringify({ exit_code: 1, command: 'npm test', message: 'password=must-not-leak' }),
  ].join('\n'));
  const report = await auditSessions({ sessionPaths: [path], approvedRoots: [root], mission: { mission_id: 'mission-one', skill_id: 'expected-skill', file_scope: ['src/'], validation_commands: ['npm test', 'npm run lint'] } });
  assert.ok(report.signals.includes('skill-id-mismatch'));
  assert.ok(report.signals.includes('files-outside-scope'));
  assert.ok(report.signals.includes('validations-missing'));
  assert.ok(report.signals.includes('validations-failed'));
  assert.ok(report.signals.includes('secret-fields-redacted'));
  assert.doesNotMatch(JSON.stringify(report), /must-not-leak/u);
  assert.equal(report.decision, 'repair');
  assert.equal(validateOrchestratorContract('auditReport', report).valid, true);
});

test('session audit stops at byte limits without returning raw content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-bounded-'));
  const path = join(root, 'large.jsonl');
  writeFileSync(path, `${JSON.stringify({ message: 'x'.repeat(1000) })}\n`);
  const report = await auditSessions({ sessionPaths: [path], approvedRoots: [root], maxBytes: 32 });
  assert.ok(report.signals.includes('bounded-read-truncated'));
  assert.doesNotMatch(JSON.stringify(report), /xxxxxxxx/u);
});

test('session audit skips traces marked active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-audit-active-'));
  const trace = join(directory, 'active.jsonl');
  writeFileSync(trace, `${JSON.stringify({ mission_id: 'wrong' })}\n`);
  writeFileSync(`${trace}.active`, '1');
  const report = await auditSessions({ sessionPaths: [trace], approvedRoots: [directory], mission: { mission_id: 'expected', skill_id: 'skill', file_scope: [], validation_commands: [] } });
  assert.ok(report.signals.includes('active-sessions-skipped'));
  assert.match(report.validations[0].diagnostic, /files=0/u);
});

test('session audit rejects traces outside approved roots and symlink traces', async () => {
  const approved = mkdtempSync(join(tmpdir(), 'session-audit-approved-'));
  const outside = mkdtempSync(join(tmpdir(), 'session-audit-outside-'));
  const trace = join(outside, 'trace.jsonl');
  writeFileSync(trace, '{}\n');
  await assert.rejects(() => auditSessions({ sessionPaths: [trace], approvedRoots: [approved] }), /outside approved roots/u);
  const link = join(approved, 'link.jsonl');
  symlinkSync(trace, link);
  await assert.rejects(() => auditSessions({ sessionPaths: [link], approvedRoots: [approved] }), /non-symlink/u);
});

test('session audit accepts regular files only and enforces the trace count limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-types-'));
  const directory = join(root, 'directory.jsonl');
  mkdirSync(directory);
  await assert.rejects(() => auditSessions({ sessionPaths: [directory], approvedRoots: [root] }), /regular non-symlink/u);
  const paths = Array.from({ length: 33 }, (_, index) => join(root, `${index}.jsonl`));
  paths.forEach(path => writeFileSync(path, '{}\n'));
  await assert.rejects(() => auditSessions({ sessionPaths: paths, approvedRoots: [root] }), /file limit/u);
});

test('session audit excludes its own declared output and compares structured validations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-self-'));
  const trace = join(root, 'output.jsonl');
  writeFileSync(trace, `${JSON.stringify({ command: 'node --check src/change.mjs', exit_code: 0 })}\n`);
  const report = await auditSessions({
    sessionPaths: [trace], approvedRoots: [root], outputPath: trace,
    mission: { mission_id: 'mission', skill_id: 'skill', file_scope: [], validations: [{ executable: 'node', args: ['--check', 'src/change.mjs'] }] },
  });
  assert.ok(report.signals.includes('self-traces-excluded'));
  assert.ok(report.signals.includes('validations-missing'));
  assert.match(report.validations[0].diagnostic, /files=0/u);
});
