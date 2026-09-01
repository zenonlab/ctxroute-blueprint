import Parser from 'tree-sitter';
import ignore from 'ignore';
import { encode } from 'gpt-tokenizer';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { extractEmbeddedSource, registryEntry, resolveRegistryEntry } from '../.githooks/ast-registry.mjs';

export { maskErbRuby } from '../.githooks/ast-registry.mjs';

export const CONTEXT_SCHEMA_VERSION = 1;
export const CONTEXT_TOKENIZER = 'gpt-tokenizer@4.0.0';
export const DEFAULT_CONTEXT_TOKENS = 1200;
const MIN_CONTEXT_TOKENS = 128;
const definitionTypes = new Set(['class', 'class_declaration', 'class_definition', 'function_declaration', 'function_definition', 'method', 'method_definition', 'singleton_method', 'module', 'interface_declaration', 'type_alias_declaration', 'enum_declaration']);
const referenceTypes = new Set(['identifier', 'constant', 'property_identifier', 'type_identifier']);

export class ContextError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ContextError'; this.code = code; this.details = details; }
}

export function createWorkspacePolicy(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const realRoot = realpathSync(absoluteRoot);
  let config = {};
  try { config = JSON.parse(readFileSync(resolve(absoluteRoot, '.project/project-config.json'), 'utf8')); }
  catch (error) { throw new ContextError('CONFIGURATION_ERROR', `Cannot read project configuration: ${error.message}`); }
  const generated = (config.directories?.generated ?? []).map(normalizeRelativeDirectory);
  const infrastructureRoots = (config.starter?.infrastructureRoots ?? []).map(normalizeRelativeDirectory);
  const rootFiles = new Set(config.starter?.rootFiles ?? []);
  const matcher = ignore();
  try { matcher.add(readFileSync(resolve(absoluteRoot, '.gitignore'), 'utf8')); } catch { /* a repository may intentionally have no .gitignore */ }
  return { root: absoluteRoot, realRoot, config, generated, infrastructureRoots, rootFiles, matcher };
}

