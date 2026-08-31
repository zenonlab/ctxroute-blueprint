import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, resolve } from 'node:path';

const rank = { SAFE: 0, WARN: 1, UNSAFE: 2, ERROR: 3 };
export const SENSOR_ADAPTERS = Object.freeze([
  Object.freeze({ id: 'javascript', mode: 'AST', extensions: Object.freeze(['.js', '.jsx', '.mjs', '.cjs']) }),
  Object.freeze({ id: 'typescript', mode: 'AST', extensions: Object.freeze(['.ts', '.tsx']) }),
  Object.freeze({ id: 'python', mode: 'AST', extensions: Object.freeze(['.py']) }),
  Object.freeze({ id: 'sql', mode: 'lexical', extensions: Object.freeze(['.sql']) }),
  Object.freeze({ id: 'html', mode: 'embedded', extensions: Object.freeze(['.html', '.htm']) }),
  Object.freeze({ id: 'css', mode: 'lexical', extensions: Object.freeze(['.css', '.scss', '.sass']) }),
  Object.freeze({ id: 'single-file-component', mode: 'embedded', extensions: Object.freeze(['.vue', '.svelte']) }),
  Object.freeze({ id: 'template', mode: 'embedded', extensions: Object.freeze(['.erb', '.haml', '.slim', '.heex', '.leex', '.j2', '.jinja', '.jinja2', '.twig', '.tera', '.hbs', '.handlebars', '.liquid', '.ejs', '.pug', '.jade', '.cshtml', '.razor', '.jsp', '.jspx']) }),
  Object.freeze({ id: 'lexical-source', mode: 'lexical', filenames: Object.freeze(['Dockerfile', 'Makefile', 'Justfile', 'Gemfile', 'Rakefile', 'config.ru']), extensions: Object.freeze([
    '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.cs',
    '.php', '.rb', '.rake', '.ru', '.swift', '.sh', '.bash', '.zsh', '.dart', '.ex', '.exs', '.erl', '.hrl',
    '.fs', '.fsx', '.fsi', '.hs', '.lhs', '.lua', '.r', '.scala', '.sc', '.clj', '.cljs', '.cljc',
    '.groovy', '.m', '.mm', '.zig', '.nim', '.pl', '.pm', '.t', '.vb', '.vbs', '.v', '.sv',
    '.sol', '.move', '.asm', '.s', '.pas', '.f', '.for', '.f03', '.f90', '.f95'
  ]) }),
  Object.freeze({ id: 'lexical-data', mode: 'lexical', filenames: Object.freeze(['.env', '.env.example', '.env.local']), extensions: Object.freeze([
    '.toml', '.yaml', '.yml', '.json', '.xml', '.proto', '.graphql', '.gql', '.ini', '.cfg',
    '.conf', '.properties', '.env', '.tf', '.tfvars', '.hcl', '.cue', '.dhall', '.nix'
  ]) }),
]);
const adapterByExtension = new Map(SENSOR_ADAPTERS.flatMap(adapter => adapter.extensions.map(extension => [extension, adapter.id])));
const adapterByFilename = new Map(SENSOR_ADAPTERS.flatMap(adapter => (adapter.filenames ?? []).map(filename => [filename, adapter.id])));
const grammars = new Map([
  ['.js', JavaScript], ['.jsx', JavaScript], ['.mjs', JavaScript], ['.cjs', JavaScript],
  ['.ts', TypeScript.typescript], ['.tsx', TypeScript.tsx], ['.py', Python],
]);
const require = createRequire(import.meta.url);
const optionalGrammarCache = new Map();
export const SENSOR_OPTIONAL_PARSERS = Object.freeze([
  Object.freeze({ id: 'ruby-ast', package: 'tree-sitter-ruby', extensions: Object.freeze(['.rb', '.rake', '.ru']) }),
  Object.freeze({ id: 'php-ast', package: 'tree-sitter-php', extensions: Object.freeze(['.php']) }),
]);
export const SENSOR_COVERAGE = Object.freeze({
  moduleScope: 'explicit-paths',
  packageResolution: 'disabled',
  wholeProgramAnalysis: false,
  rateLimitRuntimeProof: false,
});

export function adapterForPath(path) {
  const name = basename(path).toLowerCase();
  if (name.endsWith('.blade.php')) return 'template';
  return adapterByExtension.get(extname(path).toLowerCase()) ?? adapterByFilename.get(basename(path));
}

export function isSupportedSourcePath(path) {
  return Boolean(adapterForPath(path));
}

export function optionalParserStatus() {
  return SENSOR_OPTIONAL_PARSERS.map(parser => ({ ...parser, available: optionalGrammar(parser.extensions[0]) !== null }));
}

export function toSarif(result) {
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'Blueprint Sensor', informationUri: 'https://github.com/dmmulroy/anti-slop', rules: [...new Set(result.diagnostics.map(item => item.rule))].sort().map(id => ({ id })) } },
      results: result.diagnostics.map(item => ({
        ruleId: item.rule,
        level: item.severity === 'UNSAFE' || item.severity === 'ERROR' ? 'error' : 'warning',
        message: { text: item.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: item.path }, region: { startLine: item.line, startColumn: item.column } } }],
      })),
    }],
  };
}

