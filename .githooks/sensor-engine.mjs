import Parser from 'tree-sitter';
import { adapterMetadata, catalogEntry, extractEmbeddedSource, grammarStatus, resolveRegistryEntry, SENSOR_ADAPTERS, SENSOR_OPTIONAL_PARSERS } from './ast-registry.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTree } from './sensor-ir.mjs';

const rank = { SAFE: 0, WARN: 1, UNSAFE: 2, ERROR: 3 };
const sensorRoot = fileURLToPath(new URL('..', import.meta.url));
export { AST_REGISTRY, grammarStatus, SENSOR_ADAPTERS, SENSOR_OPTIONAL_PARSERS } from './ast-registry.mjs';
const adapterByExtension = new Map(SENSOR_ADAPTERS.flatMap(adapter => adapter.extensions.map(extension => [extension, adapter.id])));
const adapterByFilename = new Map(SENSOR_ADAPTERS.flatMap(adapter => (adapter.filenames ?? []).map(filename => [filename, adapter.id])));
export const SENSOR_COVERAGE = Object.freeze({
  moduleScope: 'explicit-paths',
  packageResolution: 'disabled',
  wholeProgramAnalysis: false,
  rateLimitRuntimeProof: false,
});

export function adapterForPath(path) {
  const resolved = resolveRegistryEntry(path);
  return resolved?.sensorAdapter ?? resolved?.id ?? adapterByExtension.get(extname(path).toLowerCase()) ?? adapterByFilename.get(basename(path));
}

export function isSupportedSourcePath(path) {
  return Boolean(adapterForPath(path));
}

