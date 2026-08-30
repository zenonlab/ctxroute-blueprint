import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProblemStore,
  buildSignatures,
  extractObservation,
  handle,
  normalizeText,
  normalizeStructuralMessage,
  resolveProblem,
} from '../.codex/hooks/problem-memory.mjs';

test('normalization removes volatile values while preserving the cause', () => {
  assert.equal(normalizeText('MODULE_NOT_FOUND at 123 on https://example.test/run/abc'), 'module_not_found at <n> on <url>');
  assert.equal(normalizeStructuralMessage('failed for alpha'), 'failed for <var>');
});

test('problem signatures are deterministic and retain normalized cause in structural matching', () => {
  const first = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for alpha', stack: 'a:1' }, 'PostToolUse');
  const second = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed for beta', stack: 'b:2' }, 'PostToolUse');
  const left = buildSignatures(first);
  const right = buildSignatures(second);
  assert.notEqual(left.exactSignature, right.exactSignature);
  assert.equal(left.structuralSignature, right.structuralSignature);
  const unrelated = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'permission denied' }, 'PostToolUse');
  assert.notEqual(left.structuralSignature, buildSignatures(unrelated).structuralSignature);
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
  assert.match(result.hookSpecificOutput.additionalContext, /approvalRequired/u);
});

test('a recorded resolution is reused on recurrence', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-resolution-'));
  const store = new ProblemStore(directory);
  const observation = extractObservation({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed' }, 'PostToolUse');
  const signatures = buildSignatures(observation);
  const first = store.record(observation, signatures);
  assert.equal(store.resolve(first.id, { type: 'correction', summary: 'Run npm install before retrying' }), true);
  store.close();
  const result = handle(JSON.stringify({ success: false, tool_name: 'npm', error_code: 'EFAIL', error: 'failed' }), 'PostToolUse', {
    config: { enabled: true, recordOn: ['PostToolUse'], recurrenceThreshold: 2, protectionMode: 'propose' },
    stateDirectory: directory,
  });
  assert.match(result.hookSpecificOutput.additionalContext, /Run npm install/u);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /approvalRequired/u);
});

test('resolutions can be recorded through the controlled CLI', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-cli-'));
  const store = new ProblemStore(directory);
  const observation = extractObservation({ success: false, tool_name: 'npm', error: 'failed' }, 'PostToolUse');
  const record = store.record(observation, buildSignatures(observation));
  store.close();
  const output = execFileSync(process.execPath, ['.codex/hooks/problem-memory.mjs', 'resolve', String(record.id), JSON.stringify({ type: 'correction', summary: 'Keep the lockfile pinned' })], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, CTXROUTE_STATE_DIR: directory },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), { resolved: true });
  const check = new ProblemStore(directory);
  assert.equal(JSON.parse(check.get(record.id).resolution_json).summary, 'Keep the lockfile pinned');
  check.close();
});

test('approved persistent instructions create a scoped CTXRoute rule', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-protection-'));
  const store = new ProblemStore(directory);
  const observation = extractObservation({ success: false, tool_name: 'npm', error: 'failed' }, 'PostToolUse');
  const record = store.record(observation, buildSignatures(observation));
  store.close();
  const artifact = resolveProblem(record.id, {
    type: 'persistent-instruction',
    approved: true,
    summary: 'Check the lockfile before retrying.',
    scope: { paths: ['package-lock.json'], events: ['PreToolUse'], tools: ['Edit'] },
  }, directory, directory);
  const artifactPath = join(directory, '.claude', 'hooks', 'docs', 'problem-memory', `problem-${record.id}.md`);
  assert.equal(artifact, true);
  assert.equal(existsSync(artifactPath), true);
  assert.match(readFileSync(artifactPath, 'utf8'), /package-lock\.json/u);
  assert.match(readFileSync(artifactPath, 'utf8'), /Check the lockfile/u);
});

test('persistent instructions cannot be written without approval', () => {
  const directory = mkdtempSync(join(tmpdir(), 'problem-memory-unapproved-'));
  const store = new ProblemStore(directory);
  const observation = extractObservation({ success: false, error: 'failed' }, 'PostToolUse');
  const record = store.record(observation, buildSignatures(observation));
  store.close();
  assert.throws(() => resolveProblem(record.id, { type: 'persistent-instruction', summary: 'Do this' }, directory), /approved/u);
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
