import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encode } from 'gpt-tokenizer';
import { CONTEXT_TOOL_NAMES } from '../scripts/context-mcp.mjs';
import { ContextError, findDefinition, findReferences, getRelevantContext, listSymbols, maskErbRuby, summarizeFile } from '../scripts/context-ast.mjs';

test('Context tool names are public and remain separate from Progress', () => {
  assert.deepEqual([...CONTEXT_TOOL_NAMES].sort(), ['find_definition', 'find_references', 'get_relevant_context', 'list_symbols', 'summarize_file']);
  assert.equal(CONTEXT_TOOL_NAMES.some(name => name.startsWith('progress_')), false);
});

test('AST context returns structure with exact embedded offsets and no source body', () => {
  const javascript = listSymbols('.githooks/sensor-engine.mjs');
  assert.equal(javascript.data.language, 'javascript');
  assert.equal(javascript.mode, 'AST');
  assert.equal(javascript.grammar, 'tree-sitter-javascript');
  assert.ok(javascript.data.symbols.some(item => item.name === 'analyzePaths'));
  assert.equal('source' in javascript.data, false);
  const ruby = listSymbols('tests/context-ast.test.mjs');
  assert.equal(ruby.data.language, 'javascript');
  assert.equal(ruby.mode, 'AST');
  assert.equal(ruby.grammar, 'tree-sitter-javascript');
  const source = 'before 😀\n<% def helper_name; end %>\nafter\n';
  assert.equal(maskErbRuby(source).length, source.length);
  assert.equal(maskErbRuby(source).split('\n').length, source.split('\n').length);
});

test('all response envelopes use deterministic tokenizer budgets', () => {
  const values = [
    listSymbols('.githooks/sensor-engine.mjs', process.cwd(), 180),
    summarizeFile('.githooks/sensor-engine.mjs', process.cwd(), 180),
    findDefinition('analyzePaths', '.githooks', process.cwd(), 'blueprint', 180),
    findReferences('analyzePaths', '.githooks', process.cwd(), 'blueprint', 180),
    getRelevantContext('sensor analysis', ['.githooks'], 180, process.cwd(), 'blueprint'),
  ];
  for (const value of values) {
    assert.equal(value.schemaVersion, 1);
    assert.equal(value.tokenizer, 'gpt-tokenizer@4.0.0');
    assert.ok(value.estimatedTokens <= 180);
    assert.equal(value.estimatedTokens, encode(JSON.stringify(value)).length);
    assert.equal('source' in value.data, false);
  }
  assert.equal(values.some(value => value.truncated), true);
});

test('path guard rejects absolute paths, traversal, outbound symlinks, ignored and generated files', () => {
  const fixture = workspaceFixture();
  writeFileSync(join(fixture, '.gitignore'), '*.log\n!keep.log\ncache/**\n');
  writeFileSync(join(fixture, 'ignored.log'), 'const ignored = true;');
  writeFileSync(join(fixture, 'keep.log'), 'const kept = true;');
  mkdirSync(join(fixture, 'cache')); writeFileSync(join(fixture, 'cache', 'hidden.js'), 'const hidden = true;');
  mkdirSync(join(fixture, 'build')); writeFileSync(join(fixture, 'build', 'generated.js'), 'const generated = true;');
  const outside = join(mkdtempSync(join(tmpdir(), 'context-outside-')), 'outside.rb'); writeFileSync(outside, 'class Outside; end');
  symlinkSync(outside, join(fixture, 'app', 'outside.rb'));
  for (const path of [outside, '../outside.rb', 'app/outside.rb', 'ignored.log', 'cache/hidden.js', 'build/generated.js']) {
    assert.throws(() => summarizeFile(path, fixture), ContextError, path);
  }
  assert.throws(() => summarizeFile('keep.log', fixture), error => error.code === 'GRAMMAR_UNAVAILABLE');
});