export function optionalParserStatus(loader) {
  return SENSOR_OPTIONAL_PARSERS.map(parser => {
    const sample = parser.extensions[0] ? `sample${parser.extensions[0]}` : parser.filenames[0];
    const resolved = resolveRegistryEntry(sample, loader);
    return { id: `${parser.id}-ast`, package: parser.package, extensions: parser.extensions, mode: resolved.actualMode, available: resolved.available, fallback: resolved.fallback, fallbackReason: resolved.fallbackReason };
  });
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
  const files = [];
  const configurationErrors = validateConfig(config);
  if (configurationErrors.length) {
    diagnostics.push(...configurationErrors);
    return sensorResult('ERROR', diagnostics, files);
  }
  for (const id of config.languages ?? []) {
    const language = catalogEntry(id);
    const status = language && grammarStatus().find(item => item.id === language.id);
    if (!language) diagnostics.push(diagnostic('.project/project-config.json', null, 'sensor/unknown-language', 'ERROR', `Unknown configured Sensor language: ${id}.`));
    else if (!status?.syntaxAware) {
      const installable = Boolean(language.package && language.support === 'stable' && language.qualification?.parserLoaded);
      const action = installable ? ` Run: npm run sensor:languages -- install ${language.id}` : '';
      diagnostics.push(diagnostic('.project/project-config.json', null, 'sensor/parser-required', 'ERROR', `Parser required for ${language.id} is unavailable.${action || ` ${language.fallbackReason}`}`));
    }
  }
  if (!paths.length) diagnostics.push(diagnostic('', null, 'sensor/no-input', 'ERROR', 'At least one source path is required.'));
  const uniquePaths = [...new Set(paths)];
  const scannedFiles = new Set(uniquePaths.map(path => resolve(root, path)));
  const sourceCache = new Map();
  const sharedState = { root, scannedFiles, sourceCache, sqlExports: collectDynamicExports(uniquePaths, root, sourceCache) };
  for (const path of [...uniquePaths].sort()) analyzePath(path, root, config, diagnostics, files, sharedState);
  diagnostics.push(...runOfficialAntiSlop(uniquePaths, root));
  const stableDiagnostics = dedupeDiagnostics(diagnostics).sort((a, b) => String(a.path).localeCompare(String(b.path)) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
  const verdict = stableDiagnostics.reduce((current, item) => rank[item.severity] > rank[current] ? item.severity : current, 'SAFE');
  return sensorResult(verdict, stableDiagnostics, files);
}

function runOfficialAntiSlop(paths, root) {
  const direct = paths.filter(path => !path.replaceAll('\\', '/').includes('tools/oxlint/anti-slop/') && ['javascript', 'typescript', 'tsx'].includes(resolveRegistryEntry(path)?.id)).map(path => ({ candidate: resolve(root, path), path, source: null, offset: 0 })).filter(item => existsSync(item.candidate));
  const workspace = mkdtempSync(resolve(tmpdir(), 'sensor-anti-slop-'));
  const embedded = [];
  try {
    for (const path of paths.filter(item => ['vue', 'svelte', 'astro', 'html', 'template', 'blade', 'notebook'].includes(resolveRegistryEntry(item)?.id))) {
      const source = readFileSync(resolve(root, path), 'utf8');
      for (const [index, unit] of extractAntiSlopUnits(path, source).entries()) {
        const candidate = resolve(workspace, `${embedded.length}-${index}${unit.extension}`);
        writeFileSync(candidate, unit.code);
        embedded.push({ candidate, path, source, offset: unit.offset });
      }
    }
    const units = [...direct, ...embedded];
    if (!units.length) return [];
    return runAntiSlopUnits(units);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}

function runAntiSlopUnits(units) {
  const executable = resolve(sensorRoot, 'node_modules', 'oxlint', 'bin', 'oxlint');
  const configPath = resolve(sensorRoot, 'oxlint.config.ts');
  if (!existsSync(executable) || !existsSync(configPath)) return [diagnostic('', null, 'sensor/anti-slop-unavailable', 'ERROR', 'Official anti-slop dependencies are unavailable; run npm run sensor:languages -- sync.')];
  const result = spawnSync(process.execPath, [executable, '--config', configPath, '--format', 'json', '--quiet', ...units.map(item => item.candidate)], { cwd: sensorRoot, encoding: 'utf8' });
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { return [diagnostic('', null, 'sensor/anti-slop-failed', 'ERROR', `Official anti-slop failed: ${(result.stderr || result.stdout || `status ${result.status}`).trim()}`)]; }
  const byCandidate = new Map(units.map(item => [resolve(item.candidate), item]));
  return (report.diagnostics ?? []).filter(item => /^(?:anti-slop|anti-slop-effect)\(/u.test(item.code)).map(item => {
    const label = item.labels?.[0]?.span ?? {};
    const rule = item.code.replace(/^([^()]+)\(([^()]+)\)$/u, '$1/$2');
    const unit = byCandidate.get(resolve(item.filename));
    const displayedPath = unit?.path ?? item.filename;
    const mapped = unit?.source ? lineDiagnostic(displayedPath, unit.source, unit.offset + sourceOffsetForPosition(readFileSync(unit.candidate, 'utf8'), label.line ?? 1, label.column ?? 1), rule, 'ERROR', item.message) : { ...diagnostic(displayedPath, null, rule, 'ERROR', item.message), line: label.line ?? 1, column: label.column ?? 1 };
    return { ...mapped, adapter: 'anti-slop', mode: 'oxlint', grammar: null, fallback: null, fallbackReason: null };
  });
}

function extractAntiSlopUnits(path, source) {
  const units = [];
  const registryId = resolveRegistryEntry(path)?.id;
  if (registryId === 'astro') {
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(source);
    if (frontmatter) units.push({ code: frontmatter[1], extension: '.ts', offset: frontmatter.index + frontmatter[0].indexOf(frontmatter[1]) });
  }
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) units.push({ code: match[2], extension: /\blang\s*=\s*["'](?:ts|typescript|tsx)["']/iu.test(match[1]) ? '.ts' : '.js', offset: match.index + match[0].indexOf(match[2]) });
  if (registryId === 'notebook') {
    try {
      const notebook = JSON.parse(source);
      const language = String(notebook.metadata?.kernelspec?.language ?? notebook.metadata?.language_info?.name ?? '').toLowerCase();
      if (/^(?:javascript|typescript|node)$/u.test(language)) {
        let cursor = 0;
        for (const cell of notebook.cells ?? []) if (cell?.cell_type === 'code') {
          const fragments = Array.isArray(cell.source) ? cell.source : [String(cell.source ?? '')];
          const token = JSON.stringify(fragments[0] ?? '').slice(1, -1);
          const found = token ? source.indexOf(token, cursor) : cursor;
          const offset = found < 0 ? cursor : found;
          cursor = offset + token.length;
          units.push({ code: fragments.join(''), extension: language === 'typescript' ? '.ts' : '.js', offset });
        }
      }
    } catch { /* structured analysis emits the authoritative JSON error */ }
  }
  return units;
}

export function analyzeSource(path, source, { config = {}, state, grammarLoader } = {}) {
  const extension = extname(path).toLowerCase();
  const diagnostics = [];
  const resolved = resolveRegistryEntry(path, grammarLoader);
  const registryId = resolved?.id;
  const adapter = resolved?.sensorAdapter ?? registryId;
  const run = (operation, metadata) => {
    const start = diagnostics.length;
    operation();
    for (let index = start; index < diagnostics.length; index += 1) Object.assign(diagnostics[index], metadata);
  };
  if (resolved?.parserKind === 'structured' && registryId === 'json') run(() => analyzeJson(path, source, diagnostics), { mode: 'structured', grammar: 'node:json', fallback: null, fallbackReason: null });
  else if (resolved?.grammar) {
    if (registryId === 'erb') run(() => analyzeHtml(path, source.replace(/<%[\s\S]*?%>/gu, match => match.replace(/[^\n\r]/gu, ' ')), diagnostics), { mode: 'embedded', grammar: null, fallback: null, fallbackReason: null });
    const parserSource = extractEmbeddedSource(resolved, source);
    run(() => analyzeAst(path, source, parserSource, resolved, config, diagnostics, state), { mode: resolved.mode, grammar: resolved.package, fallback: null, fallbackReason: null });
  } else if ((registryId === 'ruby' || registryId === 'erb') && resolved?.fallback === 'lexical') {
    run(() => analyzeRuby(path, source, diagnostics), { mode: 'lexical', grammar: null, fallback: 'lexical', fallbackReason: resolved.fallbackReason });
    diagnostics.push({ ...diagnostic(path, null, 'sensor/parser-unavailable', 'WARN', `${resolved.package} unavailable; lexical fallback used.`), mode: 'lexical', grammar: null, fallback: 'lexical', fallbackReason: resolved.fallbackReason });
  } else if (registryId === 'sql') run(() => analyzeSql(path, source, diagnostics, config), lexicalMetadata());
  else if (registryId === 'html') run(() => analyzeHtml(path, source, diagnostics), { ...lexicalMetadata(), mode: 'embedded' });
  else if (registryId === 'css') run(() => analyzeCss(path, source, diagnostics), lexicalMetadata());
  else if (registryId === 'vue' || registryId === 'svelte' || registryId === 'astro') run(() => analyzeSingleFileComponent(path, source, diagnostics, config, registryId), { ...lexicalMetadata(), mode: 'embedded' });
  else if (registryId === 'notebook') run(() => analyzeNotebook(path, source, diagnostics, config), { ...lexicalMetadata(), mode: 'embedded' });
  else if (registryId === 'template' || registryId === 'blade') run(() => analyzeTemplate(path, source, diagnostics, config), { ...lexicalMetadata(), mode: 'embedded' });
  else if (resolved) {
    run(() => analyzeLexical(path, source, diagnostics), { ...lexicalMetadata(), fallback: 'lexical', fallbackReason: resolved.fallbackReason });
    diagnostics.push({ ...diagnostic(path, null, 'sensor/parser-unavailable', 'WARN', `${resolved.id} has lexical-only partial coverage.`), ...lexicalMetadata(), fallback: 'lexical', fallbackReason: resolved.fallbackReason });
  }
  else diagnostics.push(diagnostic(path, null, 'sensor/unsupported-language', 'ERROR', `Unsupported source extension: ${extension || '(none)'}.`));
  const metadata = adapterMetadata(path, grammarLoader);
  return dedupeDiagnostics(diagnostics).map(item => ({ ...item, adapter: adapter ?? metadata.adapter, mode: item.mode ?? metadata.mode, grammar: Object.hasOwn(item, 'grammar') ? item.grammar : metadata.grammar, fallback: Object.hasOwn(item, 'fallback') ? item.fallback : metadata.fallback, fallbackReason: Object.hasOwn(item, 'fallbackReason') ? item.fallbackReason : metadata.fallbackReason }));
}

function lexicalMetadata() { return { mode: 'lexical', grammar: null, fallback: null, fallbackReason: null }; }

function analyzePath(path, root, config, diagnostics, files, sharedState) {
  try {
    const absolutePath = resolve(root, path);
    const source = sharedState.sourceCache.has(absolutePath) ? sharedState.sourceCache.get(absolutePath) : readFileSync(absolutePath, 'utf8');
    sharedState.sourceCache.set(absolutePath, source);
    diagnostics.push(...analyzeSource(path, source, { config, state: { ...sharedState, path, importedSqlFunctions: collectImportedNames(source) } }));
    files.push(fileCoverage(path));
  }
  catch (error) { diagnostics.push(diagnostic(path, null, 'sensor/read-error', 'ERROR', error.message)); files.push(fileCoverage(path)); }
}

function fileCoverage(path) {
  const resolved = resolveRegistryEntry(path);
  if (!resolved) return { path, language: null, parser: 'missing', syntaxAware: false, capabilities: { quality: 'MISSING', security: 'MISSING', ui: 'N/A', dataConfig: 'N/A' } };
  const state = resolved.syntaxAware ? 'loaded' : resolved.fallback ? 'fallback' : 'missing';
  const mapped = Object.fromEntries(Object.entries(resolved.capabilities).map(([name, status]) => [name, resolved.syntaxAware || status !== 'PASS' ? status : 'PARTIAL']));
  return { path, language: resolved.id, parser: state, syntaxAware: resolved.syntaxAware, mode: resolved.actualMode, grammar: resolved.grammar && resolved.package ? `${resolved.package}@${resolved.version}` : resolved.parserKind === 'structured' ? 'node:json' : null, parserVersion: resolved.version, origin: resolved.qualification?.provenance ?? null, evidence: resolved.qualification, capabilities: mapped };
}

function analyzeAst(path, source, parserSource, entry, config, diagnostics, inheritedState) {
  const tree = parseTree(entry.grammar, parserSource);
  if (tree.rootNode.hasError) diagnostics.push(diagnostic(path, firstError(tree.rootNode), 'sensor/syntax-error', 'ERROR', 'Source contains a syntax error.'));
  let count = 0; let maxDepth = 0; const state = inheritedState ?? { sqlVariables: new Set(), sqlFunctions: new Set(), sqlExports: new Map(), importedSqlFunctions: Object.create(null), taintedVariables: new Set() };
  state.ir = normalizeTree(tree.rootNode, source);
  state.sqlVariables ??= new Set(); state.sqlFunctions ??= new Set(); state.sqlExports ??= new Map(); state.importedSqlFunctions ??= Object.create(null);
  state.taintedVariables ??= new Set();
  walk(tree.rootNode, 0, (node, depth) => { count += 1; maxDepth = Math.max(maxDepth, depth); inspectAst(path, source, node, diagnostics, config, state, entry.language); });
  const complexity = config.complexity ?? { maxNodes: 2000, maxDepth: 80 };
  if (count > complexity.maxNodes || maxDepth > complexity.maxDepth) diagnostics.push(diagnostic(path, tree.rootNode, 'sensor/excessive-complexity', 'WARN', `AST complexity ${count} nodes / depth ${maxDepth} exceeds ${complexity.maxNodes} / ${complexity.maxDepth}.`));
}

function inspectAst(path, source, node, diagnostics, config, state, language) {
  const text = source.slice(node.startIndex, node.endIndex);
  if (node.type.endsWith('comment') && /\b(?:TODO|FIXME|HACK)\b/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/quality/todo', 'WARN', 'Production code contains an unfinished TODO/FIXME/HACK marker.'));
  if (language === 'ruby' || language === 'erb') inspectRubyAst(path, source, node, diagnostics, config);
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
    if (name === 'console.log' || name === 'console.debug') diagnostics.push(diagnostic(path, node, 'sensor/quality/debug-output', 'WARN', 'Debug output should not ship in production code.'));
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
  if (node.type === 'debugger_statement') diagnostics.push(diagnostic(path, node, 'sensor/quality/debugger', 'WARN', 'Debugger statements should not ship in production code.'));
  if (node.type === 'catch_clause' && !node.namedChildren.some(child => child.type !== 'identifier')) diagnostics.push(diagnostic(path, node, 'sensor/quality/empty-catch', 'WARN', 'Empty catch blocks hide failures and should be handled explicitly.'));
  if (node.type === 'assignment_expression' && /(?:innerHTML|outerHTML)\s*=/u.test(text) && /<(?:style|script)\b|style\s*=/iu.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/ui-mixed-markup', 'WARN', 'HTML/CSS is embedded in a runtime string; keep UI structure and styles in their respective layers.'));
  if (node.type === 'jsx_attribute' && /^dangerouslySetInnerHTML\b/u.test(text)) diagnostics.push(diagnostic(path, node, 'sensor/xss', 'UNSAFE', 'Raw HTML is injected into a JSX element.'));
  if (node.type === 'property_identifier' && node.text === '__proto__') diagnostics.push(diagnostic(path, node, 'sensor/prototype-pollution', 'UNSAFE', 'Prototype mutation through __proto__ is forbidden.'));
}

function inspectRubyAst(path, source, node, diagnostics, config) {
  if (node.type !== 'call') {
    if (node.type === 'element_reference' && isRawErbNode(source, node) && rubyRequestControlled(node)) diagnostics.push(diagnostic(path, node, 'sensor/xss', 'UNSAFE', 'ERB raw output renders request-controlled data without escaping.'));
    return;
  }
  const receiver = node.childForFieldName('receiver');
  const method = node.childForFieldName('method')?.text ?? node.namedChildren[0]?.text ?? '';
  const name = receiver ? `${receiver.text}.${method}` : method;
  const argumentsNode = node.childForFieldName('arguments');
  const firstArgument = argumentsNode?.namedChildren[0];
  const dynamic = rubyDynamic(firstArgument);
  const requestControlled = rubyRequestControlled(firstArgument);
  const sqlSinks = new Set(['find_by_sql', 'find_by_query', 'execute', 'exec_query', 'select_all', 'where', 'order', 'pluck', 'select']);
  const shellSinks = /^(?:system|exec|spawn|Open3\.(?:capture\d?|popen\d?|pipeline))$/u;
  const fileSinks = /^(?:send_file|send_data|File\.(?:write|binwrite|open)|IO\.write)$/u;
  const redirectSinks = new Set(['redirect_to', 'redirect_back']);

  if (method === 'eval') diagnostics.push(diagnostic(path, node, 'sensor/dynamic-eval', 'UNSAFE', 'Dynamic eval execution is forbidden.'));
  if (sqlSinks.has(method) && dynamic) diagnostics.push(diagnostic(path, node, 'sensor/sql-injection', 'UNSAFE', 'Ruby SQL query is dynamically constructed; use bind parameters or an ORM parameter API.'));
  if (shellSinks.test(name) && (dynamic || requestControlled || !rubyLiteral(firstArgument))) diagnostics.push(diagnostic(path, node, 'sensor/dynamic-execution', 'UNSAFE', 'Ruby command execution uses dynamic data.'));
  if (shellSinks.test(name) && rubyLiteral(firstArgument)) {
    const command = unquote(firstArgument.text).toLowerCase();
    if ((config.dangerousCommands ?? []).some(value => command.includes(String(value).toLowerCase()))) diagnostics.push(diagnostic(path, node, 'sensor/dangerous-shell-command', 'UNSAFE', 'Dangerous shell command detected.'));
  }
  if (fileSinks.test(name) && requestControlled) diagnostics.push(diagnostic(path, node, 'sensor/path-traversal', 'UNSAFE', 'Rails file output uses request-controlled data; validate an allowlisted path.'));
  if (redirectSinks.has(method) && requestControlled) diagnostics.push(diagnostic(path, node, 'sensor/open-redirect', 'WARN', 'Rails redirect destination is request-controlled; validate it against an allowlist.'));
  if (/^(?:Net::HTTP|URI|OpenURI|Faraday|HTTParty|RestClient)/u.test(receiver?.text ?? '') && /^(?:get|post|request|open|new)$/u.test(method) && (requestControlled || !rubyTrustedNetworkDestination(firstArgument))) diagnostics.push(diagnostic(path, node, 'sensor/ssrf', 'UNSAFE', 'Ruby network destination is dynamic or request-controlled; validate it against an allowlist.'));
  if (/^(?:Digest::)?(?:MD5|SHA1)$/iu.test(receiver?.text ?? '') || /\b(?:OpenSSL::Cipher\.new\(['"](?:des|rc4)|Digest::(?:MD5|SHA1))/iu.test(node.text)) diagnostics.push(diagnostic(path, node, 'sensor/weak-crypto', 'WARN', 'A weak or legacy Ruby cryptographic primitive is used.'));
  const inlinePair = argumentsNode?.namedChildren.find(child => child.type === 'pair' && /^(?:inline|html):/u.test(child.text));
  if (method === 'render' && inlinePair && rubyRequestControlled(inlinePair)) diagnostics.push(diagnostic(path, node, 'sensor/rails-unsafe-render', 'WARN', 'Rails inline rendering uses request-controlled data.'));
  if ((method === 'raw' && requestControlled) || method === 'html_safe') diagnostics.push(diagnostic(path, node, 'sensor/rails-unsafe-render', 'WARN', 'Rails rendering bypasses automatic HTML escaping; sanitize the value.'));
  if (receiver?.text === 'params' && method === 'permit!') diagnostics.push(diagnostic(path, node, 'sensor/rails-unpermitted-params', 'WARN', 'params.permit! bypasses an explicit strong-parameter allowlist.'));
  if (/^[A-Z]/u.test(receiver?.text ?? '') && /^(?:new|create|create!|update|update!|assign_attributes)$/u.test(method) && firstArgument?.text === 'params') diagnostics.push(diagnostic(path, node, 'sensor/rails-unpermitted-params', 'WARN', 'Rails model assignment should use an explicit params permit list.'));
  if (/^(?:puts|p|pp|print|warn|byebug|debugger)$/u.test(method) || name === 'binding.irb') diagnostics.push(diagnostic(path, node, 'sensor/quality/debug-output', 'WARN', 'Ruby debug output or an interactive breakpoint should not ship in production code.'));
}

function rubyDynamic(node) {
  if (!node) return false;
  if (node.type === 'interpolation') return true;
  if (node.type === 'binary' && node.children.some(child => child.text === '+' || child.text === '<<')) return true;
  return node.namedChildren.some(rubyDynamic);
}
function rubyRequestControlled(node) {
  if (!node) return false;
  if (node.type === 'identifier' && /^(?:params|request)$/u.test(node.text)) return true;
  if (node.type === 'call' && /^(?:params|request)$/u.test(node.childForFieldName('receiver')?.text ?? '')) return true;
  return node.namedChildren.some(rubyRequestControlled);
}
function rubyLiteral(node) { return Boolean(node && /^(?:string|string_array|symbol|simple_symbol)$/u.test(node.type) && !rubyDynamic(node)); }
function rubyTrustedNetworkDestination(node) {
  if (rubyLiteral(node)) return true;
  if (node?.type !== 'call') return false;
  const method = node.childForFieldName('method')?.text ?? node.namedChildren[0]?.text ?? '';
  return /^(?:URI|parse)$/u.test(method) && rubyLiteral(node.childForFieldName('arguments')?.namedChildren[0]);
}
function unquote(value) { return value.replace(/^['"]|['"]$/gu, ''); }
function isRawErbNode(source, node) {
  const open = source.lastIndexOf('<%', node.startIndex);
  return open >= 0 && source.slice(open, open + 4).startsWith('<%==') && source.indexOf('%>', open) >= node.endIndex;
}

function analyzeSql(path, source, diagnostics, config = {}) {
  const code = maskSql(source);
  for (const match of code.matchAll(/(?:select|insert|update|delete|where|from)[\s\S]{0,180}(?:\+|\|\||\$\{)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  for (const match of code.matchAll(/\b(?:execute|query|prepare)\s*\([^\n;]*(?:\$\{|\+|\|\|)[^\n;]*\)/giu)) diagnostics.push(lineDiagnostic(path, source, match.index, 'sensor/sql-injection', 'UNSAFE', 'SQL query is dynamically constructed and may contain untrusted string data.'));
  if (config.sql?.requireLimit && /\b(?:select|update|delete)\b/iu.test(code) && !hasSqlLimit(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unbounded-query', 'WARN', `SQL query has no LIMIT clause; bound result size to ${config.sql.maxRows ?? 1000} rows.`));
  if (config.sql?.requireMutationFilter && isUnfilteredMutation(code)) diagnostics.push(lineDiagnostic(path, source, 0, 'sensor/sql-unfiltered-mutation', 'UNSAFE', 'UPDATE or DELETE query has no WHERE filter; require an explicit mutation predicate.'));
}

function analyzeJson(path, source, diagnostics) {
  try { JSON.parse(source); }
  catch (error) {
    const position = Number.parseInt(String(error.message).match(/position\s+(\d+)/u)?.[1] ?? '0', 10);
    diagnostics.push(lineDiagnostic(path, source, Number.isInteger(position) ? position : 0, 'sensor/syntax-error', 'ERROR', 'JSON contains a syntax error.'));
  }
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
function analyzeSingleFileComponent(path, source, diagnostics, config, format = 'component') {
  if (format === 'astro') {
    const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(source);
    if (frontmatter) appendEmbeddedDiagnostics(path, source, frontmatter.index + frontmatter[0].indexOf(frontmatter[1]), analyzeSource(`${path}.ts`, frontmatter[1], { config }), diagnostics);
  }
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
  for (const item of embedded) {
    const localLines = sourceOffsetForPosition(source.slice(offset), item.line, item.column);
    const mapped = lineDiagnostic(path, source, offset + localLines, item.rule, item.severity, item.message);
    diagnostics.push({ ...item, ...mapped, path });
  }
}
function sourceOffsetForPosition(source, line, column) {
  let offset = 0;
  for (let current = 1; current < line; current += 1) { const next = source.indexOf('\n', offset); if (next < 0) return source.length; offset = next + 1; }
  return Math.min(source.length, offset + Math.max(0, column - 1));
}
function analyzeNotebook(path, source, diagnostics, config) {
  let notebook;
  try { notebook = JSON.parse(source); }
  catch (error) { diagnostics.push(lineDiagnostic(path, source, jsonErrorOffset(error), 'sensor/syntax-error', 'ERROR', 'Notebook JSON contains a syntax error.')); return; }
  const language = String(notebook.metadata?.kernelspec?.language ?? notebook.metadata?.language_info?.name ?? 'python').toLowerCase();
  const extension = /^(?:javascript|typescript|node)$/u.test(language) ? (language === 'typescript' ? '.ts' : '.js') : '.py';
  let cursor = 0;
  for (const cell of notebook.cells ?? []) {
    if (cell?.cell_type !== 'code') continue;
    const fragments = Array.isArray(cell.source) ? cell.source : [String(cell.source ?? '')];
    const code = fragments.join('');
    const token = JSON.stringify(fragments[0] ?? '').slice(1, -1);
    const encodedOffset = token ? source.indexOf(token, cursor) : cursor;
    const cellOffset = encodedOffset < 0 ? cursor : encodedOffset;
    cursor = Math.max(cursor, cellOffset + token.length);
    appendEmbeddedDiagnostics(path, source, cellOffset, analyzeSource(`${path}${extension}`, code, { config }), diagnostics);
  }
}
function jsonErrorOffset(error) { const match = /position\s+(\d+)/iu.exec(error.message); return match ? Number(match[1]) : 0; }
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
  try {
    const rules = JSON.parse(readFileSync(resolve(root, '.project/sensor-rules.json'), 'utf8'));
    const project = JSON.parse(readFileSync(resolve(root, '.project/project-config.json'), 'utf8'));
    return { ...rules, languages: project.quality?.sensor?.languages ?? [] };
  }
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
      const resolved = resolveRegistryEntry(path);
      if (resolved?.parserKind === 'native' && resolved.grammar && !['ruby', 'erb'].includes(resolved.language)) indexDynamicExports(source, resolved.grammar, resolved.language, path, root, exports);
      else if (extension === '.vue' || extension === '.svelte') {
        for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)) {
          const extensionPath = /\blang\s*=\s*["'](?:tsx|jsx)["']/iu.test(match[1]) ? 'embedded.tsx' : /\blang\s*=\s*["'](?:ts|typescript)["']/iu.test(match[1]) ? 'embedded.ts' : 'embedded.js';
          const embedded = resolveRegistryEntry(extensionPath);
          indexDynamicExports(match[2], embedded?.grammar, embedded?.language, path, root, exports);
        }
      }
    } catch { /* the normal scan emits the authoritative read/syntax diagnostic */ }
  }
  return exports;
}
function indexDynamicExports(source, grammar, language, path, root, exports) {
  if (!grammar) return;
  const tree = parseTree(grammar, source);
  walk(tree.rootNode, 0, node => {
    const pythonModuleFunction = language === 'python' && node.type === 'function_definition' && node.parent?.type === 'module';
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
function parseTree(grammar, source) {
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser.parse(source, undefined, { bufferSize: Math.max(32_768, Buffer.byteLength(source, 'utf8') + 1) });
}
function isExported(node) { let parent = node.parent; while (parent) { if (parent.type === 'export_statement') return true; if (parent.type === 'program' || parent.type === 'module') return false; parent = parent.parent; } return false; }
function collectImportedNames(source) {
  const names = Object.create(null);
  for (const match of source.matchAll(/\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gu)) {
    for (const item of (match[1] ?? match[2]).split(',')) {
      const parts = item.trim().split(/\s+as\s+/iu).map(value => value.trim());
      if (parts[0]) names[parts.at(-1)] = { original: parts[0], module: match[2] };
    }
  }
  for (const match of source.matchAll(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gu)) names[match[1]] = { namespace: true, module: match[2] };
  for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gu)) names[match[1]] = { original: 'default', module: match[2] };
  for (const match of source.matchAll(/\bfrom\s+([A-Za-z0-9_./-]+)\s+import\s+([^\n]+)/gu)) {
    for (const item of match[2].split(',')) {
      const parts = item.trim().split(/\s+as\s+/iu).map(value => value.trim());
      if (parts[0]) names[parts.at(-1)] = { original: parts[0], module: match[1] };
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    for (const item of match[1].split(',')) {
      const parts = item.trim().split(/\s*:\s*/u).map(value => value.trim());
      if (parts[0]) names[parts.at(-1)] = { original: parts[0], module: match[2] };
    }
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\.([A-Za-z_$][\w$]*)/gu)) {
    names[match[1]] = { original: match[3], module: match[2] };
  }
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    if (!Object.hasOwn(names, match[1])) names[match[1]] = { namespace: true, module: match[2] };
  }
  return names;
}
function importedBinding(name, state) {
  const direct = state.importedSqlFunctions[name];
  if (direct) return direct;
  const [namespace, ...members] = name.split('.');
  const member = members.at(-1);
  const binding = state.importedSqlFunctions[namespace];
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
  if (!config || config !== Object(config) || Array.isArray(config)) errors.push('configuration must be an object');
  else {
    if (config.schemaVersion !== 1) errors.push('schemaVersion must equal 1');
    if (config.languages !== undefined && (!Array.isArray(config.languages) || config.languages.some(value => value !== String(value) || !value))) errors.push('languages must be an array of non-empty strings');
    if (config.analysis !== undefined && (!config.analysis || config.analysis !== Object(config.analysis) || Array.isArray(config.analysis))) errors.push('analysis must be an object');
    if (config.analysis?.moduleScope !== undefined && config.analysis.moduleScope !== 'explicit-paths') errors.push('analysis.moduleScope must equal explicit-paths');
    if (config.analysis?.packageResolution !== undefined && config.analysis.packageResolution !== 'disabled') errors.push('analysis.packageResolution must equal disabled');
    if (!Array.isArray(config.dangerousCommands) || config.dangerousCommands.some(value => value !== String(value))) errors.push('dangerousCommands must be an array of strings');
    if (config.complexity && (!Number.isInteger(config.complexity.maxNodes) || !Number.isInteger(config.complexity.maxDepth) || config.complexity.maxNodes < 1 || config.complexity.maxDepth < 1)) errors.push('complexity.maxNodes and complexity.maxDepth must be positive integers');
    if (config.sql) {
      if (!Array.isArray(config.sql.sinks) || config.sql.sinks.some(value => value !== String(value) || !value)) errors.push('sql.sinks must be a non-empty array of strings');
      if (config.sql.requireLimit !== undefined && (config.sql.requireLimit !== true && config.sql.requireLimit !== false)) errors.push('sql.requireLimit must be boolean');
      if (config.sql.requireMutationFilter !== undefined && (config.sql.requireMutationFilter !== true && config.sql.requireMutationFilter !== false)) errors.push('sql.requireMutationFilter must be boolean');
      if (config.sql.requireRateLimit !== undefined && (config.sql.requireRateLimit !== true && config.sql.requireRateLimit !== false)) errors.push('sql.requireRateLimit must be boolean');
      if (config.sql.maxRows !== undefined && (!Number.isInteger(config.sql.maxRows) || config.sql.maxRows < 1)) errors.push('sql.maxRows must be a positive integer');
      if (config.sql.taintSources !== undefined && (!Array.isArray(config.sql.taintSources) || config.sql.taintSources.some(value => value !== String(value) || !value))) errors.push('sql.taintSources must be an array of non-empty strings');
      if (config.sql.rateLimitGuards !== undefined && (!Array.isArray(config.sql.rateLimitGuards) || config.sql.rateLimitGuards.some(value => value !== String(value) || !value))) errors.push('sql.rateLimitGuards must be an array of non-empty strings');
      if (config.sql.safeBuilders !== undefined && (!Array.isArray(config.sql.safeBuilders) || config.sql.safeBuilders.some(value => value !== String(value) || !value))) errors.push('sql.safeBuilders must be an array of non-empty strings');
    }
  }
  return errors.map(message => diagnostic('.project/sensor-rules.json', null, 'sensor/configuration', 'ERROR', message));
}
function sensorResult(verdict, diagnostics, files = []) { return { schemaVersion: 2, verdict, coverage: { ...SENSOR_COVERAGE, files }, diagnostics }; }
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
function categoryFor(rule) { if (/sql|secret|ssrf|path-traversal|xss|crypto|shell|eval|function|prototype/u.test(rule)) return 'security'; if (/ui|css/u.test(rule)) return 'architecture'; if (/anti-slop|quality|complexity/u.test(rule)) return 'quality'; return 'safety'; }
function isLiteralNode(node) { return Boolean(node && ['string', 'template_string', 'string_content', 'integer', 'float'].includes(node.type)); }
function isPathSink(name) { return /(?:^|\.)(?:readFile|readFileSync|writeFile|writeFileSync|appendFile|appendFileSync|open|sendFile|download|unlink|rm|rmdir)$/u.test(name); }
function isRedirect(name) { return /(?:^|\.)(?:redirect|redirectTo|sendRedirect)$/u.test(name); }
function isWeakCrypto(name) { return /(?:^|\.)(?:md5|sha1|createHash\(['"](?:md5|sha1)|des|rc4)$/iu.test(name); }
