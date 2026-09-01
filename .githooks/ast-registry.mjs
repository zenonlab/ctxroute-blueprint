import { createRequire } from 'node:module';
import { basename, extname } from 'node:path';

const require = createRequire(import.meta.url);
const freeze = values => Object.freeze(values);
const CAPABILITIES = ['quality', 'security', 'ui', 'dataConfig'];
const evidence = value => Object.freeze({
  parserLoaded: false,
  fixtures: Object.freeze({ valid: false, invalid: false, positions: false }),
  rules: Object.freeze({}),
  platforms: Object.freeze([]),
  provenance: null,
  checksum: null,
  ...value,
});
const capabilityState = (name, proof, parserKind) => {
  if (proof === 'N/A') return 'N/A';
  if (!proof) return 'MISSING';
  const parserProven = parserKind === 'structured' || proof.parser === true;
  const fixturesProven = proof.fixtures === true;
  const rulesProven = proof.rules === true;
  const platformsProven = proof.platforms === true;
  return parserProven && fixturesProven && rulesProven && platformsProven ? 'PASS' : 'PARTIAL';
};
const capabilities = (proof, parserKind) => Object.freeze(Object.fromEntries(CAPABILITIES.map(name => [name, capabilityState(name, proof?.[name], parserKind)])));
const entry = value => Object.freeze({
  package: null, version: null, variant: null, grammar: null, extractor: null, mode: 'lexical',
  parserKind: 'lexical', support: 'partial', fallbackAllowed: true,
  fallbackReason: 'No verified parser pack is installed.',
  ...value,
  language: value.language ?? value.id,
  aliases: freeze(value.aliases ?? []), extensions: freeze(value.extensions ?? []), filenames: freeze(value.filenames ?? []),
  platforms: freeze(value.platforms ?? ['linux', 'darwin', 'win32']),
  qualification: evidence(value.qualification),
  capabilities: capabilities(value.capabilityEvidence, value.parserKind ?? 'lexical'),
});
const fullProof = Object.freeze({ parser: true, fixtures: true, rules: true, platforms: true });
const qualified = (provenance, checksum = null) => ({ parserLoaded: true, fixtures: { valid: true, invalid: true, positions: true }, rules: { common: true, security: true }, platforms: ['linux', 'darwin', 'win32'], provenance, checksum });
const ast = value => entry({ parserKind: 'native', support: 'stable', fallbackAllowed: true, fallbackReason: 'The required grammar could not be loaded.', capabilityEvidence: { quality: fullProof, security: fullProof, ui: 'N/A', dataConfig: 'N/A' }, qualification: qualified(`npm:${value.package}@${value.version}`), ...value });
const structured = value => entry({ parserKind: 'structured', support: 'stable', fallbackAllowed: false, fallbackReason: null, capabilityEvidence: { quality: { parser: true, fixtures: true, rules: false, platforms: true }, security: { parser: true, fixtures: true, rules: false, platforms: true }, ui: 'N/A', dataConfig: fullProof }, qualification: qualified('node:json'), ...value });
const partial = value => entry({ parserKind: value.extractor ? 'extractor' : 'lexical', support: 'partial', capabilityEvidence: { quality: { parser: false, fixtures: true, rules: true, platforms: true }, security: { parser: false, fixtures: true, rules: true, platforms: true }, ui: value.extractor ? { parser: false, fixtures: true, rules: true, platforms: true } : 'N/A', dataConfig: 'N/A' }, ...value });
const missing = value => entry({ parserKind: 'lexical', support: 'missing', fallbackReason: 'No Node 22 parser pack has been verified for this language.', capabilityEvidence: { quality: null, security: value.capabilities?.dataConfig ? 'N/A' : null, ui: 'N/A', dataConfig: value.capabilities?.dataConfig ? null : 'N/A' }, ...value });

