import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProblemStore,
  buildSignatures,
  extractObservation,
  handle,
  normalizeText,
  normalizeStructuralMessage,
} from '../.codex/hooks/problem-memory.mjs';

test('normalization removes volatile values while preserving the cause', () => {
  assert.equal(normalizeText('MODULE_NOT_FOUND at 123 on https://example.test/run/abc'), 'module_not_found at <n> on <url>');
  assert.equal(normalizeStructuralMessage('failed for alpha'), 'failed for <var>');
});

test('problem signatures are deterministic and separate structural context from stack noise', () => {
  const first = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for alpha', stack: 'a:1' }, 'PostToolUse');
  const second = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for beta', stack: 'b:2' }, 'PostToolUse');
  const left = buildSignatures(first);
  const right = buildSignatures(second);
  assert.notEqual(left.exactSignature, right.exactSignature);
  assert.equal(left.structuralSignature, right.structuralSignature);
});

test('ordinary prompts are ignored unless explicitly marked as problems', () => {
  assert.equal(extractObservation({ prompt: 'Please add a feature' }, 'UserPromptSubmit'), null);
  assert.ok(extractObservation({ problem_detected: true, prompt: 'The same bug happened again' }, 'UserPromptSubmit'));
});

test('stored evidence is bounded and redacts sensitive fields', () => {
  const observation = extractObservation({ success: false, error: 'failed', api_key: 'secret-value', nested: { password: 'hidden' } }, 'PostToolUse');
  assert.equal(observation.evidence.api_key, undefined);
  assert.equal(observation.evidence.nested.password, undefined);
});

test('the store records first occurrence and retains evidence for recurrences', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-'));
  const store = new ProblemStore(directory);
  const observation = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for alpha' }, 'PostToolUse');
  const signatures = buildSignatures(observation);
  const first = store.record(observation, signatures, '2026-08-30T00:00:00.000Z');
  const second = store.record({ ...observation, message: 'failed for beta', evidence: { marker: 2 } }, buildSignatures({ ...observation, message: 'failed for beta' }), '2026-08-30T00:01:00.000Z');
  assert.equal(first.match, 'new');
  assert.equal(second.match, 'structural');
  assert.equal(second.occurrences, 2);
  const row = store.database.prepare('SELECT evidence_json FROM problems WHERE id = ?').get(first.id);
  assert.equal(JSON.parse(row.evidence_json).length, 2);
  store.close();
});

test('handle emits a proposal only at the configured recurrence threshold', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-threshold-'));
  const config = { enabled: true, recordOn: ['PostToolUse'], recurrenceThreshold: 2, protectionMode: 'propose' };
  const input = JSON.stringify({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed' });
  assert.equal(handle(input, 'PostToolUse', { config, stateDirectory: directory }), null);
  const result = handle(input, 'PostToolUse', { config, stateDirectory: directory });
  assert.match(result.systemMessage, /Recurring problem recognized/u);
  assert.match(result.hookSpecificOutput.additionalContext, /problemId/u);
});

test('the hook fails open when disabled', () => {
  const result = handle(JSON.stringify({ success: false, error: 'failed' }), 'PostToolUse', { config: { enabled: false } });
  assert.equal(result, null);
});

test('structural matching can be disabled without changing exact matching', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-no-structural-'));
  const config = { enabled: true, recordOn: ['PostToolUse'], recurrenceThreshold: 2, matching: { structuralMatch: false }, protectionMode: 'propose' };
  const input = JSON.stringify({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for alpha' });
  assert.equal(handle(input, 'PostToolUse', { config, stateDirectory: directory }), null);
  assert.equal(handle(JSON.stringify({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for beta' }), 'PostToolUse', { config, stateDirectory: directory }), null);
});
