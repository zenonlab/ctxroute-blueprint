import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const rank = { SAFE: 0, WARN: 1, UNSAFE: 2, ERROR: 3 };
const grammars = new Map([
  ['.js', JavaScript], ['.jsx', JavaScript], ['.mjs', JavaScript], ['.cjs', JavaScript],
  ['.ts', TypeScript.typescript], ['.tsx', TypeScript.tsx], ['.py', Python],
]);

export function analyzePaths(paths, { root = process.cwd(), config = defaultConfig(root) } = {}) {
  const diagnostics = [];
  const configurationErrors = validateConfig(config);
  if (configurationErrors.length) {
    diagnostics.push(...configurationErrors);
    return { schemaVersion: 1, verdict: 'ERROR', diagnostics };
  }
  if (!paths.length) diagnostics.push(diagnostic('', null, 'sensor/no-input', 'ERROR', 'At least one source path is required.'));
  const sharedState = { sqlExports: collectDynamicExports(paths, root) };
  for (const path of [...paths].sort()) analyzePath(path, root, config, diagnostics, sharedState);
  diagnostics.sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  const verdict = diagnostics.reduce((current, item) => rank[item.severity] > rank[current] ? item.severity : current, 'SAFE');
  return { schemaVersion: 1, verdict, diagnostics };
}

export function analyzeSource(path, source, { config = {}, state } = {}) {
  const extension = extname(path).toLowerCase();
  const diagnostics = [];
  const grammar = grammars.get(extension);
  if (grammar) analyzeAst(path, source, grammar, config, diagnostics, state);
  else if (extension === '.sql') analyzeSql(path, source, diagnostics, config);
  else if (extension === '.html' || extension === '.htm') analyzeHtml(path, source, diagnostics);
  else if (extension === '.css' || extension === '.scss' || extension === '.sass') analyzeCss(path, source, diagnostics);
  else diagnostics.push(diagnostic(path, null, 'sensor/unsupported-language', 'ERROR', `Unsupported source extension: ${extension || '(none)'}.`));
  return diagnostics;
}

function analyzePath(path, root, config, diagnostics, sharedState) {
  try {
    const source = readFileSync(resolve(root, path), 'utf8');
    diagnostics.push(...analyzeSource(path, source, { config, state: { ...sharedState, importedSqlFunctions: collectImportedNames(source) } }));
  }
  catch (error) { diagnostics.push(diagnostic(path, null, 'sensor/read-error', 'ERROR', error.message)); }
}

function analyzeAst(path, source, grammar, config, diagnostics, inheritedState) {
  const parser = new Parser(); parser.setLanguage(grammar); const tree = parser.parse(source);
  if (tree.rootNode.hasError) diagnostics.push(diagnostic(path, firstError(tree.rootNode), 'sensor/syntax-error', 'ERROR', 'Source contains a syntax error.'));
  let count = 0; let maxDepth = 0; const state = inheritedState ?? { sqlVariables: new Set(), sqlFunctions: new Set(), sqlExports: new Set(), importedSqlFunctions: new Set() };
  state.sqlVariables ??= new Set(); state.sqlFunctions ??= new Set(); state.sqlExports ??= new Set(); state.importedSqlFunctions ??= new Set();
  walk(tree.rootNode, 0, (node, depth) => { count += 1; maxDepth = Math.max(maxDepth, depth); inspectAst(path, source, node, diagnostics, config, state); });
  const complexity = config.complexity ?? { maxNodes: 2000, maxDepth: 80 };
  if (count > complexity.maxNodes || maxDepth > complexity.maxDepth) diagnostics.push(diagnostic(path, tree.rootNode, 'sensor/excessive-complexity', 'WARN', `AST complexity ${count} nodes / depth ${maxDepth} exceeds ${complexity.maxNodes} / ${complexity.maxDepth}.`));
}

