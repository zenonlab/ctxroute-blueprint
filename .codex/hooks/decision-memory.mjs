import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

export function validateMetadata(metadata, file = '') {
  const errors = [];
  if (!metadata || !Array.isArray(metadata.scope) || !metadata.scope.length || metadata.scope.some(value => typeof value !== 'string' || !value.trim())) errors.push(`${file}: scope must be a non-empty string array`);
  if (metadata?.contracts !== undefined && (!Array.isArray(metadata.contracts) || metadata.contracts.some(value => typeof value !== 'string' || !value.trim()))) errors.push(`${file}: contracts must be a string array`);
  if (!['on-change', 'manual', 'never'].includes(metadata?.review)) errors.push(`${file}: review must be on-change, manual, or never`);
  if (metadata?.['superseded-by'] !== undefined && !/^ADR-\d{4}-.+\.md$/u.test(String(metadata['superseded-by']))) errors.push(`${file}: superseded-by must reference an ADR filename`);
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
