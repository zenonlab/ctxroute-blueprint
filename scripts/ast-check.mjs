import Parser from 'tree-sitter';
import { AST_REGISTRY, checkGrammarCompatibility, extractEmbeddedSource, resolveRegistryEntry } from '../.githooks/ast-registry.mjs';

const fixtures = [
  ['fixture.js', 'export function jsValue() { return 1; }'],
  ['fixture.ts', 'export const tsValue: number = 1;'],
  ['fixture.tsx', 'export const View = () => <main />;'],
  ['fixture.py', 'def py_value():\n    return 1\n'],
  ['fixture.rb', 'class RubyValue\n  def value = 1\nend\n'],
  ['fixture.html.erb', '<% if true %>\n<%= RubyValue.new.value %>\n<% end %>\n'],
];
const compatibility = checkGrammarCompatibility();
const matrix = fixtures.map(([path, source]) => {
  try {
    const entry = resolveRegistryEntry(path);
    if (!entry?.grammar) throw new Error(entry?.fallbackReason ?? 'Grammar is unavailable.');
    const parser = new Parser(); parser.setLanguage(entry.grammar);
    const tree = parser.parse(extractEmbeddedSource(entry, source));
    if (tree.rootNode.hasError) throw new Error('Fixture contains a syntax error.');
    return { language: entry.language, path, mode: entry.mode, grammar: entry.package, compatible: true, error: null };
  } catch (error) { return { path, compatible: false, error: error instanceof Error ? error.message : String(error) }; }
});
const duplicateIds = AST_REGISTRY.map(item => `${item.id}:${item.extensions.join(',')}:${item.filenames.join(',')}`).filter((value, index, values) => values.indexOf(value) !== index);
const result = { runtime: 'tree-sitter@0.21.1', registryEntries: AST_REGISTRY.length, duplicateEntries: duplicateIds, grammars: compatibility, matrix };
console.log(JSON.stringify(result, null, 2));
process.exitCode = compatibility.every(item => item.compatible) && matrix.every(item => item.compatible) && !duplicateIds.length ? 0 : 1;
