import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { isIgnoredPath, loadProjectConfig, validateProjectConfig } from './project-policy.mjs';

const allMode = process.argv.includes('--all');
const indexMode = process.argv.includes('--index');
const files = indexMode ? indexFiles() : allMode ? repositoryDocs() : stagedFiles();
const targets = files.filter(file => file.endsWith('.md'));
const failures = [];
const { config, failures: configFailures } = indexMode ? loadIndexConfig() : loadProjectConfig();

failures.push(...configFailures);

rejectStarterGuidesWhenInitialized(targets);
validateDocumentContracts();
validateRequiredArchitecture();
for (const file of targets) validateLinks(file, readSource(file));

function validateRequiredArchitecture() {
  for (const file of config?.architecture?.documents ?? []) if (!existsSync(file)) failures.push(`${file}: required architecture source is missing`);
}

export function validateDocumentContracts() {
  const manifest = readJson('docs/document-contracts.json');
  if (!manifest) return;
  if (manifest.schemaVersion !== 1 || manifest.policy !== 'schema-first' || !Array.isArray(manifest.documents) || !manifest.documents.length) {
    failures.push('docs/document-contracts.json: schemaVersion 1, schema-first policy, and documents are required');
    return;
  }
  const ids = new Set();
  for (const document of manifest.documents) {
    if (!document || document !== Object(document) || !document.id || ids.has(document.id)) {
      failures.push('docs/document-contracts.json: every document contract needs a unique id');
      continue;
    }
    ids.add(document.id);
    if (!document.source && !document.sourceGlob) failures.push(`docs/document-contracts.json: ${document.id} needs source or sourceGlob`);
    if (document.narrative && readOptionalSource(document.narrative) === null) failures.push(`${document.narrative}: narrative document contract source is missing`);
    for (const file of document.source ? [document.source] : matchingDocuments(document.sourceGlob)) inspectDocumentSource(document, file);
  }
}

export function inspectDocumentSource(document, file) {
  if (document.exclude?.includes(file)) return;
  const source = readOptionalSource(file);
  if (source === null) { failures.push(`${file}: document contract source is missing`); return; }
  if (document.format === 'markdown' && document.requiredSections) {
    for (const section of document.requiredSections) if (!new RegExp(`^#{1,6}\\s+${escapeRegExp(section)}\\s*$`, 'imu').test(source)) failures.push(`${file}: required section missing: ${section}`);
  }
  if (document.format === 'markdown-frontmatter') {
    const frontMatter = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/u)?.[1] ?? '';
    for (const key of document.requiredMetadata ?? []) if (!new RegExp(`^${escapeRegExp(key)}:`, 'mu').test(frontMatter)) failures.push(`${file}: required ADR metadata missing: ${key}`);
  }
  if (document.format === 'json') {
    let parsed;
    try { parsed = JSON.parse(source); } catch { failures.push(`${file}: invalid JSON document contract source`); return; }
    for (const key of document.requiredKeys ?? []) if (!(key in parsed)) failures.push(`${file}: required JSON key missing: ${key}`);
  }
  if (document.format === 'archify-json-ir') {
    let parsed;
    try { parsed = JSON.parse(source); } catch { failures.push(`${file}: invalid architecture JSON IR`); return; }
    if (parsed.schema_version !== 1 || !['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'].includes(parsed.diagram_type)) failures.push(`${file}: expected Archify JSON IR schema_version 1 and a supported diagram type`);
  }
}

function readJson(file) {
  const source = readOptionalSource(file);
  if (source === null) { failures.push(`${file}: document contract manifest is missing`); return null; }
  try { return JSON.parse(source); } catch { failures.push(`${file}: invalid JSON`); return null; }
}

function readOptionalSource(file) {
  try { return readSource(file); } catch { return null; }
}

function matchingDocuments(pattern) {
  if (indexMode) return indexFiles().filter(file => globPattern(pattern).test(file));
  return repositoryFiles().filter(file => globPattern(pattern).test(file));
}

function repositoryFiles() {
  try { return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch { return []; }
}

function globPattern(pattern) {
  return new RegExp(`^${escapeRegExp(pattern).replace(/\\\\\*\\\\\\*/gu, '.*').replace(/\\\\\*/gu, '[^/]*')}$`, 'u');
}

function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }

if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}

function rejectStarterGuidesWhenInitialized(markdownFiles) {
  if (config?.status !== 'initialized') return;
  for (const file of markdownFiles.filter(file => file.endsWith('.md'))) {
    const source = readSource(file);
    if (/<!--\s*Guide\b|TODO|to be defined|to be decided|to be specified|ADR-NNNN|YYYY-MM-DD/iu.test(source)) failures.push(`${file}: guide or placeholder forbidden after initialization`);
  }
}

function validateLinks(file, source) {
  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const rawTarget = match[1].trim().replace(/^<|>$/gu, '').split(/\s+["']/u)[0];
    if (!rawTarget || rawTarget.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(rawTarget)) continue;
    let path;
    try { path = decodeURIComponent(rawTarget.split('#')[0]); }
    catch {
      failures.push(`${file}: malformed local link "${rawTarget}"`);
      continue;
    }
    if (!path) continue;
    const absolute = resolve(dirname(resolve(file)), path);
    const repositoryPath = relative(process.cwd(), absolute);
    if (repositoryPath.startsWith('..') || repositoryPath === '') failures.push(`${file}: local link outside repository "${rawTarget}"`);
    else if (!existsSync(absolute)) failures.push(`${file}: local link not found "${rawTarget}"`);
  }
}

function readSource(file) {
  if (indexMode) {
    try { return execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' }); }
    catch { return ''; }
  }
  return readFileSync(file, 'utf8');
}

function loadIndexConfig() {
  try {
    const policy = JSON.parse(execFileSync('git', ['show', ':.codex/architecture-policy.json'], { encoding: 'utf8' }));
    const path = policy.projectConfig ?? '.project/project-config.json';
    const config = JSON.parse(execFileSync('git', ['show', `:${path}`], { encoding: 'utf8' }));
    return { config, failures: validateProjectConfig(config, process.cwd(), policy) };
  } catch {
    return { config: null, failures: ['Missing or invalid configuration/policy in the Git index'] };
  }
}

function stagedFiles() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

function indexFiles() {
  try { return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch { return []; }
}

function repositoryDocs(directory = '.', prefix = '') {
  const values = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!prefix && ['.git', 'node_modules'].includes(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isIgnoredPath(path)) continue;
    if (entry.isDirectory()) values.push(...repositoryDocs(join(directory, entry.name), path));
    else if (/\.(?:md|mmd)$/iu.test(path)) values.push(relative('.', path).replace(/\\/gu, '/'));
  }
  return values;
}
