import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { catalogEntry, CATALOG_VERSION, grammarStatus, LANGUAGE_CATALOG, LANGUAGE_PRESETS, registryEntry } from './ast-registry.mjs';
import { qualifyLanguages } from './sensor-qualification.mjs';

const ROOT = process.cwd();
const PROJECT_PATH = resolve(ROOT, '.project/project-config.json');
const PACKAGE_PATH = resolve(ROOT, 'package.json');
const LOCK_PATH = resolve(ROOT, 'package-lock.json');
const INSTALLABLE = item => Boolean(item && (item.package || item.parserKind === 'structured') && item.support === 'stable' && item.qualification?.parserLoaded && item.qualification?.fixtures?.valid && item.qualification?.fixtures?.invalid && item.qualification?.fixtures?.positions);

export function languageStatus(root = ROOT) {
  const project = readJson(resolve(root, '.project/project-config.json'));
  const packageJson = readJson(resolve(root, 'package.json'));
  const lock = readJson(resolve(root, 'package-lock.json'));
  const configured = project.quality?.sensor?.languages ?? [];
  const extensionIssues = (project.codeExtensions ?? []).flatMap(extension => {
    const item = registryEntry(`fixture${extension}`);
    if (!item) return [`${extension}: not classified by the Sensor catalogue`];
    const accepted = item.id === 'tsx' ? ['tsx', 'typescript'] : item.id === 'erb' ? ['erb', 'ruby'] : [item.id];
    return accepted.some(id => configured.includes(id)) ? [] : [`${extension}: requires ${accepted.join(' or ')}`];
  });
  const runtime = new Map(grammarStatus().map(item => [item.id, item]));
  const languages = LANGUAGE_CATALOG.map(item => {
    const loaded = runtime.get(item.id);
    const manifestVersion = item.package ? packageJson.devDependencies?.[item.package] ?? packageJson.dependencies?.[item.package] ?? null : null;
    const lockVersion = item.package ? lock.packages?.[`node_modules/${item.package}`]?.version ?? null : null;
    const exact = !item.package || manifestVersion === item.version;
    const locked = !item.package || lockVersion === item.version;
    const installable = INSTALLABLE(item);
    const unavailableReason = installable ? null : unavailableReasonFor(item);
    const runtimeCapabilities = Object.fromEntries(Object.entries(item.capabilities).map(([name, capability]) => [name, capability === 'PASS' && !loaded.syntaxAware ? 'MISSING' : capability]));
    return { id: item.id, configured: configured.includes(item.id), support: loaded.status, parser: loaded.syntaxAware ? 'loaded' : loaded.fallback ? 'fallback' : 'missing',
      syntaxAware: loaded.syntaxAware, package: item.package, version: item.version, manifestVersion, lockVersion, exact, locked, capabilities: runtimeCapabilities, capabilityEvidence: item.capabilityEvidence,
      installable, provenance: item.qualification?.provenance ?? null, checksum: item.qualification?.checksum ?? null,
      platforms: item.platforms, qualification: item.qualification, unavailableReason,
      installCommand: installable ? `npm run sensor:languages -- install ${item.id}` : null };
  });
  const selected = languages.filter(item => item.configured);
  return { schemaVersion: 2, catalogVersion: CATALOG_VERSION, status: selected.every(item => item.installable && item.syntaxAware && item.exact && item.locked) && extensionIssues.length === 0 ? 'PASS' : 'FAIL', configured, extensionIssues, languages };
}

export function listLanguages() {
  const status = languageStatus();
  return { ...status, presets: presetStatuses(status.languages) };
}

export function installLanguages(ids, { preset } = {}) {
  const requested = normalizeRequested(ids, preset);
  const unavailable = requested.filter(item => !INSTALLABLE(item));
  if (unavailable.length) throw new Error(`Preset is BLOCKED before mutation: ${unavailable.map(item => `${item.id} (${unavailableReasonFor(item)})`).join(', ')}.`);
  mutateWithRollback(() => {
    const project = readJson(PROJECT_PATH);
    project.quality ??= {};
    project.quality.sensor ??= { languages: [], antiSlopEffect: 'auto' };
    project.quality.sensor.languages = [...new Set([...(project.quality.sensor.languages ?? []), ...requested.map(item => item.id)])].sort();
    project.quality.sensor.antiSlopEffect ??= 'auto';
    writeJson(PROJECT_PATH, project);
    const packages = dependencySpecs(requested);
    if (packages.length) runNpm(['install', '--save-dev', '--save-exact', ...packages]);
    assertLoadable(requested);
  });
  return languageStatus();
}

export function syncLanguages() {
  const project = readJson(PROJECT_PATH);
  return installLanguages(project.quality?.sensor?.languages ?? []);
}

export function removeLanguages(ids) {
  const requested = normalizeRequested(ids);
  mutateWithRollback(() => {
    const project = readJson(PROJECT_PATH);
    const configured = new Set(project.quality?.sensor?.languages ?? []);
    const required = requested.filter(item => item.extensions.some(extension => (project.codeExtensions ?? []).includes(extension)));
    if (required.length) throw new Error(`Cannot remove languages still required by codeExtensions: ${required.map(item => item.id).join(', ')}.`);
    requested.forEach(item => configured.delete(item.id));
    project.quality.sensor.languages = [...configured].sort();
    writeJson(PROJECT_PATH, project);
    const retainedPackages = new Set([...configured].map(catalogEntry).filter(Boolean).map(item => item.package).filter(Boolean));
    const packages = [...new Set(requested.map(item => item.package).filter(item => item && !retainedPackages.has(item)))];
    if (packages.length) runNpm(['uninstall', '--save-dev', ...packages]);
  });
  return languageStatus();
}