export const CATALOG_VERSION = 2;
export const LANGUAGE_CATALOG = Object.freeze([
  ast({ id: 'javascript', aliases: ['js', 'jsx', 'node'], extensions: ['.js', '.jsx', '.mjs', '.cjs'], package: 'tree-sitter-javascript', version: '0.23.1', mode: 'AST', qualification: qualified('npm:tree-sitter-javascript@0.23.1', 'sha512-/bnhbrTD9frUYHQTiYnPcxyHORIw157ERBa6dqzaKxvR/x3PC4Yzd+D1pZIMS6zNg2v3a8BZ0oK7jHqsQo9fWA==') }),
  ast({ id: 'typescript', aliases: ['ts'], extensions: ['.ts'], package: 'tree-sitter-typescript', version: '0.23.2', variant: 'typescript', mode: 'AST', qualification: qualified('npm:tree-sitter-typescript@0.23.2', 'sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==') }),
  ast({ id: 'tsx', aliases: ['typescript-react'], extensions: ['.tsx'], package: 'tree-sitter-typescript', version: '0.23.2', variant: 'tsx', mode: 'AST', qualification: qualified('npm:tree-sitter-typescript@0.23.2', 'sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==') }),
  ast({ id: 'python', aliases: ['py'], extensions: ['.py'], package: 'tree-sitter-python', version: '0.21.0', mode: 'AST', qualification: qualified('npm:tree-sitter-python@0.21.0', 'sha512-IUKx7JcTVbByUx1iHGFS/QsIjx7pqwTMHL9bl/NGyhyyydbfNrpruo2C7W6V4KZrbkkCOlX8QVrCoGOFW5qecg==') }),
  ast({ id: 'ruby', aliases: ['rb'], extensions: ['.rb', '.rake', '.ru'], filenames: ['Gemfile', 'Rakefile', 'config.ru'], package: 'tree-sitter-ruby', version: '0.23.1', mode: 'AST', qualification: qualified('npm:tree-sitter-ruby@0.23.1', 'sha512-d9/RXgWjR6HanN7wTYhS5bpBQLz1VkH048Vm3CodPGyJVnamXMGb8oEhDypVCBq4QnHui9sTXuJBBP3WtCw5RA==') }),
  ast({ id: 'erb', language: 'ruby', aliases: ['html-erb'], sensorAdapter: 'template', extensions: ['.erb'], package: 'tree-sitter-ruby', version: '0.23.1', mode: 'embedded', parserKind: 'extractor', extractor: 'erb-ruby-mask', qualification: qualified('npm:tree-sitter-ruby@0.23.1', 'sha512-d9/RXgWjR6HanN7wTYhS5bpBQLz1VkH048Vm3CodPGyJVnamXMGb8oEhDypVCBq4QnHui9sTXuJBBP3WtCw5RA=='), capabilityEvidence: { quality: fullProof, security: fullProof, ui: { parser: true, fixtures: true, rules: true, platforms: false }, dataConfig: 'N/A' } }),
  structured({ id: 'json', extensions: ['.json'], mode: 'structured' }),
  partial({ id: 'sql', extensions: ['.sql'], mode: 'lexical', capabilityEvidence: { quality: { parser: false, fixtures: true, rules: true, platforms: true }, security: { parser: false, fixtures: true, rules: true, platforms: true }, ui: 'N/A', dataConfig: { parser: false, fixtures: true, rules: true, platforms: true } } }),
  partial({ id: 'html', extensions: ['.html', '.htm'], mode: 'embedded', extractor: 'html' }),
  partial({ id: 'css', extensions: ['.css', '.scss', '.sass'], mode: 'lexical', capabilityEvidence: { quality: { parser: false, fixtures: true, rules: true, platforms: true }, security: 'N/A', ui: { parser: false, fixtures: true, rules: true, platforms: true }, dataConfig: 'N/A' } }),
  partial({ id: 'vue', extensions: ['.vue'], mode: 'embedded', extractor: 'script-style-blocks' }),
  partial({ id: 'svelte', extensions: ['.svelte'], mode: 'embedded', extractor: 'script-style-blocks' }),
  partial({ id: 'astro', extensions: ['.astro'], mode: 'embedded', extractor: 'astro-frontmatter-script-style' }),
  partial({ id: 'notebook', aliases: ['jupyter', 'ipynb'], extensions: ['.ipynb'], mode: 'embedded', extractor: 'notebook-cells', capabilityEvidence: { quality: { parser: false, fixtures: true, rules: true, platforms: true }, security: { parser: false, fixtures: true, rules: true, platforms: true }, ui: 'N/A', dataConfig: { parser: false, fixtures: true, rules: true, platforms: true } } }),
  partial({ id: 'template', extensions: ['.haml', '.slim', '.heex', '.leex', '.j2', '.jinja', '.jinja2', '.twig', '.tera', '.hbs', '.handlebars', '.liquid', '.ejs', '.pug', '.jade', '.cshtml', '.razor', '.jsp', '.jspx'], mode: 'embedded', extractor: 'template-blocks', capabilities: { quality: 'PARTIAL', security: 'PARTIAL', ui: 'PARTIAL' } }),
  partial({ id: 'blade', language: 'php', aliases: ['laravel-blade'], sensorAdapter: 'template', mode: 'embedded', extractor: 'blade-php', match: path => path.toLowerCase().endsWith('.blade.php'), capabilities: { quality: 'PARTIAL', security: 'PARTIAL', ui: 'PARTIAL' } }),
  missing({ id: 'rust', extensions: ['.rs'] }), missing({ id: 'go', extensions: ['.go'] }), missing({ id: 'java', extensions: ['.java'] }),
  missing({ id: 'kotlin', extensions: ['.kt', '.kts'] }), missing({ id: 'c', extensions: ['.c', '.h'] }),
  missing({ id: 'cpp', aliases: ['c++'], extensions: ['.cc', '.cpp', '.cxx', '.hpp'] }), missing({ id: 'csharp', aliases: ['c#'], extensions: ['.cs'] }),
  missing({ id: 'php', extensions: ['.php'] }), missing({ id: 'swift', extensions: ['.swift'] }),
  missing({ id: 'shell', aliases: ['bash', 'sh', 'zsh'], extensions: ['.sh', '.bash', '.zsh'] }), missing({ id: 'dart', extensions: ['.dart'] }),
  missing({ id: 'elixir', extensions: ['.ex', '.exs'] }), missing({ id: 'erlang', extensions: ['.erl', '.hrl'] }),
  missing({ id: 'fsharp', aliases: ['f#'], extensions: ['.fs', '.fsx', '.fsi'] }), missing({ id: 'haskell', extensions: ['.hs', '.lhs'] }),
  missing({ id: 'lua', extensions: ['.lua'] }), missing({ id: 'r', extensions: ['.r'] }), missing({ id: 'scala', extensions: ['.scala', '.sc'] }),
  missing({ id: 'clojure', extensions: ['.clj', '.cljs', '.cljc'] }), missing({ id: 'groovy', extensions: ['.groovy'] }),
  missing({ id: 'objective-c', aliases: ['objc'], extensions: ['.m', '.mm'] }), missing({ id: 'zig', extensions: ['.zig'] }), missing({ id: 'nim', extensions: ['.nim'] }),
  missing({ id: 'perl', extensions: ['.pl', '.pm', '.t'] }), missing({ id: 'visual-basic', aliases: ['vb'], extensions: ['.vb', '.vbs'] }),
  missing({ id: 'verilog', extensions: ['.v'] }), missing({ id: 'systemverilog', extensions: ['.sv'] }), missing({ id: 'solidity', extensions: ['.sol'] }),
  missing({ id: 'move', extensions: ['.move'] }), missing({ id: 'assembly', aliases: ['asm'], extensions: ['.asm', '.s'] }),
  missing({ id: 'pascal', extensions: ['.pas'] }), missing({ id: 'fortran', extensions: ['.f', '.for', '.f03', '.f90', '.f95'] }),
  missing({ id: 'yaml', extensions: ['.yaml', '.yml'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'toml', extensions: ['.toml'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'xml', extensions: ['.xml'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'proto', extensions: ['.proto'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'graphql', extensions: ['.graphql', '.gql'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'ini', extensions: ['.ini', '.cfg', '.conf'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'properties', extensions: ['.properties'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'env', filenames: ['.env', '.env.example', '.env.local'], extensions: ['.env'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'terraform', aliases: ['hcl'], extensions: ['.tf', '.tfvars', '.hcl'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'cue', extensions: ['.cue'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'dhall', extensions: ['.dhall'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'nix', extensions: ['.nix'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'dockerfile', filenames: ['Dockerfile'], capabilities: { dataConfig: 'MISSING' } }),
  missing({ id: 'makefile', filenames: ['Makefile'], capabilities: { dataConfig: 'MISSING' } }), missing({ id: 'justfile', filenames: ['Justfile'], capabilities: { dataConfig: 'MISSING' } }),
]);

export const LANGUAGE_PRESETS = Object.freeze({
  web: freeze(['javascript', 'typescript', 'tsx', 'json', 'html', 'css', 'vue', 'svelte', 'astro']),
  backend: freeze(['javascript', 'typescript', 'python', 'ruby', 'go', 'java', 'kotlin', 'php', 'csharp']),
  systems: freeze(['rust', 'go', 'c', 'cpp', 'zig', 'assembly']), mobile: freeze(['swift', 'kotlin', 'dart', 'objective-c']),
  templates: freeze(['erb', 'template', 'blade', 'html', 'vue', 'svelte', 'astro']),
  'data-config': freeze(['json', 'notebook', 'sql', 'yaml', 'toml', 'xml', 'proto', 'graphql', 'ini', 'properties', 'env', 'terraform', 'cue', 'dhall', 'nix', 'dockerfile', 'makefile', 'justfile']),
  all: freeze(LANGUAGE_CATALOG.map(item => item.id)),
});

export const AST_REGISTRY = LANGUAGE_CATALOG;
export const SENSOR_ADAPTERS = AST_REGISTRY;
export const SENSOR_OPTIONAL_PARSERS = Object.freeze([]);

export function catalogEntry(id) {
  const normalized = String(id).toLowerCase();
  return LANGUAGE_CATALOG.find(item => item.id === normalized || item.aliases.includes(normalized)) ?? null;
}

export function registryEntry(path) {
  const extension = extname(path).toLowerCase();
  const name = basename(path);
  return AST_REGISTRY.find(item => item.match?.(path) || item.extensions.includes(extension) || item.filenames.includes(name)) ?? null;
}

export function loadGrammar(item, loader = require) {
  if (!item?.package) return item?.parserKind === 'structured' ? { builtin: item.id } : null;
  const loaded = loader(item.package);
  const module = loaded?.default ?? loaded;
  return item.variant ? module?.[item.variant] ?? null : module;
}

export function resolveRegistryEntry(path, loader = require) {
  const declared = registryEntry(path);
  if (!declared) return null;
  let grammar = null;
  let loadError = null;
  try { grammar = loadGrammar(declared, loader); } catch (error) { loadError = error instanceof Error ? error.message : String(error); }
  if (declared.package && !grammar && !loadError) loadError = `${declared.package}${declared.variant ? `/${declared.variant}` : ''} did not export a grammar`;
  const syntaxAware = Boolean(grammar);
  const fallback = !syntaxAware && declared.fallbackAllowed ? 'lexical' : null;
  return { ...declared, grammar, available: syntaxAware, syntaxAware, actualMode: syntaxAware ? declared.mode : fallback ?? declared.mode, fallback,
    fallbackReason: fallback ? loadError ?? declared.fallbackReason : null, loadError,
    status: syntaxAware ? 'PASS' : declared.support === 'missing' ? 'MISSING' : 'PARTIAL' };
}

export function grammarStatus(loader = require) {
  return AST_REGISTRY.map(item => {
    const samplePath = item.extensions[0] ? `sample${item.extensions[0]}` : item.filenames[0] ?? (item.id === 'blade' ? 'sample.blade.php' : 'unknown');
    const resolved = resolveRegistryEntry(samplePath, loader) ?? { ...item, available: false, syntaxAware: false, actualMode: item.mode, status: item.support === 'missing' ? 'MISSING' : 'PARTIAL' };
    return { id: item.id, language: item.language, extensions: item.extensions, filenames: item.filenames, package: item.package, version: item.version,
      variant: item.variant, mode: resolved.actualMode, parserKind: item.parserKind, extractor: item.extractor, available: resolved.available,
      syntaxAware: resolved.syntaxAware, status: resolved.status, capabilities: item.capabilities, fallbackAllowed: item.fallbackAllowed,
      fallback: resolved.fallback, fallbackReason: resolved.fallbackReason, runtime: 'Node.js 22 / tree-sitter@0.21.1', platforms: item.platforms,
      qualification: item.qualification };
  });
}

export function checkGrammarCompatibility(loader = require) {
  return AST_REGISTRY.filter(item => item.package).map(item => {
    try {
      const grammar = loadGrammar(item, loader);
      if (!grammar) throw new Error('Grammar export is missing.');
      return { language: item.language, package: item.package, version: item.version, variant: item.variant, mode: item.mode, compatible: true, error: null };
    } catch (error) {
      return { language: item.language, package: item.package, version: item.version, variant: item.variant, mode: item.mode, compatible: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export function adapterMetadata(path, loader = require) {
  const resolved = resolveRegistryEntry(path, loader);
  return { adapter: resolved?.sensorAdapter ?? resolved?.id ?? 'unsupported', language: resolved?.id ?? null,
    mode: resolved?.actualMode ?? 'unsupported', grammar: resolved?.grammar && resolved.package ? resolved.package : null,
    fallback: resolved?.fallback ?? null, fallbackReason: resolved?.fallbackReason ?? null };
}

export function maskErbRuby(source) {
  const masked = source.split('').map(character => character === '\n' || character === '\r' ? character : ' ');
  for (const match of source.matchAll(/<%([=#-]{0,2})([\s\S]*?)%>/gu)) {
    if (match[1].includes('#')) continue;
    const body = match[2] ?? '';
    const bodyOffset = match.index + match[0].indexOf(body);
    for (let index = 0; index < body.length; index += 1) masked[bodyOffset + index] = body[index];
    masked[bodyOffset + body.length] = ';';
  }
  return masked.join('');
}

export function extractEmbeddedSource(item, source) { return item?.extractor === 'erb-ruby-mask' ? maskErbRuby(source) : source; }
