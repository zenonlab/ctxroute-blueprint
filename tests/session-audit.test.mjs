import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditSessions } from '../scripts/session-audit.mjs';

test('session audit streams bounded traces, redacts secrets, and detects defective evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-'));
  const path = join(root, 'defective.jsonl');
  writeFileSync(path, [
    JSON.stringify({ mission_id: 'mission-one', skill_id: 'wrong-skill', token: 'must-not-leak', file_path: 'outside/file.mjs' }),
    JSON.stringify({ exit_code: 1, command: 'npm test', message: 'password=must-not-leak' }),
  ].join('\n'));
  const report = await auditSessions({ sessionPaths: [path], mission: { mission_id: 'mission-one', skill_id: 'expected-skill', file_scope: ['src/'], validation_commands: ['npm test', 'npm run lint'] } });
  assert.ok(report.signals_detected.includes('skill-id-mismatch'));
  assert.ok(report.signals_detected.includes('files-outside-scope:1'));
  assert.ok(report.signals_detected.includes('validations-missing:1'));
  assert.ok(report.signals_detected.includes('validations-failed:1'));
  assert.ok(report.signals_detected.some(signal => signal.startsWith('redacted-secret-fields:')));
  assert.doesNotMatch(JSON.stringify(report), /must-not-leak/u);
  assert.equal(report.decision, 'correct-through-orchestrator');
});

test('session audit stops at byte limits without returning raw content', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-audit-bounded-'));
  const path = join(root, 'large.jsonl');
  writeFileSync(path, `${JSON.stringify({ message: 'x'.repeat(1000) })}\n`);
  const report = await auditSessions({ sessionPaths: [path], maxBytes: 32 });
  assert.ok(report.signals_detected.includes('bounded-read-truncated'));
  assert.doesNotMatch(JSON.stringify(report), /xxxxxxxx/u);
});

test('session audit skips traces marked active', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'session-audit-active-'));
  const trace = join(directory, 'active.jsonl');
  writeFileSync(trace, `${JSON.stringify({ mission_id: 'wrong' })}\n`);
  writeFileSync(`${trace}.active`, '1');
  const report = await auditSessions({ sessionPaths: [trace], mission: { mission_id: 'expected', skill_id: 'skill', file_scope: [], validation_commands: [] } });
  assert.deepEqual(report.sessions_examined, []);
  assert.ok(report.signals_detected.includes('active-sessions-skipped:1'));
});