test('product and blueprint scopes are strict and mixed requests are rejected', () => {
  const fixture = workspaceFixture();
  writeFileSync(join(fixture, 'app', 'product.rb'), 'class ProductThing; end');
  mkdirSync(join(fixture, 'scripts')); writeFileSync(join(fixture, 'scripts', 'blueprint.js'), 'export function blueprintThing() {}');
  const product = findDefinition('ProductThing', undefined, fixture, 'product');
  const blueprint = findDefinition('blueprintThing', undefined, fixture, 'blueprint');
  assert.equal(product.scope, 'product'); assert.equal(product.data.matches[0].path, 'app/product.rb');
  assert.equal(blueprint.scope, 'blueprint'); assert.equal(blueprint.data.matches[0].path, 'scripts/blueprint.js');
  assert.throws(() => getRelevantContext('thing', ['app', 'scripts'], 500, fixture, 'product'), error => error.code === 'MIXED_SCOPE');
  assert.throws(() => findDefinition('blueprintThing', 'scripts', fixture, 'product'), error => error.code === 'SCOPE_MISMATCH');
});

test('definitions and references are syntax-aware across JS, TS, Python, Ruby, Minitest, and ERB', () => {
  const fixture = workspaceFixture();
  const sources = {
    'app/value.js': 'export function jsValue() {}\njsValue();\n"jsValue";\n',
    'app/value.ts': 'export function tsValue(): void {}\ntsValue();\n// tsValue\n',
    'app/value.py': 'def py_value():\n    return 1\npy_value()\n"py_value"\n',
    'app/value.rb': 'VALUE_CONST = 1\ndef ruby_value; end\nruby_value\n"ruby_value"\n',
    'app/value_test.rb': 'class ValueTest < Minitest::Test\n  test "works" do\n    ruby_value\n  end\nend\n',
    'app/value.html.erb': '😀 <% def erb_value; end %>\n<%= erb_value %>\n',
  };
  for (const [path, source] of Object.entries(sources)) writeFileSync(join(fixture, path), source);
  for (const [symbol, path, referenceLine] of [['jsValue', 'app/value.js', 2], ['tsValue', 'app/value.ts', 2], ['py_value', 'app/value.py', 3], ['ruby_value', 'app/value.rb', 3], ['erb_value', 'app/value.html.erb', 2]]) {
    const definitions = findDefinition(symbol, path, fixture, 'product').data.matches;
    const references = findReferences(symbol, path, fixture, 'product').data.references;
    assert.equal(definitions.length, 1, symbol);
    assert.deepEqual(references.map(item => item.line), [referenceLine], symbol);
  }
  assert.equal(findDefinition('erb_value', 'app/value.html.erb', fixture, 'product').data.matches[0].column, 11);
  const tests = listSymbols('app/value_test.rb', fixture).data.symbols;
  assert.ok(tests.some(item => item.name === 'test works' && item.line === 2));
  assert.ok(listSymbols('app/value.rb', fixture).data.symbols.some(item => item.name === 'VALUE_CONST' && item.kind === 'constant'));
});

test('invalid syntax and unavailable grammars are explicit Context errors', () => {
  const fixture = workspaceFixture();
  writeFileSync(join(fixture, 'app', 'broken.rb'), 'def broken(\n');
  assert.throws(() => summarizeFile('app/broken.rb', fixture), error => error.code === 'SYNTAX_ERROR');
  writeFileSync(join(fixture, 'app', 'plain.php'), '<?php echo 1;');
  assert.throws(() => summarizeFile('app/plain.php', fixture), error => error.code === 'GRAMMAR_UNAVAILABLE');
  assert.throws(() => summarizeFile('app/broken.rb', fixture, 500, { grammarLoader() { throw new Error('simulated grammar absence'); } }), error => error.code === 'GRAMMAR_UNAVAILABLE' && error.details.fallbackReason === 'simulated grammar absence');
});

test('files larger than Tree-sitter default input buffer are parsed in full', () => {
  const root = workspaceFixture();
  writeFileSync(join(root, 'app', 'large.js'), `${'// padding for parser input buffer\n'.repeat(1200)}\nexport function finalSymbol() { return 1; }\n`);
  const response = listSymbols('app/large.js', root, 1200);
  assert.equal(response.data.symbols.some(symbol => symbol.name === 'finalSymbol'), true);
  assert.equal(response.mode, 'AST');
});

function workspaceFixture() {
  const root = mkdtempSync(join(tmpdir(), 'context-workspace-'));
  mkdirSync(join(root, '.project')); mkdirSync(join(root, 'app'));
  writeFileSync(join(root, '.gitignore'), '');
  writeFileSync(join(root, '.project', 'project-config.json'), JSON.stringify({ directories: { generated: ['build/'] }, starter: { infrastructureRoots: ['scripts/', '.project/'], rootFiles: ['README.md'] } }));
  return root;
}
