import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  return Array.isArray(scope) && scope.some(pattern => pattern === String(pattern) && globPattern(pattern).test(normalizePath(path)));
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
  if (!existsSync(directory)) return;
  const tracked = repositoryFiles(root);
  const active = new Set();
  for (const adr of loadAdrs(root)) {
    const name = `adr-${adr.file.split('/').pop()}`;
    const destination = join(directory, name);
    const covered = !adr.errors.length && !adr.metadata['superseded-by']
      ? tracked.filter(path => matchScope(path, adr.metadata.scope)).length
      : 0;
    const source = [
      '---',
      'inject: never',
      '---',
      '',
      `# ${adr.file} (${covered ? `${covered} tracked path(s)` : 'inactive'})`,
      '',
      'Decision bodies are read on demand from docs/decisions; they are never injected automatically.',
      '',
    ].join('\n');
    writeIfChanged(destination, source);
    active.add(name);
  }
  for (const entry of readdirSync(directory)) {
    if (!/^adr-ADR-\d{4}-.+\.md$/u.test(entry) || active.has(entry)) continue;
    writeIfChanged(join(directory, entry), '---\ninject: never\n---\n');
  }
}

function writeIfChanged(path, source) {
  if (existsSync(path) && readFileSync(path, 'utf8') === source) return;
  writeFileSync(path, source, 'utf8');
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
  if (!metadata || !Array.isArray(metadata.scope) || !metadata.scope.length || metadata.scope.some(value => value !== String(value) || !value.trim())) errors.push(`${file}: scope must be a non-empty string array`);
  if (metadata?.contracts !== undefined && (!Array.isArray(metadata.contracts) || metadata.contracts.some(value => value !== String(value) || !value.trim()))) errors.push(`${file}: contracts must be a string array`);
  if (!['on-change', 'manual', 'never'].includes(metadata?.review)) errors.push(`${file}: review must be on-change, manual, or never`);
  if (metadata?.['superseded-by'] !== undefined && !/^ADR-\d{4}-.+\.md$/u.test(String(metadata['superseded-by']))) errors.push(`${file}: superseded-by must reference an ADR filename`);
  if (metadata?.supersedes !== undefined
    && (!Array.isArray(metadata.supersedes) || metadata.supersedes.some(value => !/^ADR-\d{4}-.+\.md$/u.test(String(value))))) {
    errors.push(`${file}: supersedes must be an array of ADR filenames`);
  }
  if (metadata?.['conflicts-with'] !== undefined && (!Array.isArray(metadata['conflicts-with']) || metadata['conflicts-with'].some(value => !/^ADR-\d{4}-.+\.md$/u.test(String(value))))) errors.push(`${file}: conflicts-with must be an array of ADR filenames`);
  if (metadata?.revised !== undefined && metadata.revised !== true) errors.push(`${file}: revised must be true when present`);
  if (metadata?.['editorial-correction'] !== undefined && metadata['editorial-correction'] !== true) errors.push(`${file}: editorial-correction must be true when present`);
  return errors;
}

export function validateAdrRevision(beforeSource, afterSource, file = '') {
  const before = parseAdr(beforeSource, file);
  const after = parseAdr(afterSource, file);
  if (before.errors.length || after.errors.length) return [...before.errors, ...after.errors];
  const statusBefore = adrStatus(before.body);
  if (statusBefore !== 'accepted') return [];
  const statusAfter = adrStatus(after.body);
  const afterNormative = normativeRecord(after);
  const superseded = statusAfter === 'superseded'
    && after.metadata['superseded-by']
    && normativeSections(before).every(([name, value]) => name === 'status' || value === afterNormative[name]);
  if (superseded) return [];
  if (after.metadata['editorial-correction'] === true) {
    const changed = normativeSections(before).filter(([name, value]) => value !== afterNormative[name]).map(([name]) => name);
    return changed.length ? [`${file}: editorial correction changed normative fields: ${changed.join(', ')}`] : [];
  }
  return [`${file}: accepted ADR meaning cannot be rewritten; create a new ADR with supersedes metadata`];
}

function normativeSections(adr) {
  const metadata = adr.metadata ?? {};
  const sections = sectionMap(adr.body);
  return [
    ['scope', JSON.stringify(metadata.scope ?? [])],
    ['contracts', JSON.stringify(metadata.contracts ?? [])],
    ['Decision', sections.get('Decision') ?? ''],
    ['Consequences', sections.get('Consequences') ?? ''],
    ['status', adrStatus(adr.body)],
  ];
}
function normativeRecord(adr) { return Object.fromEntries(normativeSections(adr)); }
function sectionMap(body) {
  const result = new Map();
  const matches = [...body.matchAll(/^##\s+(.+)\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/gmu)];
  for (const match of matches) result.set(match[1].trim(), match[2].trim());
  return result;
}
function adrStatus(body) { return /^- Status:\s*(accepted|superseded|proposed|rejected)\s*$/imu.exec(body)?.[1]?.toLowerCase() ?? null; }

export function normalizePath(value) {
  return value === String(value) ? value.trim().replace(/\\/gu, '/').replace(/^\.\//u, '') : '';
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