export function guardWorkspacePath(path, policy, { mustExist = true, allowIgnored = false } = {}) {
  if (typeof path !== 'string' || !path.trim()) throw new ContextError('INVALID_PATH', 'A non-empty repository-relative path is required.');
  const portable = path.replaceAll('\\', '/');
  if (isAbsolute(path) || portable.startsWith('/') || /^[A-Za-z]:\//u.test(portable)) throw new ContextError('ABSOLUTE_PATH', `Absolute paths are not allowed: ${path}`);
  if (portable.split('/').includes('..')) throw new ContextError('PATH_TRAVERSAL', `Parent traversal is not allowed: ${path}`);
  const absolute = resolve(policy.root, portable);
  if (!isInside(policy.root, absolute)) throw new ContextError('PATH_ESCAPE', `Path leaves the workspace: ${path}`);
  if (mustExist && !existsSync(absolute)) throw new ContextError('PATH_NOT_FOUND', `Path does not exist: ${path}`);
  let real = absolute;
  if (existsSync(absolute)) {
    real = realpathSync(absolute);
    if (!isInside(policy.realRoot, real)) throw new ContextError('SYMLINK_ESCAPE', `Symlink target leaves the workspace: ${path}`);
  }
  const rel = toPortable(relative(policy.root, absolute)) || '.';
  if (rel !== '.' && isGenerated(rel, policy)) throw new ContextError('GENERATED_PATH', `Generated paths are excluded from context: ${rel}`);
  if (!allowIgnored && rel !== '.' && policy.matcher.ignores(rel)) throw new ContextError('IGNORED_PATH', `Git-ignored paths are excluded from context: ${rel}`);
  return { absolute, real, relative: rel };
}

export function scopeForPath(path, policy) {
  const rel = toPortable(path);
  if (policy.rootFiles.has(rel)) return 'blueprint';
  return policy.infrastructureRoots.some(root => rel === root || rel.startsWith(`${root}/`)) ? 'blueprint' : 'product';
}

export function parseFile(path, root = process.cwd(), options = {}) {
  const policy = options.policy ?? createWorkspacePolicy(root);
  const guarded = guardWorkspacePath(path, policy);
  if (!lstatSync(guarded.absolute).isFile()) throw new ContextError('NOT_A_FILE', `Expected a file path: ${guarded.relative}`);
  const entry = resolveRegistryEntry(guarded.relative, options.grammarLoader);
  if (!entry?.package) throw new ContextError('GRAMMAR_UNAVAILABLE', `No AST grammar is declared for ${guarded.relative}.`, { mode: entry?.actualMode ?? 'unsupported', grammar: null });
  if (!entry.grammar) throw new ContextError('GRAMMAR_UNAVAILABLE', entry.fallbackReason ?? `Grammar ${entry.package} is unavailable.`, { mode: entry.actualMode, grammar: null, fallback: entry.fallback, fallbackReason: entry.fallbackReason });
  const source = readFileSync(guarded.absolute, 'utf8');
  const parserSource = extractEmbeddedSource(entry, source);
  const parser = new Parser(); parser.setLanguage(entry.grammar);
  let tree;
  // node-tree-sitter defaults to a 32 KiB input buffer and rejects a string
  // that fills it. Size the buffer from the actual UTF-8 input so repository
  // files are parsed in full instead of failing only because of their length.
  const bufferSize = Math.max(32_768, Buffer.byteLength(parserSource, 'utf8') + 1);
  try { tree = parser.parse(parserSource, undefined, { bufferSize }); }
  catch (error) { throw new ContextError('PARSER_ERROR', `Parser failed for ${guarded.relative}: ${error.message}`, { mode: entry.mode, grammar: entry.package }); }
  if (tree.rootNode.hasError) {
    const node = firstError(tree.rootNode);
    throw new ContextError('SYNTAX_ERROR', `Syntax error in ${guarded.relative} at ${node.startPosition.row + 1}:${node.startPosition.column + 1}.`, { mode: entry.mode, grammar: entry.package, line: node.startPosition.row + 1, column: node.startPosition.column + 1 });
  }
  return { path: guarded.relative, scope: scopeForPath(guarded.relative, policy), source, parserSource, tree, entry, mode: entry.mode, grammar: entry.package, policy };
}

export function listSymbols(path, root = process.cwd(), maxTokens = DEFAULT_CONTEXT_TOKENS, options = {}) {
  const parsed = parseFile(path, root, options);
  return boundedResponse(symbolData(parsed), metadataFor([parsed]), maxTokens);
}

export function summarizeFile(path, root = process.cwd(), maxTokens = DEFAULT_CONTEXT_TOKENS, options = {}) {
  const parsed = parseFile(path, root, options);
  return boundedResponse(summaryData(parsed), metadataFor([parsed]), maxTokens);
}

export function findDefinition(symbol, path, root = process.cwd(), scope = 'product', maxTokens = DEFAULT_CONTEXT_TOKENS, options = {}) {
  const parsedFiles = parseScopeFiles(root, path ? [path] : null, scope, options);
  const matches = [];
  for (const parsed of parsedFiles) for (const item of extractSymbols(parsed)) if (item.name === symbol) matches.push({ path: parsed.path, ...item, mode: parsed.mode, grammar: parsed.grammar });
  return boundedResponse({ symbol, matches }, metadataFor(parsedFiles, scope), maxTokens);
}

export function findReferences(symbol, path, root = process.cwd(), scope = 'product', maxTokens = DEFAULT_CONTEXT_TOKENS, options = {}) {
  const parsedFiles = parseScopeFiles(root, path ? [path] : null, scope, options);
  const references = [];
  for (const parsed of parsedFiles) {
    walk(parsed.tree.rootNode, node => {
      if (node.text !== symbol || !referenceTypes.has(node.type) || isDefinitionName(node) || isImportBinding(node) || isAssignmentTarget(node)) return;
      references.push({ path: parsed.path, line: node.startPosition.row + 1, column: node.startPosition.column + 1, kind: node.type, mode: parsed.mode, grammar: parsed.grammar });
    });
  }
  return boundedResponse({ symbol, references }, metadataFor(parsedFiles, scope), maxTokens);
}

export function getRelevantContext(query, paths, maxTokens = DEFAULT_CONTEXT_TOKENS, root = process.cwd(), scope = 'product', options = {}) {
  const parsedFiles = parseScopeFiles(root, paths?.length ? paths : null, scope, options);
  const terms = String(query).toLowerCase().split(/\W+/u).filter(Boolean);
  const candidates = parsedFiles.map(parsed => {
    const summary = summaryData(parsed);
    const haystack = JSON.stringify(summary).toLowerCase();
    const score = terms.reduce((total, term) => total + countOccurrences(haystack, term), 0);
    return { score, summary };
  }).filter(item => item.score > 0).sort((left, right) => right.score - left.score || left.summary.path.localeCompare(right.summary.path));
  return boundedResponse({ query, items: candidates }, metadataFor(parsedFiles, scope), maxTokens);
}

export function collectFiles(root = process.cwd(), path, scope = 'product', options = {}) {
  const policy = options.policy ?? createWorkspacePolicy(root);
  const guarded = path ? guardWorkspacePath(path, policy) : { absolute: policy.root, relative: '.' };
  const files = [];
  const seenDirectories = new Set();
  const addFile = absolute => {
    const rel = toPortable(relative(policy.root, absolute));
    if (!rel || isGenerated(rel, policy) || policy.matcher.ignores(rel)) return;
    const entry = registryEntry(rel);
    if (entry?.package && scopeForPath(rel, policy) === scope) files.push(rel);
  };
  const visit = absolute => {
    const real = realpathSync(absolute);
    if (!isInside(policy.realRoot, real)) throw new ContextError('SYMLINK_ESCAPE', `Symlink target leaves the workspace: ${relative(policy.root, absolute)}`);
    const stat = lstatSync(absolute);
    if (stat.isFile() || stat.isSymbolicLink() && lstatSync(real).isFile()) { addFile(absolute); return; }
    if (!lstatSync(real).isDirectory() || seenDirectories.has(real)) return;
    seenDirectories.add(real);
    for (const item of readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = resolve(absolute, item.name);
      const rel = toPortable(relative(policy.root, child));
      if (isGenerated(rel, policy) || policy.matcher.ignores(rel)) continue;
      visit(child);
    }
  };
  visit(guarded.absolute);
  return files.sort();
}

export function boundedResponse(data, metadata, maxTokens = DEFAULT_CONTEXT_TOKENS) {
  if (!Number.isInteger(maxTokens) || maxTokens < MIN_CONTEXT_TOKENS || maxTokens > 10000) throw new ContextError('INVALID_BUDGET', `max_tokens must be an integer from ${MIN_CONTEXT_TOKENS} to 10000.`);
  let boundedData = structuredClone(data);
  let truncated = false;
  let response = responseValue(boundedData, metadata, truncated);
  while (tokenCount(response) > maxTokens) {
    const shrunk = shrinkOnce(boundedData);
    if (!shrunk.changed) { boundedData = { omitted: true }; truncated = true; break; }
    boundedData = shrunk.value;
    truncated = true;
    response = responseValue(boundedData, metadata, truncated);
  }
  response = responseValue(boundedData, metadata, truncated);
  for (let index = 0; index < 4; index += 1) {
    const estimatedTokens = tokenCount(response);
    if (response.estimatedTokens === estimatedTokens) break;
    response.estimatedTokens = estimatedTokens;
  }
  return response;
}

function parseScopeFiles(root, paths, scope, options) {
  if (!['product', 'blueprint'].includes(scope)) throw new ContextError('INVALID_SCOPE', `Unknown context scope: ${scope}`);
  const policy = options.policy ?? createWorkspacePolicy(root);
  if (paths?.length) {
    const requestedScopes = new Set();
    for (const path of paths) {
      const guarded = guardWorkspacePath(path, policy);
      if (lstatSync(guarded.absolute).isFile()) requestedScopes.add(scopeForPath(guarded.relative, policy));
      else for (const candidateScope of ['product', 'blueprint']) if (collectFiles(root, path, candidateScope, { policy }).length) requestedScopes.add(candidateScope);
    }
    if (requestedScopes.size > 1) throw new ContextError('MIXED_SCOPE', 'A context request cannot mix product and blueprint paths.');
    if (requestedScopes.size === 1 && !requestedScopes.has(scope)) throw new ContextError('SCOPE_MISMATCH', `Requested paths belong to the ${[...requestedScopes][0]} scope, not ${scope}.`);
  }
  const files = [...new Set((paths?.length ? paths.flatMap(path => collectFiles(root, path, scope, { policy })) : collectFiles(root, undefined, scope, { policy })))];
  return files.map(file => parseFile(file, root, { ...options, policy }));
}

function symbolData(parsed) { return { path: parsed.path, language: parsed.entry.language, symbols: extractSymbols(parsed) }; }
function summaryData(parsed) {
  const symbols = extractSymbols(parsed);
  const imports = [];
  walk(parsed.tree.rootNode, node => { if (isImport(node, parsed.entry.language)) imports.push(compactSignature(node.text, 120)); });
  return {
    path: parsed.path,
    language: parsed.entry.language,
    bytes: Buffer.byteLength(parsed.source),
    lines: parsed.source.split('\n').length,
    symbols,
    imports: [...new Set(imports)].slice(0, 30),
    constants: symbols.filter(item => item.kind === 'constant').map(item => item.name),
    relations: symbols.map(item => item.name),
  };
}
function extractSymbols(parsed) {
  const symbols = [];
  walk(parsed.tree.rootNode, node => {
    const constant = constantName(node);
    const definition = definitionTypes.has(node.type);
    const minitest = parsed.entry.language === 'ruby' || parsed.entry.language === 'erb' ? minitestName(node) : null;
    if (!definition && !constant && !minitest) return;
    const nameNode = definition ? definitionNameNode(node) : null;
    const name = constant ?? minitest ?? nameNode?.text;
    if (!name) return;
    symbols.push({ name, kind: minitest ? 'test' : constant ? 'constant' : kindFor(node), signature: compactSignature(node.text), line: (nameNode ?? node).startPosition.row + 1, column: (nameNode ?? node).startPosition.column + 1 });
  });
  return symbols;
}
function metadataFor(parsedFiles, requestedScope) {
  const modes = [...new Set(parsedFiles.map(item => item.mode))];
  const grammars = [...new Set(parsedFiles.map(item => item.grammar).filter(Boolean))];
  return { scope: requestedScope ?? parsedFiles[0]?.scope ?? 'product', mode: modes.length === 1 ? modes[0] : modes.length ? 'mixed' : 'AST', grammar: grammars.length === 1 ? grammars[0] : null };
}
function responseValue(data, metadata, truncated) { return { schemaVersion: CONTEXT_SCHEMA_VERSION, scope: metadata.scope, mode: metadata.mode, grammar: metadata.grammar, estimatedTokens: 0, tokenizer: CONTEXT_TOKENIZER, truncated, data }; }
function tokenCount(value) { return encode(JSON.stringify(value)).length; }
function shrinkOnce(value) {
  if (Array.isArray(value)) {
    if (!value.length) return { value, changed: false };
    if (value.length > 1) return { value: value.slice(0, -1), changed: true };
    const child = shrinkOnce(value[0]);
    return child.changed ? { value: [child.value], changed: true } : { value: [], changed: true };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return { value, changed: false };
    const candidates = entries.map(([key, item], index) => ({ key, item, index, size: tokenCount(item) })).sort((a, b) => b.size - a.size || b.index - a.index);
    for (const candidate of candidates) {
      const child = shrinkOnce(candidate.item);
      if (child.changed) return { value: { ...value, [candidate.key]: child.value }, changed: true };
    }
    const last = entries.at(-1)[0]; const copy = { ...value }; delete copy[last]; return { value: copy, changed: true };
  }
  if (typeof value === 'string' && value.length > 8) return { value: `${value.slice(0, Math.max(4, Math.floor(value.length / 2)))}…`, changed: true };
  return { value, changed: false };
}
function definitionNameNode(node) { return node.childForFieldName('name') ?? node.namedChildren.find(child => referenceTypes.has(child.type)); }
function constantName(node) {
  if (!['assignment', 'constant_declaration', 'variable_declarator'].includes(node.type)) return null;
  const name = node.childForFieldName('left')?.text ?? node.childForFieldName('name')?.text ?? node.namedChildren[0]?.text ?? '';
  return /^[A-Z_][A-Z0-9_]*$/u.test(name) ? name : null;
}
function minitestName(node) {
  if (node.type !== 'call') return null;
  const method = node.childForFieldName('method')?.text ?? node.childForFieldName('function')?.text ?? node.namedChildren[0]?.text;
  if (method !== 'test') return null;
  const label = node.namedChildren.find(child => child.type === 'argument_list')?.namedChildren.find(child => /string/u.test(child.type))?.text;
  return label ? `test ${label.replace(/^['"]|['"]$/gu, '')}` : null;
}
function isDefinitionName(node) { return definitionTypes.has(node.parent?.type) && definitionNameNode(node.parent)?.id === node.id; }
function isImportBinding(node) { return /import/u.test(node.parent?.type ?? '') || /import/u.test(node.parent?.parent?.type ?? ''); }
function isAssignmentTarget(node) { const parent = node.parent; return ['assignment', 'assignment_expression', 'variable_declarator'].includes(parent?.type) && (parent.childForFieldName('left')?.id === node.id || parent.childForFieldName('name')?.id === node.id || parent.namedChildren[0]?.id === node.id); }
function isImport(node, language) { return /^(?:import_statement|import_from_statement)$/u.test(node.type) || ((language === 'ruby' || language === 'erb') && node.type === 'call' && /^(?:require|require_relative|load)\b/u.test(node.text)); }
function kindFor(node) { if (/class/u.test(node.type)) return 'class'; if (/module/u.test(node.type)) return 'module'; if (/method/u.test(node.type)) return 'method'; if (/interface/u.test(node.type)) return 'interface'; if (/type_alias/u.test(node.type)) return 'type'; if (/enum/u.test(node.type)) return 'enum'; return 'function'; }
function compactSignature(text, limit = 100) { return text.replace(/\s+/gu, ' ').slice(0, limit); }
function walk(node, visit) { visit(node); for (const child of node.namedChildren) walk(child, visit); }
function firstError(node) { if (node.type === 'ERROR' || node.isMissing) return node; for (const child of node.children) { const found = firstError(child); if (found) return found; } return node; }
function countOccurrences(haystack, needle) { let count = 0; let offset = 0; while ((offset = haystack.indexOf(needle, offset)) >= 0) { count += 1; offset += needle.length || 1; } return count; }
function normalizeRelativeDirectory(value) { return String(value).replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, ''); }
function toPortable(value) { return value.split(sep).join('/'); }
function isInside(root, target) { const rel = relative(root, target); return rel === '' || rel && !rel.startsWith('..') && !isAbsolute(rel); }
function isGenerated(rel, policy) { return rel === '.git' || rel.startsWith('.git/') || rel === 'node_modules' || rel.startsWith('node_modules/') || policy.generated.some(dir => rel === dir || rel.startsWith(`${dir}/`)); }