export function runLanguageCli(argv = process.argv.slice(2)) {
  const json = argv.includes('--json');
  const args = argv.filter(value => value !== '--json');
  const command = args.shift() ?? 'status';
  const presetIndex = args.indexOf('--preset');
  const preset = presetIndex >= 0 ? args[presetIndex + 1] : null;
  if (presetIndex >= 0) args.splice(presetIndex, 2);
  let result;
  if (command === 'list') result = listLanguages();
  else if (command === 'status') result = languageStatus();
  else if (command === 'install') result = installLanguages(args, { preset });
  else if (command === 'sync') result = syncLanguages();
  else if (command === 'remove') result = removeLanguages(args);
  else if (command === 'qualify') result = { schemaVersion: 2, qualifications: qualifyLanguages(args.length ? args : LANGUAGE_CATALOG.filter(INSTALLABLE).map(item => item.id)) };
  else throw new Error(`Unknown command "${command}". Expected list, status, install, remove, sync, or qualify.`);
  process.stdout.write(`${json ? JSON.stringify(result) : formatStatus(result)}\n`);
  if ((command === 'status' || command === 'sync') && result.status !== 'PASS') process.exitCode = 1;
}

function normalizeRequested(ids, preset) {
  if (preset && !Object.hasOwn(LANGUAGE_PRESETS, preset)) throw new Error(`Unknown preset "${preset}". Expected: ${Object.keys(LANGUAGE_PRESETS).join(', ')}.`);
  const values = [...ids, ...(preset ? LANGUAGE_PRESETS[preset] : [])];
  if (!values.length) throw new Error('At least one catalogue language or --preset is required.');
  const resolved = values.map(value => catalogEntry(value));
  const unknown = values.filter((value, index) => !resolved[index]);
  if (unknown.length) throw new Error(`Unknown catalogue language: ${unknown.join(', ')}.`);
  return [...new Map(resolved.map(item => [item.id, item])).values()];
}

function dependencySpecs(items) {
  const packages = new Map([['tree-sitter', '0.21.1']]);
  for (const item of items) if (item.package) packages.set(item.package, item.version);
  if (![...items].some(item => item.package)) packages.delete('tree-sitter');
  return [...packages].map(([name, version]) => `${name}@${version}`);
}

function presetStatuses(languages) {
  const byId = new Map(languages.map(item => [item.id, item]));
  return Object.fromEntries(Object.entries(LANGUAGE_PRESETS).map(([name, ids]) => {
    const packs = ids.map(id => byId.get(id)).filter(Boolean);
    const blocked = packs.filter(item => !item.installable).map(item => ({ id: item.id, reason: item.unavailableReason }));
    return [name, { status: blocked.length ? 'BLOCKED' : 'READY', packs: ids, blocked }];
  }));
}

function unavailableReasonFor(item) {
  if (!item) return 'unknown catalogue language';
  if (item.support !== 'stable') return item.fallbackReason ?? 'parser pack is not qualified';
  if (!item.package && item.parserKind !== 'structured') return 'no installable parser package is pinned';
  if (!item.qualification?.parserLoaded) return 'parser load evidence is missing';
  if (!item.qualification?.fixtures?.valid || !item.qualification?.fixtures?.invalid) return 'valid and invalid fixture evidence is incomplete';
  if (!item.qualification?.fixtures?.positions) return 'position evidence is incomplete';
  return 'qualification evidence is incomplete';
}

function assertLoadable(items) {
  const statuses = new Map(grammarStatus().map(item => [item.id, item]));
  const failed = items.filter(item => !statuses.get(item.id)?.syntaxAware);
  if (failed.length) throw new Error(`Installed parser failed its load check: ${failed.map(item => item.id).join(', ')}.`);
}

function mutateWithRollback(operation) {
  const snapshots = [PROJECT_PATH, PACKAGE_PATH, LOCK_PATH].map(path => [path, existsSync(path) ? readFileSync(path) : null]);
  try { operation(); }
  catch (error) {
    for (const [path, value] of snapshots) if (value !== null) writeFileSync(path, value);
    throw error;
  }
}

function runNpm(args) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this command through npm so the exact npm executable is known.');
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: ROOT, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`npm ${args[0]} failed with status ${result.status ?? 'unknown'}.`);
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path, value) {
  if (existsSync(path) && JSON.stringify(readJson(path)) === JSON.stringify(value)) return;
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function formatStatus(result) {
  if (result.qualifications) return ['Sensor parser qualification', ...result.qualifications.map(item => `[${item.status}] ${item.id}: ${item.platform}${item.reason ? ` — ${item.reason}` : ''}`)].join('\n');
  const configured = new Set(result.configured ?? []);
  return ['Sensor language packs', ...result.languages.filter(item => configured.size === 0 || configured.has(item.id)).map(item => `[${item.support}] ${item.id}: parser=${item.parser}${item.package ? ` ${item.package}@${item.version}` : ''}`), ...(result.extensionIssues ?? []).map(issue => `[MISSING] codeExtensions ${issue}`), `Result: ${result.status}`].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try { runLanguageCli(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
