import { createRequire } from 'node:module';
import { basename, extname } from 'node:path';

const require = createRequire(import.meta.url);
const freezeList = values => Object.freeze(values);
const entry = value => Object.freeze({
  package: null,
  variant: null,
  grammar: null,
  extractor: null,
  available: false,
  fallbackAllowed: false,
  fallbackReason: null,
  ...value,
  extensions: freezeList(value.extensions ?? []),
  filenames: freezeList(value.filenames ?? []),
});

/** The only language/adapter registry used by the Context MCP and Sensor. */
export const AST_REGISTRY = Object.freeze([
  entry({ id: 'javascript', language: 'javascript', extensions: ['.js', '.jsx', '.mjs', '.cjs'], package: 'tree-sitter-javascript', mode: 'AST', available: true }),
  entry({ id: 'typescript', language: 'typescript', extensions: ['.ts'], package: 'tree-sitter-typescript', variant: 'typescript', mode: 'AST', available: true }),
  entry({ id: 'tsx', language: 'tsx', extensions: ['.tsx'], package: 'tree-sitter-typescript', variant: 'tsx', mode: 'AST', available: true }),
  entry({ id: 'python', language: 'python', extensions: ['.py'], package: 'tree-sitter-python', mode: 'AST', available: true }),
  entry({ id: 'ruby', language: 'ruby', extensions: ['.rb', '.rake', '.ru'], filenames: ['Gemfile', 'Rakefile', 'config.ru'], package: 'tree-sitter-ruby', mode: 'AST', available: true, fallbackAllowed: true, fallbackReason: 'tree-sitter-ruby could not be loaded' }),
  entry({ id: 'erb', sensorAdapter: 'template', language: 'erb', extensions: ['.erb'], package: 'tree-sitter-ruby', mode: 'embedded', extractor: 'erb-ruby-mask', available: true, fallbackAllowed: true, fallbackReason: 'tree-sitter-ruby could not be loaded for embedded ERB' }),
  entry({ id: 'sql', language: 'sql', extensions: ['.sql'], mode: 'lexical' }),
  entry({ id: 'html', language: 'html', extensions: ['.html', '.htm'], mode: 'embedded', extractor: 'html' }),
  entry({ id: 'css', language: 'css', extensions: ['.css', '.scss', '.sass'], mode: 'lexical' }),
  entry({ id: 'single-file-component', language: 'component', extensions: ['.vue', '.svelte'], mode: 'embedded', extractor: 'script-style-blocks' }),
  entry({ id: 'template', language: 'template', extensions: ['.haml', '.slim', '.heex', '.leex', '.j2', '.jinja', '.jinja2', '.twig', '.tera', '.hbs', '.handlebars', '.liquid', '.ejs', '.pug', '.jade', '.cshtml', '.razor', '.jsp', '.jspx'], mode: 'embedded', extractor: 'template-blocks' }),
  entry({ id: 'blade', sensorAdapter: 'template', language: 'php', mode: 'embedded', extractor: 'blade-php', match: path => path.toLowerCase().endsWith('.blade.php') }),
  entry({ id: 'lexical-source', language: 'source', filenames: ['Dockerfile', 'Makefile', 'Justfile'], extensions: [
    '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.cs',
    '.php', '.swift', '.sh', '.bash', '.zsh', '.dart', '.ex', '.exs', '.erl', '.hrl',
    '.fs', '.fsx', '.fsi', '.hs', '.lhs', '.lua', '.r', '.scala', '.sc', '.clj', '.cljs', '.cljc',
    '.groovy', '.m', '.mm', '.zig', '.nim', '.pl', '.pm', '.t', '.vb', '.vbs', '.v', '.sv',
    '.sol', '.move', '.asm', '.s', '.pas', '.f', '.for', '.f03', '.f90', '.f95',
  ], mode: 'lexical' }),
  entry({ id: 'lexical-data', language: 'data', filenames: ['.env', '.env.example', '.env.local'], extensions: [
    '.toml', '.yaml', '.yml', '.json', '.xml', '.proto', '.graphql', '.gql', '.ini', '.cfg',
    '.conf', '.properties', '.env', '.tf', '.tfvars', '.hcl', '.cue', '.dhall', '.nix',
  ], mode: 'lexical' }),
]);

export const SENSOR_ADAPTERS = AST_REGISTRY;
export const SENSOR_OPTIONAL_PARSERS = Object.freeze(AST_REGISTRY.filter(item => item.fallbackAllowed));

export function registryEntry(path) {
  const extension = extname(path).toLowerCase();
  const name = basename(path);
  return AST_REGISTRY.find(item => item.match?.(path) || item.extensions.includes(extension) || item.filenames.includes(name)) ?? null;
}

export function loadGrammar(item, loader = require) {
  if (!item?.package) return null;
  const loaded = loader(item.package);
  const module = loaded?.default ?? loaded;
  return item.variant ? module?.[item.variant] ?? null : module;
}

export function resolveRegistryEntry(path, loader = require) {
  const declared = registryEntry(path);
  if (!declared) return null;
  let grammar = null;
  let loadError = null;
  if (declared.package) {
    try { grammar = loadGrammar(declared, loader); }
    catch (error) { loadError = error instanceof Error ? error.message : String(error); }
    if (!grammar && !loadError) loadError = `${declared.package}${declared.variant ? `/${declared.variant}` : ''} did not export a grammar`;
  }
  const fallback = declared.package && !grammar && declared.fallbackAllowed ? 'lexical' : null;
  return {
    ...declared,
    grammar,
    available: declared.package ? Boolean(grammar) : false,
    actualMode: grammar ? declared.mode : fallback ?? declared.mode,
    fallback,
    fallbackReason: fallback ? loadError ?? declared.fallbackReason : null,
    loadError,
  };
}

export function grammarStatus(loader = require) {
  return AST_REGISTRY.map(item => {
    const samplePath = item.extensions[0] ? `sample${item.extensions[0]}` : item.filenames[0] ?? (item.id === 'blade' ? 'sample.blade.php' : 'unknown');
    const resolved = resolveRegistryEntry(samplePath, loader);
    return {
      id: item.id,
      language: item.language,
      extensions: item.extensions,
      filenames: item.filenames,
      package: item.package,
      variant: item.variant,
      mode: resolved?.actualMode ?? item.mode,
      extractor: item.extractor,
      available: resolved?.available ?? false,
      fallbackAllowed: item.fallbackAllowed,
      fallback: resolved?.fallback ?? null,
      fallbackReason: resolved?.fallbackReason ?? null,
      runtime: 'tree-sitter@0.21.1',
    };
  });
}

export function checkGrammarCompatibility(loader = require) {
  return AST_REGISTRY.filter(item => item.package).map(item => {
    try {
      const grammar = loadGrammar(item, loader);
      if (!grammar) throw new Error('Grammar export is missing.');
      return { language: item.language, package: item.package, variant: item.variant, mode: item.mode, compatible: true, error: null };
    } catch (error) {
      return { language: item.language, package: item.package, variant: item.variant, mode: item.mode, compatible: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export function adapterMetadata(path, loader = require) {
  const resolved = resolveRegistryEntry(path, loader);
  return {
    adapter: resolved?.sensorAdapter ?? resolved?.id ?? 'unsupported',
    mode: resolved?.actualMode ?? 'unsupported',
    grammar: resolved?.grammar ? resolved.package : null,
    fallback: resolved?.fallback ?? null,
    fallbackReason: resolved?.fallbackReason ?? null,
  };
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

export function extractEmbeddedSource(item, source) {
  return item?.extractor === 'erb-ruby-mask' ? maskErbRuby(source) : source;
}