export function analyzePaths(paths, { root = process.cwd(), config = defaultConfig(root) } = {}) {
  const diagnostics = [];
  const configurationErrors = validateConfig(config);
  if (configurationErrors.length) {
    diagnostics.push(...configurationErrors);
    return sensorResult('ERROR', diagnostics);
  }
  if (!paths.length) diagnostics.push(diagnostic('', null, 'sensor/no-input', 'ERROR', 'At least one source path is required.'));
  const uniquePaths = [...new Set(paths)];
  const scannedFiles = new Set(uniquePaths.map(path => resolve(root, path)));
  const sourceCache = new Map();
  const sharedState = { root, scannedFiles, sourceCache, sqlExports: collectDynamicExports(uniquePaths, root, sourceCache) };
  for (const path of [...uniquePaths].sort()) analyzePath(path, root, config, diagnostics, sharedState);
  const stableDiagnostics = dedupeDiagnostics(diagnostics).sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  const verdict = stableDiagnostics.reduce((current, item) => rank[item.severity] > rank[current] ? item.severity : current, 'SAFE');
  return sensorResult(verdict, stableDiagnostics);
}

export function analyzeSource(path, source, { config = {}, state } = {}) {
  const extension = extname(path).toLowerCase();
  const diagnostics = [];
  const adapter = adapterForPath(path);
  const grammar = grammars.get(extension) ?? optionalGrammar(extension);
  if (grammar) {
    analyzeAst(path, source, grammar, config, diagnostics, state);
    if (!grammars.has(extension)) analyzeSourceLexicalFallback(path, source, adapter, diagnostics);
  }
  else if (adapter === 'sql') analyzeSql(path, source, diagnostics, config);
  else if (adapter === 'html') analyzeHtml(path, source, diagnostics);
  else if (adapter === 'css') analyzeCss(path, source, diagnostics);
  else if (adapter === 'single-file-component') analyzeSingleFileComponent(path, source, diagnostics, config);
  else if (adapter === 'template') analyzeTemplate(path, source, diagnostics, config);
  else if (adapter === 'lexical-source' || adapter === 'lexical-data') analyzeLexical(path, source, diagnostics);
  else diagnostics.push(diagnostic(path, null, 'sensor/unsupported-language', 'ERROR', `Unsupported source extension: ${extension || '(none)'}.`));
  return dedupeDiagnostics(diagnostics).map(item => ({ ...item, adapter: item.adapter ?? adapter ?? 'unsupported' }));
}

function analyzeSourceLexicalFallback(path, source, adapter, diagnostics) {
  if (adapter === 'lexical-source') analyzeLexical(path, source, diagnostics);
}

function optionalGrammar(extension) {
  const parser = SENSOR_OPTIONAL_PARSERS.find(item => item.extensions.includes(extension));
  if (!parser) return null;
  if (optionalGrammarCache.has(parser.package)) return optionalGrammarCache.get(parser.package);
  try {
    const module = require(parser.package);
    const grammar = module.default ?? module;
    optionalGrammarCache.set(parser.package, grammar);
    return grammar;
  } catch {
    optionalGrammarCache.set(parser.package, null);
    return null;
  }
}

function analyzePath(path, root, config, diagnostics, sharedState) {
  try {
    const absolutePath = resolve(root, path);
    const source = sharedState.sourceCache.has(absolutePath) ? sharedState.sourceCache.get(absolutePath) : readFileSync(absolutePath, 'utf8');
    sharedState.sourceCache.set(absolutePath, source);
    diagnostics.push(...analyzeSource(path, source, { config, state: { ...sharedState, path, importedSqlFunctions: collectImportedNames(source) } }));
  }
  catch (error) { diagnostics.push(diagnostic(path, null, 'sensor/read-error', 'ERROR', error.message)); }
}

function analyzeAst(path, source, grammar, config, diagnostics, inheritedState) {
  if (Buffer.byteLength(source, 'utf8') > 32000) {
    analyzeLexical(path, source, diagnostics);
    diagnostics.push(diagnostic(path, null, 'sensor/analysis-limit', 'WARN', 'Source exceeds the bounded AST parser input size; lexical checks were used instead.'));
    return;
  }
  const parser = new Parser(); parser.setLanguage(grammar); const tree = parser.parse(source);
  if (tree.rootNode.hasError) diagnostics.push(diagnostic(path, firstError(tree.rootNode), 'sensor/syntax-error', 'ERROR', 'Source contains a syntax error.'));
  let count = 0; let maxDepth = 0; const state = inheritedState ?? { sqlVariables: new Set(), sqlFunctions: new Set(), sqlExports: new Map(), importedSqlFunctions: new Map(), taintedVariables: new Set() };
  state.sqlVariables ??= new Set(); state.sqlFunctions ??= new Set(); state.sqlExports ??= new Map(); state.importedSqlFunctions ??= new Map();
  state.taintedVariables ??= new Set();
  walk(tree.rootNode, 0, (node, depth) => { count += 1; maxDepth = Math.max(maxDepth, depth); inspectAst(path, source, node, diagnostics, config, state); });
  const complexity = config.complexity ?? { maxNodes: 2000, maxDepth: 80 };
  if (count > complexity.maxNodes || maxDepth > complexity.maxDepth) diagnostics.push(diagnostic(path, tree.rootNode, 'sensor/excessive-complexity', 'WARN', `AST complexity ${count} nodes / depth ${maxDepth} exceeds ${complexity.maxNodes} / ${complexity.maxDepth}.`));
}

