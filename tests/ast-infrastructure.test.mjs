import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AST_REGISTRY, grammarStatus } from '../.githooks/ast-registry.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('one registry declares language, grammar, extractor, availability, and fallback policy', () => {
  for (const item of AST_REGISTRY) {
    for (const key of ['language', 'extensions', 'filenames', 'package', 'variant', 'mode', 'extractor', 'available', 'fallbackAllowed', 'fallbackReason']) assert.equal(key in item, true, `${item.id}.${key}`);
  }
  const status = grammarStatus();
  for (const language of ['javascript', 'typescript', 'tsx', 'python', 'ruby', 'erb']) assert.equal(status.find(item => item.language === language)?.available, true, language);
  assert.equal(status.find(item => item.extensions.includes('.php')).mode, 'lexical');
});

test('the AST runtime pipeline cannot import or call LLM and network clients', () => {
  for (const path of ['.githooks/ast-registry.mjs', '.githooks/sensor-engine.mjs', 'scripts/context-ast.mjs', 'scripts/ast-check.mjs']) {
    const source = readFileSync(join(root, path), 'utf8');
    assert.doesNotMatch(source, /(?:from\s+['"](?:node:)?(?:http|https|net|tls)['"]|\bfetch\s*\(|\bOpenAI\b|\bAnthropic\b|api\.openai\.com|api\.anthropic\.com)/u, path);
  }
});

test('ast:update gates mutation behind --apply and keeps exact compatibility evidence', () => {
  const source = readFileSync(join(root, 'scripts/ast-update.mjs'), 'utf8');
  assert.match(source, /if \(!process\.argv\.includes\('--apply'\)\)/u);
  assert.match(source, /--save-exact/u);
  assert.match(source, /runMatrix\(sandbox\)/u);
  const proof = JSON.parse(readFileSync(join(root, '.project/ast-compatibility.json'), 'utf8'));
  assert.deepEqual(proof.matrix, ['javascript', 'typescript', 'tsx', 'python', 'ruby', 'erb']);
  assert.equal(Object.values(proof.packages).every(version => /^\d+\.\d+\.\d+$/u.test(version)), true);
});
