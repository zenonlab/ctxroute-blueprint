import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ADR_DIRECTORY = 'docs/decisions';
const ADR_NAME = /^ADR-(?!0000-)(\d{4})-(.+)\.md$/u;

export function parseAdr(source, file = '') {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u);
  if (!match) return { file, metadata: null, body: source, errors: ['missing YAML metadata front matter'] };
  const metadata = parseYamlSubset(match[1]);
  return { file, metadata, body: source.slice(match[0].length), errors: validateMetadata(metadata, file) };
}

export function loadAdrs(root = process.cwd()) {
  const directory = resolve(root, ADR_DIRECTORY);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && ADR_NAME.test(entry.name))
    .map(entry => {
      const file = join(ADR_DIRECTORY, entry.name).replace(/\\/gu, '/');
      return parseAdr(readFileSync(resolve(root, file), 'utf8'), file);
    }).sort((left, right) => left.file.localeCompare(right.file, 'en'));
}

export function matchScope(path, scope) {
  return Array.isArray(scope) && scope.some(pattern => typeof pattern === 'string' && globPattern(pattern).test(normalizePath(path)));
}

export function applicableAdrs(paths, root = process.cwd()) {
  const normalized = paths.map(normalizePath).filter(Boolean);
  return loadAdrs(root).filter(adr => !adr.errors.length && !adr.metadata['superseded-by'] && normalized.some(path => matchScope(path, adr.metadata.scope)));
}

export function decisionDiagnostics(paths, root = process.cwd()) {
  const normalized = paths.map(normalizePath).filter(Boolean);
  const adrs = loadAdrs(root);
  const invalid = adrs.filter(adr => adr.errors.length).map(adr => adr.file);
  const superseded = adrs
    .filter(adr => adr.metadata?.['superseded-by'] && normalized.some(path => matchScope(path, adr.metadata.scope)))
    .map(adr => `${adr.file} -> ${adr.metadata['superseded-by']}`);
  const applicable = applicableAdrs(normalized, root);
  const applicableFiles = new Set(applicable.map(adr => adr.file.split('/').pop()));
  const conflicts = applicable.flatMap(adr => (adr.metadata['conflicts-with'] ?? [])
    .filter(target => applicableFiles.has(target))
    .map(target => `${adr.file} conflicts-with ${target}`));
  return {
    status: conflicts.length ? 'conflict' : applicable.length > 1 ? 'partial' : 'complete',
    invalid,
    superseded,
    conflicts,
    applicable: applicable.map(adr => adr.file),
    message: conflicts.length
      ? 'Explicit ADR conflicts require revision or replacement before the change can continue.'
      : applicable.length > 1
      ? 'Multiple ADRs apply; semantic contradiction is outside scope without a dedicated analyzer.'
      : '',
  };
}

export function syncAdrRules(root = process.cwd()) {
  const directory = resolve(root, '.claude/hooks/docs/adr-memory');
  mkdirSync(directory, { recursive: true });
  const tracked = repositoryFiles(root);
  const active = new Set();
  for (const adr of loadAdrs(root)) {
    const name = `adr-${adr.file.split('/').pop()}`;
    const destination = join(directory, name);
    const covered = !adr.errors.length && !adr.metadata['superseded-by']
      ? tracked.filter(path => matchScope(path, adr.metadata.scope))
      : [];
    const source = covered.length
      ? ['---', 'tool: "*"', `scope: ${JSON.stringify(covered)}`, 'mode: once', '---', '', `# ${adr.file}`, '', adr.body.trim(), ''].join('\n')
      : ['---', 'inject: never', '---', '', `# ${adr.file} (inactive)`, ''].join('\n');
    writeFileSync(destination, source, 'utf8');
    active.add(name);
  }
  for (const entry of readdirSync(directory)) {
    if (!/^adr-ADR-\d{4}-.+\.md$/u.test(entry) || active.has(entry)) continue;
    writeFileSync(join(directory, entry), '---\ninject: never\n---\n', 'utf8');
  }
}

function repositoryFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
      .split('\0').map(normalizePath).filter(Boolean);
  } catch {
    return [];
  }
}

export function validateMetadata(metadata, file = '') {
  const errors = [];
  if (!metadata || !Array.isArray(metadata.scope) || !metadata.scope.length || metadata.scope.some(value => typeof value !== 'string' || !value.trim())) errors.push(`${file}: scope must be a non-empty string array`);
  if (metadata?.contracts !== undefined && (!Array.isArray(metadata.contracts) || metadata.contracts.some(value => typeof value !== 'string' || !value.trim()))) errors.push(`${file}: contracts must be a string array`);
  if (!['on-change', 'manual', 'never'].includes(metadata?.review)) errors.push(`${file}: review must be on-change, manual, or never`);
  if (metadata?.['superseded-by'] !== undefined && !/^ADR-\d{4}-.+\.md$/u.test(String(metadata['superseded-by']))) errors.push(`${file}: superseded-by must reference an ADR filename`);
  if (metadata?.['conflicts-with'] !== undefined && (!Array.isArray(metadata['conflicts-with']) || metadata['conflicts-with'].some(value => !/^ADR-\d{4}-.+\.md$/u.test(String(value))))) errors.push(`${file}: conflicts-with must be an array of ADR filenames`);
  if (metadata?.revised !== undefined && metadata.revised !== true) errors.push(`${file}: revised must be true when present`);
  return errors;
}

export function normalizePath(value) {
  return typeof value === 'string' ? value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '') : '';
}

function parseYamlSubset(source) {
  const result = {};
  let activeKey = null;
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim() || /^\s*#/u.test(line)) continue;
    const list = line.match(/^([ \t]+)-\s*(.+)$/u);
    if (list && activeKey) { (result[activeKey] ??= []).push(unquote(list[2].trim())); continue; }
    const field = line.match(/^([A-Za-z][A-Za-z0-9-]*):(?:\s*(.*))?$/u);
    if (!field) continue;
    const [, key, raw = ''] = field;
    if (raw.trim()) { result[key] = scalar(raw.trim()); activeKey = null; }
    else { result[key] = []; activeKey = key; }
  }
  return result;
}

function scalar(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).split(',').map(item => unquote(item.trim())).filter(Boolean);
  return unquote(value);
}

function unquote(value) { return value.replace(/^['"]|['"]$/gu, ''); }

function globPattern(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { source += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += pattern[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`^${source}$`, 'iu');
}