function inspectAst(path, source, node, diagnostics, config, state) {
  const text = source.slice(node.startIndex, node.endIndex);
  if (/comment$/u.test(node.type) && /\b(?:TODO|FIXME|HACK)\b/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/todo', 'WARN', 'Production code contains an unfinished TODO/FIXME/HACK marker.'));
  if (node.type === 'variable_declarator' || node.type === 'assignment_expression' || node.type === 'assignment') {
    const left = node.childForFieldName('name')?.text ?? node.childForFieldName('left')?.text ?? '';
    const right = node.childForFieldName('value') ?? node.childForFieldName('right');
    const rightText = right?.text ?? '';
    const rightBuilder = right?.childForFieldName('function')?.text ?? rightText.split('(')[0];
    const importedBuilder = importedBinding(rightBuilder, state);
    const resolvedBuilder = isResolvedSqlExport(importedBuilder, state);
    if (left && ((looksLikeDynamicSql(text) && !isSafeParameterizedSql(text, config)) || looksLikeUntrustedSource(text, config) || state.sqlVariables.has(rightText) || state.taintedVariables.has(rightText) || state.sqlFunctions.has(rightBuilder) || resolvedBuilder)) state.sqlVariables.add(left);
    if (left && (state.sqlFunctions.has(rightBuilder) || resolvedBuilder)) state.sqlFunctions.add(left);
    if (left && (looksLikeUntrustedSource(text, config) || state.taintedVariables.has(rightText) || state.taintedVariables.has(rightText.split('.')[0]))) state.taintedVariables.add(left);
  }
  if (node.type === 'function_declaration' || node.type === 'function_definition') {
    const name = node.childForFieldName('name')?.text ?? '';
    if (name && looksLikeDynamicSql(text)) state.sqlFunctions.add(name);
  }
  if (node.type === 'call_expression' || node.type === 'call') {
    const name = node.childForFieldName('function')?.text ?? '';
    const firstArgument = node.childForFieldName('arguments')?.namedChild(0);
    const callArgumentsText = node.childForFieldName('arguments')?.text ?? '';
    if (name === 'eval') diagnostics.push(diagnostic(path, node, 'sensor/dynamic-eval', 'UNSAFE', 'Dynamic eval execution is forbidden.'));
    if (name === 'console.log' || name === 'console.debug') diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/debug-output', 'WARN', 'Debug output should not ship in production code.'));
    if (isShell(name)) {
      const first = node.childForFieldName('arguments')?.namedChild(0); const command = literal(first, source).toLowerCase();
      if (command && (config.dangerousCommands ?? []).some(value => command.includes(value))) diagnostics.push(diagnostic(path, node, 'sensor/dangerous-shell-command', 'UNSAFE', 'Dangerous shell command detected.'));
      if (/shell\s*:\s*true|shell\s*=\s*True/u.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/shell-true', 'UNSAFE', 'Shell execution with shell=true is forbidden.'));
    }
    const argumentText = firstArgument?.text ?? '';
    if (isNetwork(name) && /process\.env|import\.meta\.env|os\.environ|os\.getenv|environ\s*\[/u.test(callArgumentsText)) diagnostics.push(diagnostic(path, node, 'sensor/secret-network-flow', 'UNSAFE', 'A secret source reaches a network output.'));
    if (isNetwork(name) && (looksLikeUntrustedSource(callArgumentsText, config) || !isLiteralNode(firstArgument))) diagnostics.push(diagnostic(path, node, 'sensor/ssrf', 'UNSAFE', 'A network destination is controlled by dynamic or untrusted data.'));
    if (isPathSink(name) && (looksLikeUntrustedPathSource(argumentText, config) || /\.\.[/\\]/u.test(argumentText))) diagnostics.push(diagnostic(path, node, 'sensor/path-traversal', 'UNSAFE', 'A filesystem path may be controlled by untrusted data or contain traversal segments.'));
    if (isRedirect(name) && (looksLikeUntrustedSource(argumentText, config) || !isLiteralNode(firstArgument))) diagnostics.push(diagnostic(path, node, 'sensor/open-redirect', 'WARN', 'A redirect destination is dynamic; validate it against an allowlist.'));
    if (isWeakCrypto(name) || /createHash\s*\(\s*['"](?:md5|sha1)/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/weak-crypto', 'WARN', 'A weak or legacy cryptographic primitive is used.'));
    const firstArgumentName = firstArgument?.text ?? '';
    const calledBuilder = firstArgument?.childForFieldName('function')?.text ?? firstArgumentName.split('(')[0];
    const importedBuilder = importedBinding(calledBuilder, state);
    const dynamicBuilder = state.sqlFunctions.has(calledBuilder) || isResolvedSqlExport(importedBuilder, state);
    if (isSqlSink(name, config) && ((isDynamicSqlArgument(firstArgument, argumentText, config) && !isSafeParameterizedSql(argumentText, config)) || state.sqlVariables.has(firstArgumentName) || state.taintedVariables.has(firstArgumentName) || dynamicBuilder)) diagnostics.push(diagnostic(path, node, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
    if (isSqlSink(name, config) && config.sql?.requireLimit && looksLikeSql(argumentText) && !hasSqlLimit(argumentText)) diagnostics.push(diagnostic(path, node, 'sensor/sql-unbounded-query', 'WARN', `SQL query has no LIMIT clause; bound result size to ${config.sql.maxRows ?? 1000} rows.`));
    if (isSqlSink(name, config) && config.sql?.requireMutationFilter && isUnfilteredMutation(argumentText)) diagnostics.push(diagnostic(path, node, 'sensor/sql-unfiltered-mutation', 'UNSAFE', 'UPDATE or DELETE query has no WHERE filter; require an explicit mutation predicate.'));
    const callableText = enclosingCallable(node)?.text ?? text;
    if (isSqlSink(name, config) && config.sql?.requireRateLimit && looksLikeUntrustedSource(callableText, config) && !hasRateLimitGuard(callableText, config)) diagnostics.push(diagnostic(path, node, 'sensor/sql-missing-rate-limit', 'WARN', 'A request-scoped SQL operation has no configured rate-limit guard.'));
  }
  if (node.type === 'new_expression' && node.childForFieldName('constructor')?.text === 'Function') diagnostics.push(diagnostic(path, node, 'sensor/dynamic-function', 'UNSAFE', 'Dynamic Function construction is forbidden.'));
  if (node.type === 'debugger_statement') diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/debugger', 'WARN', 'Debugger statements should not ship in production code.'));
  if (node.type === 'catch_clause' && !node.namedChildren.some(child => child.type !== 'identifier')) diagnostics.push(diagnostic(path, node, 'sensor/anti-slop/empty-catch', 'WARN', 'Empty catch blocks hide failures and should be handled explicitly.'));
  if (node.type === 'assignment_expression' && /(?:innerHTML|outerHTML)\s*=/u.test(text) && /<(?:style|script)\b|style\s*=/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/ui-mixed-markup', 'WARN', 'HTML/CSS is embedded in a runtime string; keep UI structure and styles in their respective layers.'));
  if (node.type === 'jsx_attribute' && /^dangerouslySetInnerHTML\b/u.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/xss', 'UNSAFE', 'Raw HTML is injected into a JSX element.'));
  if (node.type === 'property_identifier' && node.text === '__proto__') diagnostics.push(diagnostic(path, node, 'sensor/prototype-pollution', 'UNSAFE', 'Prototype mutation through __proto__ is forbidden.'));
}

function analyzeSql(path, source, diagnostics, config = {}) {
  const code = maskSql(source);
  for (const match of code.matchAll(/(?:select|insert|update|delete|where|from)[\s\S]{0,180}(?:\+|\|\||\$\{)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  for (const match of code.matchAll(/\b(?:execute|query|prepare)\s*\([^\n;]*(?:\$\{|\+|\|\|)[^\n;]*\)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  if (config.sql?.requireLimit && /\b(?:select|update|delete)\b/iu.test(code) && !hasSqlLimit(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unbounded-query', 'WARN', `SQL query has no LIMIT clause; bound result size to ${config.sql.maxRows ?? 1000} rows.`));
  if (config.sql?.requireMutationFilter && isUnfilteredMutation(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unfiltered-mutation', 'UNSAFE', 'UPDATE or DELETE query has no WHERE filter; require an explicit mutation predicate.'));
}
function analyzeHtml(path, source, diagnostics) {
  const code = source.replace(/<!--[\s\S]*?-->/gu, match => match.replace(/[^\n]/gu, ' '));
  const style = code.match(/<style\b[\s\S]*?<\/style\s*>/iu);
  if (style) diagnostics.push(lineDiagnostic(path, source, style.index, 'sensor/ui-mixed-markup', 'WARN', 'CSS is embedded in HTML; keep styles in a dedicated stylesheet.'));
  for (const match of code.matchAll(/\s+on[a-z]+\s*=\s*['"]/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/ui-inline-handler', 'WARN', 'Inline event handlers mix behavior into markup; use a controlled handler.'));
  for (const match of code.matchAll(/<img\b(?![^>]*\balt\s*=)[^>]*>/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/ui-missing-alt', 'WARN', 'Images must provide an alt attribute or an explicit decorative alternative.'));
}
function analyzeCss(path, source, diagnostics) {
  const code = maskCss(source);
  const markup = code.match(/<\/?(?:html|body|div|style|script)\b/iu);
  if (markup) diagnostics.push(lineDiagnostic(path, source, markup.index, 'sensor/ui-mixed-markup', 'WARN', 'HTML markup is placed in a CSS file; keep structure and styles in their respective layers.'));
  for (const match of code.matchAll(/!important\b/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/css-important', 'WARN', '!important should be justified because it weakens predictable cascade ownership.'));
}
function analyzeLexical(path, source, diagnostics) {
  const code = maskLexical(source, extname(path).toLowerCase());
  const match = code.match(/\beval\s*\(/iu);
  if (match) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/dynamic-eval', 'UNSAFE', 'Dynamic eval execution is forbidden.'));
  if (['.rb', '.rake', '.ru'].includes(extname(path).toLowerCase()) || ['Gemfile', 'Rakefile', 'config.ru'].includes(basename(path))) analyzeRuby(path, source, diagnostics);
}
function analyzeTemplate(path, source, diagnostics, config) {
  const rubyLike = /\.(?:erb|haml|slim)$/iu.test(path);
  const blade = /(?:^|\.)blade\.php$/iu.test(path);
  const embedded = source.replace(/<%[=#-]?[\s\S]*?%>|\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{!![\s\S]*?!!\}|<\?(?:php)?[\s\S]*?\?>/gu, match => match.replace(/[^\n]/gu, ' '));
  analyzeHtml(path, embedded, diagnostics);
  if (rubyLike) {
    for (const match of source.matchAll(/<%[=#-]?([\s\S]*?)%>/gu)) analyzeRuby(path, match[1], diagnostics, match.index + match[0].indexOf(match[1]));
  } else if (blade) {
    for (const match of source.matchAll(/<\?(?:php)?([\s\S]*?)\?>|@php([\s\S]*?)@endphp/giu)) analyzePhp(path, match[1] ?? match[2], diagnostics, match.index + match[0].indexOf(match[1] ?? match[2]));
    for (const match of source.matchAll(/(?:\{\{|\{!!|\{%)([\s\S]*?)(?:\}\}|!!\}|%\})/gu)) analyzeTemplateCode(path, source, match[1], match.index + match[0].indexOf(match[1]), diagnostics);
  } else {
    for (const match of source.matchAll(/(?:\{\{|\{%)([\s\S]*?)(?:\}\}|%\})/gu)) analyzeTemplateCode(path, source, match[1], match.index + match[0].indexOf(match[1]), diagnostics);
  }
  const dynamicStyle = /style\s*(?:=|:)\s*["'][^"']*(?:\{\{|#\{)/iu;
  if (dynamicStyle.test(source)) diagnostics.push(lineDiagnostic(path, source, source.search(dynamicStyle), 'sensor/ui-dynamic-style', 'WARN', 'Dynamic inline style should use named design tokens and a controlled style layer.'));
  void config;
}
function analyzeTemplateCode(path, source, code, offset, diagnostics) {
  if (/\b(?:eval|exec|system)\s*\(/iu.test(code)) diagnostics.push(lineDiagnostic(path, source, offset + code.search(/\b(?:eval|exec|system)\s*\(/iu), 'sensor/dynamic-execution', 'UNSAFE', 'Template code invokes dynamic execution.'));
}
function analyzeRuby(path, source, diagnostics, offset = 0) {
  const code = maskRubyComments(source);
  for (const match of code.matchAll(/\b(?:find_by_sql|find_by_query|execute|exec_query|select_all|connection\.execute|where|order|pluck|select)\s*\(?\s*(['"])(?=[\s\S]*#\{)([\s\S]*?)\1/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/sql-injection', 'UNSAFE', 'Ruby SQL query interpolates dynamic data; use bind parameters or an ORM parameter API.'));
  for (const match of code.matchAll(/\b(?:find_by_sql|find_by_query|execute|exec_query|select_all|connection\.execute|where|order|pluck|select)\s*\(?[^\n;]*(?:\+|<<)[^\n;]*/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/sql-injection', 'UNSAFE', 'Ruby SQL query is constructed by concatenation; use bind parameters or an ORM parameter API.'));
  for (const match of code.matchAll(/(?:^|[=;\s])(?:system|exec|spawn|Open3\.(?:capture|popen|pipeline))\s*\(?[^\n;]*(?:#\{|\+|params\[)/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/dynamic-execution', 'UNSAFE', 'Ruby command execution uses dynamic data.'));
  for (const match of code.matchAll(/\b(?:send_file|send_data)\s*\(?\s*(?:params\[|request\.)/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/path-traversal', 'UNSAFE', 'Rails file output uses request-controlled data; validate an allowlisted path.'));
  for (const match of code.matchAll(/\b(?:redirect_to|redirect_back)\s*\(?\s*(?:params\[|request\.)/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/open-redirect', 'WARN', 'Rails redirect destination is request-controlled; validate it against an allowlist.'));
  for (const match of code.matchAll(/\b(?:render\s+inline:|raw\s*\(|\.html_safe\b|params\.permit!)/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/rails-unsafe-render', 'WARN', 'Rails rendering bypasses a safe view boundary; justify and sanitize the value.'));
  for (const match of code.matchAll(/\b(?:User|Account|Record|Model)\.(?:new|create|update|update!|assign_attributes)\s*\(\s*params\b/gu)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/rails-unpermitted-params', 'WARN', 'Rails model assignment should use an explicit params permit list.'));
}
function analyzePhp(path, source, diagnostics, offset = 0) {
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*/gu, match => match.replace(/[^\n]/gu, ' '));
  for (const match of code.matchAll(/\b(?:DB::raw|whereRaw|orderByRaw|havingRaw|query|execute|exec|prepare)\s*\([^\n;]*(?:\$[A-Za-z_][\w]*|\.|\$\{)/gu)) if (isPhpCodePosition(source, match.index)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/sql-injection', 'UNSAFE', 'PHP SQL query is constructed from dynamic data; use bind parameters or a query builder parameter API.'));
  for (const match of code.matchAll(/\b(?:eval|system|shell_exec|passthru|exec)\s*\([^\n;]*(?:\$[A-Za-z_][\w]*|\.)/gu)) if (isPhpCodePosition(source, match.index)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/dynamic-execution', 'UNSAFE', 'PHP dynamic execution uses dynamic data.'));
  for (const match of code.matchAll(/\b(?:readfile|file_get_contents|unlink|include|require)\s*\(\s*\$(?:_GET|_POST|_REQUEST|[A-Za-z_])/gu)) if (isPhpCodePosition(source, match.index)) diagnostics.push(lineDiagnostic(path, source, offset + match.index, 'sensor/path-traversal', 'UNSAFE', 'PHP filesystem access uses request-controlled data; validate an allowlisted path.'));
}
function isPhpCodePosition(source, index) {
  let quote = null;
  let blockComment = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const pair = source.slice(cursor, cursor + 2);
    if (blockComment) { if (pair === '*/') { blockComment = false; cursor += 1; } continue; }
    if (!quote && pair === '/*') { blockComment = true; cursor += 1; continue; }
    if (!quote && (pair === '//' || source[cursor] === '#')) { const newline = source.indexOf('\n', cursor); if (newline < 0 || newline >= index) return false; cursor = newline; continue; }
    if (quote) { if (source[cursor] === '\\') { cursor += 1; continue; } if (source[cursor] === quote) quote = null; continue; }
    if (source[cursor] === '"' || source[cursor] === "'") quote = source[cursor];
  }
  return !quote && !blockComment;
}
function maskRubyComments(source) { return source.replace(/#(?!\{)[^\n]*/gu, match => match.replace(/[^\n]/gu, ' ')); }
function analyzeSingleFileComponent(path, source, diagnostics, config) {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu;
  const stylePattern = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/giu;
  for (const match of source.matchAll(scriptPattern)) {
    const language = /\blang\s*=\s*["'](?:tsx|jsx)["']/iu.test(match[1]) ? '.tsx' : /\blang\s*=\s*["'](?:ts|typescript)["']/iu.test(match[1]) ? '.ts' : '.js';
    appendEmbeddedDiagnostics(path, source, match.index + match[0].indexOf(match[2]), analyzeSource(`${path}${language}`, match[2], { config }), diagnostics);
  }
  for (const match of source.matchAll(stylePattern)) {
    const language = /\blang\s*=\s*["'](?:scss|sass)["']/iu.test(match[1]) ? '.scss' : '.css';
    appendEmbeddedDiagnostics(path, source, match.index + match[0].indexOf(match[2]), analyzeSource(`${path}${language}`, match[2], { config }), diagnostics);
  }
}
function appendEmbeddedDiagnostics(path, source, offset, embedded, diagnostics) {
  const lineOffset = source.slice(0, offset).split('\n').length - 1;
  for (const item of embedded) diagnostics.push({ ...item, path, line: item.line + lineOffset });
}
function maskSql(source) { return source.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/gu, match => match.replace(/[^\n]/gu, ' ')); }
function maskCss(source) { return source.replace(/\/\*[\s\S]*?\*\/|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/gu, match => match.replace(/[^\n]/gu, ' ')); }
function maskLexical(source, extension) {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//gu, match => match.replace(/[^\n]/gu, ' '));
  const hashComments = ['.toml', '.yaml', '.yml', '.py', '.rb', '.sh', '.bash', '.zsh', '.ex', '.exs', '.r', '.pl', '.pm', '.t', '.nim', '.hcl', '.tf', '.tfvars', '.nix'].includes(extension);
  const dashComments = ['.lua', '.hs', '.lhs', '.f', '.for', '.f03', '.f90', '.f95'].includes(extension);
  const lineComments = [hashComments ? /#[^\n]*/gu : null, dashComments ? /--[^\n]*/gu : null, /\/\/[^\n]*/gu].filter(Boolean);
  const maskedLines = lineComments.reduce((value, pattern) => value.replace(pattern, match => match.replace(/[^\n]/gu, ' ')), withoutBlockComments);
  return maskedLines.replace(/'(?:\\.|[^'\n])*'|"(?:\\.|[^"\n])*"|`(?:\\.|[^`\n])*`/gu, match => match.replace(/[^\n]/gu, ' '));
}
function defaultConfig(root) {
  try { return JSON.parse(readFileSync(resolve(root, '.project/sensor-rules.json'), 'utf8')); }
  catch (error) { return { __sensorConfigError: error.message }; }
}
function collectDynamicExports(paths, root, sourceCache = new Map()) {
  const exports = new Map();
  for (const path of paths) {
    try {
      const absolutePath = resolve(root, path);
      const source = sourceCache.has(absolutePath) ? sourceCache.get(absolutePath) : readFileSync(absolutePath, 'utf8');
      sourceCache.set(absolutePath, source);
      const extension = extname(path).toLowerCase();
      const grammar = grammars.get(extension);
      if (grammar) indexDynamicExports(source, grammar, path, root, exports);
      else if (extension === '.vue' || extension === '.svelte') {
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
          const language = /\blang\s*=\s*["'](?:tsx|jsx)["']/iu.test(match[1]) ? '.tsx' : /\blang\s*=\s*["'](?:ts|typescript)["']/iu.test(match[1]) ? '.ts' : '.js';
          indexDynamicExports(match[2], grammars.get(language), path, root, exports);
        }
      }
    } catch { /* the normal scan emits the authoritative read/syntax diagnostic */ }
  }
  return exports;
}
function indexDynamicExports(source, grammar, path, root, exports) {
  if (!grammar) return;
  const parser = new Parser(); parser.setLanguage(grammar); const tree = parser.parse(source);
  walk(tree.rootNode, 0, node => {
    const pythonModuleFunction = grammar === Python && node.type === 'function_definition' && node.parent?.type === 'module';
    const exportedFunction = (node.type === 'function_declaration' || node.type === 'variable_declarator') && isExported(node);
    const name = node.childForFieldName('name')?.text ?? '';
    const exportedDefault = exportedFunction && /^export\s+default\b/u.test(source.slice(node.parent?.startIndex ?? node.startIndex, node.parent?.endIndex ?? node.endIndex));
    if ((pythonModuleFunction || exportedFunction) && name && looksLikeDynamicSql(source.slice(node.startIndex, node.endIndex))) {
      for (const exportName of exportedDefault ? [name, 'default'] : [name]) {
        if (!exports.has(exportName)) exports.set(exportName, new Set());
        exports.get(exportName).add(resolve(root, path));
      }
    }
  });
  for (const match of source.matchAll(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/gu)) {
    const candidates = exports.get(match[1]);
    if (candidates) exports.set('default', new Set([...(exports.get('default') ?? []), ...candidates]));
  }
}
function isExported(node) { let parent = node.parent; while (parent) { if (parent.type === 'export_statement') return true; if (parent.type === 'program' || parent.type === 'module') return false; parent = parent.parent; } return false; }
function collectImportedNames(source) {
  const names = new Map();
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    for (const item of (match[1] ?? match[2]).split(',')) {
      const parts = item.trim().split(/\s+as\s+/iu).map(value => value.trim());
      if (parts[0]) names.set(parts.at(-1), { original: parts[0], module: match[2] });
    }
  }
  for (const match of source.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gu)) names.set(match[1], { namespace: true, module: match[2] });
  for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gu)) names.set(match[1], { original: 'default', module: match[2] });
  for (const match of source.matchAll(/\bfrom\s+([A-Za-z0-9_./-]+)\s+import\s+([^\n]+)/gu)) {
    for (const item of match[2].split(',')) {
      const parts = item.trim().split(/\s+as\s+/iu).map(value => value.trim());
      if (parts[0]) names.set(parts.at(-1), { original: parts[0], module: match[1] });
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s*:\s*/u).map(value => value.trim());
      if (parts[0]) names.set(parts.at(-1), { original: parts[0], module: match[2] });
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\.([A-Za-z_$][\w$]*)/gu)) {
    names.set(match[1], { original: match[3], module: match[2] });
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    if (!names.has(match[1])) names.set(match[1], { namespace: true, module: match[2] });
  }
  return names;
}
function importedBinding(name, state) {
  const direct = state.importedSqlFunctions.get(name);
  if (direct) return direct;
  const [namespace, ...members] = name.split('.');
  const member = members.at(-1);
  const binding = state.importedSqlFunctions.get(namespace);
  return binding?.namespace && member ? { original: member, module: binding.module } : null;
}
function isResolvedSqlExport(binding, state) {
  if (!binding) return false;
  const candidates = state.sqlExports.get(binding.original);
  if (!candidates?.size) return false;
  const consumer = resolve(state.root ?? process.cwd(), state.path ?? '');
  const imported = resolveImportedModule(consumer, binding.module, state.root ?? process.cwd(), state.scannedFiles);
  return imported ? [...candidates].some(candidate => candidate === imported) : false;
}
function resolveImportedModule(consumer, specifier, root, scannedFiles = new Set()) {
  if (!specifier) return null;
  const extension = extname(consumer).toLowerCase();
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && extension !== '.py') return null;
  const consumerDirectory = resolve(consumer, '..');
  const pythonRelative = extension === '.py' && specifier.startsWith('.')
    ? resolve(consumerDirectory, specifier.replace(/^\.+/u, dots => '../'.repeat(Math.max(0, dots.length - 1))))
    : null;
  const base = specifier.startsWith('/') ? resolve('', specifier) : pythonRelative ?? resolve(consumerDirectory, specifier);
  if (!base) return null;
  const candidates = [base, ...['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py'].map(extension => `${base}${extension}`), ...['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py'].map(extension => resolve(base, `index${extension}`))];
  return candidates.find(candidate => candidate === resolve(root, candidate) && scannedFiles.has(candidate) && fileExists(candidate)) ?? null;
}
function fileExists(path) {
  try { return readFileSync(path, { encoding: 'utf8' }) !== undefined; } catch { return false; }
}
function validateConfig(config) {
  if (config?.__sensorConfigError) return [diagnostic('.project/sensor-rules.json', null, 'sensor/configuration', 'ERROR', `Sensor rules could not be loaded: ${config.__sensorConfigError}`)];
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) errors.push('configuration must be an object');
  else {
    if (config.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
    if (config.analysis !== undefined && (!config.analysis || typeof config.analysis !== 'object' || Array.isArray(config.analysis))) errors.push('analysis must be an object');
    if (config.analysis?.moduleScope !== undefined && config.analysis.moduleScope !== 'explicit-paths') errors.push('analysis.moduleScope must equal explicit-paths');
    if (config.analysis?.packageResolution !== undefined && config.analysis.packageResolution !== 'disabled') errors.push('analysis.packageResolution must equal disabled');
    if (!Array.isArray(config.dangerousCommands) || config.dangerousCommands.some(value => typeof value !== 'string')) errors.push('dangerousCommands must be an array of strings');
    if (config.complexity && (!Number.isInteger(config.complexity.maxNodes) || !Number.isInteger(config.complexity.maxDepth) || config.complexity.maxNodes < 1 || config.complexity.maxDepth < 1)) errors.push('complexity.maxNodes and complexity.maxDepth must be positive integers');
    if (config.sql) {
      if (!Array.isArray(config.sql.sinks) || config.sql.sinks.some(value => typeof value !== 'string' || !value)) errors.push('sql.sinks must be a non-empty array of strings');
      if (config.sql.requireLimit !== undefined && typeof config.sql.requireLimit !== 'boolean') errors.push('sql.requireLimit must be boolean');
      if (config.sql.requireMutationFilter !== undefined && typeof config.sql.requireMutationFilter !== 'boolean') errors.push('sql.requireMutationFilter must be boolean');
      if (config.sql.requireRateLimit !== undefined && typeof config.sql.requireRateLimit !== 'boolean') errors.push('sql.requireRateLimit must be boolean');
      if (config.sql.maxRows !== undefined && (!Number.isInteger(config.sql.maxRows) || config.sql.maxRows < 1)) errors.push('sql.maxRows must be a positive integer');
      if (config.sql.taintSources !== undefined && (!Array.isArray(config.sql.taintSources) || config.sql.taintSources.some(value => typeof value !== 'string' || !value))) errors.push('sql.taintSources must be an array of non-empty strings');
      if (config.sql.rateLimitGuards !== undefined && (!Array.isArray(config.sql.rateLimitGuards) || config.sql.rateLimitGuards.some(value => typeof value !== 'string' || !value))) errors.push('sql.rateLimitGuards must be an array of non-empty strings');
      if (config.sql.safeBuilders !== undefined && (!Array.isArray(config.sql.safeBuilders) || config.sql.safeBuilders.some(value => typeof value !== 'string' || !value))) errors.push('sql.safeBuilders must be an array of non-empty strings');
    }
  }
  return errors.map(message => diagnostic('.project/sensor-rules.json', null, 'sensor/configuration', 'ERROR', message));
}
function sensorResult(verdict, diagnostics) { return { schemaVersion: 1, verdict, coverage: SENSOR_COVERAGE, diagnostics }; }
function dedupeDiagnostics(diagnostics) {
  const seen = new Set();
  return diagnostics.filter(item => {
    const key = [item.path, item.line, item.column, item.rule, item.severity, item.message].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function looksLikeSql(text) { return /\b(?:select|insert|update|delete)\b/iu.test(text) || /\b(?:where|order\s+by|group\s+by|having|set|from|values)\b[\s\S]{0,120}(?:=|<|>|\?|\$\d|\$\{|\+)/iu.test(text) || /\b[A-Za-z_]\w*\s*(?:=|<|>)\s*/u.test(text); }
function looksLikeUntrustedSource(text, config = {}) {
  const sources = config.sql?.taintSources ?? ['req.query', 'req.params', 'req.body', 'request.args', 'request.form', 'request.json', 'request.query_params', 'request.path_params', 'request.GET', 'request.POST', 'request.body', 'searchParams', 'URLSearchParams', 'process.argv', 'process.env', 'os.environ', 'os.getenv'];
  return sources.some(source => text.includes(source));
}
function looksLikeUntrustedPathSource(text, config = {}) {
  return looksLikeUntrustedSource(text, config) && !/process\.env|os\.environ|os\.getenv/u.test(text);
}
function hasSqlLimit(text) { return /\blimit\s+(?:\d+\b|\?|[$:](?:\d+|[A-Za-z_]\w*)\b)/iu.test(text); }
function isUnfilteredMutation(text) { return /\b(?:update\b[\s\S]+?set|delete\s+from\b)[\s\S]*\b(?:where|using)\b/iu.test(text) ? false : /\b(?:update\b[\s\S]+?set|delete\s+from)\b/iu.test(text); }
function enclosingCallable(node) { let parent = node.parent; while (parent) { if (/^(?:function|function_declaration|function_definition|method_definition|arrow_function|generator_function|lambda)$/u.test(parent.type)) return parent; parent = parent.parent; } return null; }
function hasRateLimitGuard(text, config) { const guards = config.sql?.rateLimitGuards ?? ['rateLimit', 'rateLimiter', 'throttle', 'quota', 'limiter']; return guards.some(guard => new RegExp(`\\b${escapeRegExp(guard)}\\b`, 'iu').test(text)); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
function isSafeParameterizedSql(text, config) { const builders = config.sql?.safeBuilders ?? ['sql', 'Prisma.sql', 'drizzle.sql', 'kysely.sql']; return builders.some(builder => new RegExp('(?:^|[=(,:]\\s*)' + escapeRegExp(builder) + '\\s*`[\\s\\S]*?\\$\\{', 'u').test(text)); }
function isDynamicSqlArgument(node, text, config) {
  if (!node) return false;
  if (node.type === 'string') return /^f['"]/u.test(text);
  if (node.type === 'template_string') return /\$\{/u.test(text);
  return looksLikeDynamicSql(text) && !isSafeParameterizedSql(text, config);
}
function looksLikeDynamicSql(text) { return looksLikeSql(text) && /\+|\|\||\$\{|\bf['"]|\.format\s*\(|%\s+[A-Za-z_]/u.test(text); }
function isSqlSink(name, config) { const sinks = config.sql?.sinks ?? ['query', 'execute', 'prepare', 'raw', 'exec', 'run', 'all', 'get', 'rawQuery', 'queryRaw', 'executeRaw', 'raw_sql', 'execute_sql', 'whereRaw', 'havingRaw', 'orderByRaw', 'joinRaw', 'literal', 'text', 'Raw', 'RawSQL', 'extra', 'fromSqlRaw', 'executeSqlRaw', 'fetch', 'fetchrow', 'fetchval', 'fetch_all', 'fetch_one', 'fetch_val', 'executemany', 'execute_many', 'executeMany', '$queryRawUnsafe', '$executeRawUnsafe']; return sinks.some(sink => name === sink || name.endsWith(`.${sink}`)); }
function walk(node, depth, visit) { visit(node, depth); for (const child of node.namedChildren) walk(child, depth + 1, visit); }
function firstError(node) { if (node.isError || node.isMissing) return node; for (const child of node.namedChildren) { const result = firstError(child); if (result) return result; } return node; }
function literal(node, source) { if (!node || !['string', 'template_string'].includes(node.type)) return ''; return source.slice(node.startIndex, node.endIndex).replace(/^['"`]|['"`]$/gu, ''); }
function isShell(name) { return /(?:^|\.)(?:exec|execSync|spawn|spawnSync|system|popen|run)$/u.test(name); }
function isNetwork(name) { return /^(?:fetch|axios(?:\.[a-z]+)?|https?\.(?:request|get)|requests\.(?:get|post|put|patch|delete))$/u.test(name); }
function diagnostic(path, node, rule, severity, message) { return { path, line: (node?.startPosition.row ?? 0) + 1, column: (node?.startPosition.column ?? 0) + 1, rule, severity, confidence: confidenceFor(rule), category: categoryFor(rule), message }; }
function lineDiagnostic(path, source, index, rule, severity, message) { const before = source.slice(0, index); return { path, line: before.split('\n').length, column: index - before.lastIndexOf('\n'), rule, severity, confidence: confidenceFor(rule), category: categoryFor(rule), message }; }
function confidenceFor(rule) { return /sql-injection|dynamic-eval|dynamic-function|shell|secret|ssrf|path-traversal|xss|prototype-pollution/u.test(rule) ? 'HIGH' : 'MEDIUM'; }
function categoryFor(rule) { if (/sql|secret|ssrf|path-traversal|xss|crypto|shell|eval|function|prototype/u.test(rule)) return 'security'; if (/ui|css/u.test(rule)) return 'architecture'; if (/anti-slop|complexity/u.test(rule)) return 'quality'; return 'safety'; }
function isLiteralNode(node) { return Boolean(node && ['string', 'template_string', 'string_content', 'integer', 'float'].includes(node.type)); }
function isPathSink(name) { return /(?:^|\.)(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|open|sendFile|download|unlink|rm|rmdir)$/u.test(name); }
function isRedirect(name) { return /(?:^|\.)(?:redirect|redirectTo|sendRedirect)$/u.test(name); }
function isWeakCrypto(name) { return /(?:^|\.)(?:md5|sha1|createHash\(['"](?:md5|sha1)|des|rc4)$/iu.test(name); }