function inspectAst(path, source, node, diagnostics, config, state) {
  const text = source.slice(node.startIndex, node.endIndex);
  if (node.type === 'variable_declarator' || node.type === 'assignment_expression') {
    const left = node.childForFieldName('name')?.text ?? node.childForFieldName('left')?.text ?? '';
    if (left && looksLikeDynamicSql(text)) state.sqlVariables.add(left);
  }
  if (node.type === 'function_declaration' || node.type === 'function_definition') {
    const name = node.childForFieldName('name')?.text ?? '';
    if (name && looksLikeDynamicSql(text)) state.sqlFunctions.add(name);
  }
  if (node.type === 'call_expression' || node.type === 'call') {
    const name = node.childForFieldName('function')?.text ?? '';
    if (name === 'eval') diagnostics.push(diagnostic(path, node, 'sensor/dynamic-eval', 'UNSAFE', 'Dynamic eval execution is forbidden.'));
    if (name === 'console.log' || name === 'console.debug') diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/debug-output', 'WARN', 'Debug output should not ship in production code.'));
    if (isShell(name)) {
      const first = node.childForFieldName('arguments')?.namedChild(0); const command = literal(first, source).toLowerCase();
      if (command && (config.dangerousCommands ?? []).some(value => command.includes(value))) diagnostics.push(diagnostic(path, node, 'sensor/dangerous-shell-command', 'UNSAFE', 'Dangerous shell command detected.'));
      if (/shell\s*:\s*true|shell\s*=\s*True/u.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/shell-true', 'UNSAFE', 'Shell execution with shell=true is forbidden.'));
    }
    if (isNetwork(name) && /process\.env|import\.meta\.env|os\.environ|os\.getenv|environ\s*\[/u.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/secret-network-flow', 'UNSAFE', 'A secret source reaches a network output.'));
    const firstArgument = node.childForFieldName('arguments')?.namedChild(0);
    const firstArgumentName = firstArgument?.text ?? '';
    const calledBuilder = firstArgument?.childForFieldName('function')?.text ?? firstArgumentName.split('(')[0];
    const dynamicBuilder = state.sqlFunctions.has(calledBuilder) || (state.sqlExports.has(calledBuilder) && state.importedSqlFunctions.has(calledBuilder));
    if (isSqlSink(name, config) && (looksLikeDynamicSql(text) || state.sqlVariables.has(firstArgumentName) || dynamicBuilder)) diagnostics.push(diagnostic(path, node, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
    if (isSqlSink(name, config) && config.sql?.requireLimit && looksLikeSql(text) && !hasSqlLimit(text)) diagnostics.push(diagnostic(path, node, 'sensor/sql-unbounded-query', 'WARN', `SQL query has no LIMIT clause; bound result size to ${config.sql.maxRows ?? 1000} rows.`));
    if (isSqlSink(name, config) && config.sql?.requireMutationFilter && isUnfilteredMutation(text)) diagnostics.push(diagnostic(path, node, 'sensor/sql-unfiltered-mutation', 'UNSAFE', 'UPDATE or DELETE query has no WHERE filter; require an explicit mutation predicate.'));
  }
  if (node.type === 'new_expression' && node.childForFieldName('constructor')?.text === 'Function') diagnostics.push(diagnostic(path, node, 'sensor/dynamic-function', 'UNSAFE', 'Dynamic Function construction is forbidden.'));
  if (node.type === 'debugger_statement') diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/debugger', 'WARN', 'Debugger statements should not ship in production code.'));
  if (node.type === 'catch_clause' && !node.namedChildren.some(child => child.type !== 'identifier')) diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/empty-catch', 'WARN', 'Empty catch blocks hide failures and should be handled explicitly.'));
  if (node.type === 'assignment_expression' && /(?:innerHTML|outerHTML)\s*=/u.test(text) && /<(?:style|script)\b|style\s*=/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/ui-mixed-markup', 'WARN', 'HTML/CSS is embedded in a runtime string; keep UI structure and styles in their respective layers.'));
}

function analyzeSql(path, source, diagnostics, config = {}) {
  const code = maskSql(source);
  for (const match of code.matchAll(/(?:select|insert|update|delete|where|from)[\s\S]{0,180}(?:\+|\|\||\$\{)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  for (const match of code.matchAll(/\b(?:execute|query|prepare)\s*\([^\n;]*(?:\$\{|\+|\|\|)[^\n;]*\)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  if (config.sql?.requireLimit && /\b(?:select|update|delete)\b/iu.test(code) && !hasSqlLimit(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unbounded-query', 'WARN', `SQL query has no LIMIT clause; bound result size to ${config.sql.maxRows ?? 1000} rows.`));
  if (config.sql?.requireMutationFilter && isUnfilteredMutation(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unfiltered-mutation', 'UNSAFE', 'UPDATE or DELETE query has no WHERE filter; require an explicit mutation predicate.'));
}
function analyzeHtml(path, source, diagnostics) { const match = source.match(/<style\b[\s\S]*?<\/style\s*>/iu); if (match) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/ui-mixed-markup', 'WARN', 'CSS is embedded in HTML; keep styles in a dedicated stylesheet.')); }
function analyzeCss(path, source, diagnostics) { const code = maskCss(source); const match = code.match(/<\/?(?:html|body|div|style|script)\b/iu); if (match) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/ui-mixed-markup', 'WARN', 'HTML markup is placed in a CSS file; keep structure and styles in their respective layers.')); }
function maskSql(source) { return source.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/gu, match => match.replace(/[^\n]/gu, ' ')); }
function maskCss(source) { return source.replace(/\/\*[\s\S]*?\*\/|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/gu, match => match.replace(/[^\n]/gu, ' ')); }
function defaultConfig(root) {
  try { return JSON.parse(readFileSync(resolve(root, '.project/sensor-rules.json'), 'utf8')); }
  catch (error) { return { __sensorConfigError: error.message }; }
}
function collectDynamicExports(paths, root) {
  const exports = new Set();
  for (const path of paths) {
    const grammar = grammars.get(extname(path).toLowerCase());
    if (!grammar) continue;
    try {
      const source = readFileSync(resolve(root, path), 'utf8'); const parser = new Parser(); parser.setLanguage(grammar); const tree = parser.parse(source);
      walk(tree.rootNode, 0, node => {
        if ((node.type === 'function_declaration' || node.type === 'variable_declarator') && isExported(node) && looksLikeDynamicSql(source.slice(node.startIndex, node.endIndex))) exports.add(node.childForFieldName('name')?.text ?? '');
      });
    } catch { /* the normal scan emits the authoritative read/syntax diagnostic */ }
  }
  exports.delete(''); return exports;
}
function isExported(node) { let parent = node.parent; while (parent) { if (parent.type === 'export_statement') return true; if (parent.type === 'program' || parent.type === 'module') return false; parent = parent.parent; } return false; }
function collectImportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}|\bfrom\s+[A-Za-z0-9_./-]+\s+import\s+([^\n]+)/gu)) {
    for (const item of (match[1] ?? match[2]).split(',')) names.add((item.trim().split(/\s+as\s+/iu).at(-1) ?? '').trim());
  }
  return names;
}
function validateConfig(config) {
  if (config?.__sensorConfigError) return [diagnostic('.project/sensor-rules.json', null, 'sensor/configuration', 'ERROR', `Sensor rules could not be loaded: ${config.__sensorConfigError}`)];
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) errors.push('configuration must be an object');
  else {
    if (config.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
    if (!Array.isArray(config.dangerousCommands) || config.dangerousCommands.some(value => typeof value !== 'string')) errors.push('dangerousCommands must be an array of strings');
    if (config.complexity && (!Number.isInteger(config.complexity.maxNodes) || !Number.isInteger(config.complexity.maxDepth) || config.complexity.maxNodes < 1 || config.complexity.maxDepth < 1)) errors.push('complexity.maxNodes and complexity.maxDepth must be positive integers');
    if (config.sql) {
      if (!Array.isArray(config.sql.sinks) || config.sql.sinks.some(value => typeof value !== 'string' || !value)) errors.push('sql.sinks must be a non-empty array of strings');
      if (config.sql.requireLimit !== undefined && typeof config.sql.requireLimit !== 'boolean') errors.push('sql.requireLimit must be boolean');
      if (config.sql.requireMutationFilter !== undefined && typeof config.sql.requireMutationFilter !== 'boolean') errors.push('sql.requireMutationFilter must be boolean');
      if (config.sql.maxRows !== undefined && (!Number.isInteger(config.sql.maxRows) || config.sql.maxRows < 1)) errors.push('sql.maxRows must be a positive integer');
    }
  }
  return errors.map(message => diagnostic('.project/sensor-rules.json', null, 'sensor/configuration', 'ERROR', message));
}
function looksLikeSql(text) { return /\b(?:select|insert|update|delete)\b/iu.test(text); }
function hasSqlLimit(text) { return /\blimit\s+(?:\d+\b|\?|[$:](?:\d+|[A-Za-z_]\w*)\b)/iu.test(text); }
function isUnfilteredMutation(text) { return /\b(?:update\b[\s\S]+?set|delete\s+from\b)[\s\S]*\b(?:where|using)\b/iu.test(text) ? false : /\b(?:update\b[\s\S]+?set|delete\s+from)\b/iu.test(text); }
function looksLikeDynamicSql(text) { return looksLikeSql(text) && /\+|\|\||\$\{|\bf['"]|\.format\s*\(/u.test(text); }
function isSqlSink(name, config) { const sinks = config.sql?.sinks ?? ['query', 'execute', 'prepare', 'raw', 'exec', 'rawQuery', 'raw_sql', 'execute_sql', '$queryRawUnsafe', '$executeRawUnsafe']; return sinks.some(sink => name === sink || name.endsWith(`.${sink}`)); }
function walk(node, depth, visit) { visit(node, depth); for (const child of node.namedChildren) walk(child, depth + 1, visit); }
function firstError(node) { if (node.isError || node.isMissing) return node; for (const child of node.namedChildren) { const result = firstError(child); if (result) return result; } return node; }
function literal(node, source) { if (!node || !['string', 'template_string'].includes(node.type)) return ''; return source.slice(node.startIndex, node.endIndex).replace(/^['"`]|['"`]$/gu, ''); }
function isShell(name) { return /(?:^|\.)(?:exec|execSync|spawn|spawnSync|system|popen|run)$/u.test(name); }
function isNetwork(name) { return /^(?:fetch|axios(?:\.[a-z]+)?|https?\.(?:request|get)|requests\.(?:get|post|put|patch|delete))$/u.test(name); }
function diagnostic(path, node, rule, severity, message) { return { path, line: (node?.startPosition.row ?? -1) + 1, column: (node?.startPosition.column ?? -1) + 1, rule, severity, message }; }
function lineDiagnostic(path, source, index, rule, severity, message) { const before = source.slice(0, index); return { path, line: before.split('\n').length, column: index - before.lastIndexOf('\n'), rule, severity, message }; }
