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
validateRequiredArchitecture();
for (const file of targets) validateLinks(file, readSource(file));

function validateRequiredArchitecture() {
  for (const file of config?.architecture?.documents ?? []) if (!existsSync(file)) failures.push(`${file}: required architecture source is missing`);
}

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
