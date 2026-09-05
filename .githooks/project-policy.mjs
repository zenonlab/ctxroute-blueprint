import { existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { catalogEntry, registryEntry } from './ast-registry.mjs';

export const DEFAULT_CONFIG_PATH = '.project/project-config.json';

export function loadProjectConfig(cwd = process.cwd()) {
  const policyPath = resolve(cwd, '.codex/architecture-policy.json');
  if (!existsSync(policyPath)) return { config: null, failures: ['Missing policy: .codex/architecture-policy.json'] };

  let policy;
  try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); }
  catch { return { config: null, failures: ['Invalid policy JSON: .codex/architecture-policy.json'] }; }

  const configPath = policy.projectConfig ?? DEFAULT_CONFIG_PATH;
  const absoluteConfig = resolve(cwd, configPath);
  if (!existsSync(absoluteConfig)) return { config: null, failures: [`Missing configuration: ${configPath}`] };

  let config;
  try { config = JSON.parse(readFileSync(absoluteConfig, 'utf8')); }
  catch { return { config: null, failures: [`Invalid configuration JSON: ${configPath}`] }; }

  return { config, failures: validateProjectConfig(config, cwd, policy) };
}

export function inspectProjectConfig(config, cwd = process.cwd(), policy = { supportedStatuses: ['template', 'initialized'] }) {
  const failures = [];
  const statuses = policy.supportedStatuses ?? ['template', 'initialized'];
  if (config.schemaVersion !== 1) failures.push('schemaVersion must equal 1');
  if (!statuses.includes(config.status)) failures.push(`status must be one of: ${statuses.join(', ')}`);
  if (config.tooling?.runtime !== 'node' || config.tooling?.packageManager !== 'npm') failures.push('tooling must declare the template node runtime and npm package manager');

  requireObject(config.decisions, 'decisions', failures);
  requireObject(config.commands, 'commands', failures);
  requireObject(config.quality?.mutation, 'quality.mutation', failures);
  requireObject(config.directories, 'directories', failures);
  requireObject(config.architecture, 'architecture', failures);
  requireObject(config.contracts, 'contracts', failures);
  requireObject(config.documentation, 'documentation', failures);
  requireObject(config.starter, 'starter', failures);

  const pathCollections = [
    ['directories.source', config.directories?.source],
    ['directories.tests', config.directories?.tests],
    ['directories.generated', config.directories?.generated],
    ['architecture.documents', config.architecture?.documents],
    ['architecture.internalDocuments', config.architecture?.internalDocuments],
    ['documentation.roots', config.documentation?.roots],
    ['starter.infrastructureRoots', config.starter?.infrastructureRoots],
    ['starter.rootFiles', config.starter?.rootFiles],
  ];
  for (const [name, values] of pathCollections) validatePaths(name, values, failures);
  const productDocuments = config.architecture?.documents ?? [];
  const internalDocuments = config.architecture?.internalDocuments ?? [];
  for (const document of productDocuments) {
    if (internalDocuments.includes(document)) failures.push(`architecture document cannot be both product and internal: ${document}`);
  }
  if (config.status === 'template') validateStarterStructure(config, cwd, failures);
  if (!Array.isArray(config.codeExtensions)) failures.push('codeExtensions must be an array');
  else if (config.codeExtensions.some(extension => extension !== String(extension) || !/^\.[a-z0-9][a-z0-9.+-]*$/iu.test(extension))) failures.push('codeExtensions must contain extensions such as .ts or .rb');
  if (!Array.isArray(config.contracts?.patterns) || config.contracts.patterns.some(pattern => pattern !== String(pattern) || !pattern.trim())) failures.push('contracts.patterns must be an array of non-empty patterns');
  if (!Array.isArray(config.documentation?.extensions) || config.documentation.extensions.length === 0 || config.documentation.extensions.some(extension => extension !== String(extension) || !/^\.[a-z0-9][a-z0-9.+-]*$/iu.test(extension))) failures.push('documentation.extensions must contain extensions such as .md or .rst');

  for (const [name, command] of Object.entries(config.commands ?? {})) {
    if (command !== null && (command !== String(command) || !command.trim())) failures.push(`commands.${name} must be a non-empty command or null`);
  }

  const mutation = config.quality?.mutation;
  if (mutation && ((mutation.preCommit !== true && mutation.preCommit !== false) || (mutation.prePush !== true && mutation.prePush !== false))) failures.push('quality.mutation.preCommit and prePush must be booleans');
  if ((mutation?.preCommit || mutation?.prePush) && !config.commands?.mutation) failures.push('commands.mutation is required when a mutation hook is enabled');

  const sensor = config.quality?.sensor;
  if (sensor !== undefined) {
    if (!sensor || Object.prototype.toString.call(sensor) !== '[object Object]') failures.push('quality.sensor must be an object');
    else {
      if (!Array.isArray(sensor.languages) || sensor.languages.length === 0 || sensor.languages.some(language => Object.prototype.toString.call(language) !== '[object String]' || !catalogEntry(language))) failures.push('quality.sensor.languages must contain known catalogue identifiers');
      if (new Set(sensor.languages ?? []).size !== (sensor.languages ?? []).length) failures.push('quality.sensor.languages must not contain duplicates');
      if (!['auto', 'enabled', 'disabled'].includes(sensor.antiSlopEffect)) failures.push('quality.sensor.antiSlopEffect must be auto, enabled, or disabled');
      for (const extension of config.codeExtensions ?? []) {
        const item = registryEntry(`fixture${extension}`);
        const accepted = item?.id === 'tsx' ? ['tsx', 'typescript'] : item?.id === 'erb' ? ['erb', 'ruby'] : item ? [item.id] : [];
        if (!item || !accepted.some(id => sensor.languages.includes(id))) failures.push(`codeExtensions ${extension} requires a declared Sensor language`);
      }
    }
  }

  if (config.status === 'initialized') {
    for (const field of ['language', 'runtime', 'frontend', 'backend', 'storage', 'deployment', 'observability', 'security', 'performance']) {
      if (config.decisions?.[field] !== String(config.decisions?.[field]) || !config.decisions[field].trim()) failures.push(`decisions.${field} must be set after initialization`);
    }
    if (!Array.isArray(config.directories?.source) || config.directories.source.length === 0) failures.push('directories.source must be set after initialization');
    if (!Array.isArray(config.codeExtensions) || config.codeExtensions.length === 0) failures.push('codeExtensions must be set after initialization');
    if (!Array.isArray(config.architecture?.documents) || config.architecture.documents.length === 0) failures.push('architecture.documents must declare at least one product diagram after initialization');
    if (!['required', 'recommended', 'not-applicable'].includes(mutation?.decision)) failures.push('quality.mutation.decision must be required, recommended, or not-applicable after initialization');
    for (const document of config.architecture?.documents ?? []) {
      if (!existsSync(resolve(cwd, document))) failures.push(`Missing architecture document: ${document}`);
    }
  }

  return [...new Set(failures)];
}

export const validateProjectConfig = inspectProjectConfig;

export function normalizePath(path, cwd = process.cwd()) {
  if (path !== String(path)) return '';
  const normalized = path.trim().replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized) return '';
  if (isAbsolute(normalized)) return relative(cwd, normalized).replace(/\\/gu, '/');
  return normalized;
}

export function isWithin(path, roots = []) {
  return roots.some(root => {
    const normalizedRoot = normalizeRoot(root);
    return path === normalizedRoot.slice(0, -1) || path.startsWith(normalizedRoot);
  });
}

export function isStarterPath(path, config) {
  return isWithin(path, config.starter?.infrastructureRoots) || (config.starter?.rootFiles ?? []).includes(path);
}

export function isSourcePath(path, config) {
  return isWithin(path, config.directories?.source);
}

export function isTestPath(path, config) {
  return isWithin(path, config.directories?.tests);
}

export function isGeneratedPath(path, config) {
  return isWithin(path, config.directories?.generated);
}

export function isDocumentationPath(path, config) {
  if (!isWithin(path, config.documentation?.roots)) return false;
  return (config.documentation?.extensions ?? []).some(extension => path.toLowerCase().endsWith(extension.toLowerCase()));
}

export function isCodePath(path, config) {
  return (config.codeExtensions ?? []).some(extension => path.toLowerCase().endsWith(extension.toLowerCase()));
}

export function isContractPath(path, config) {
  return (config.contracts?.patterns ?? []).some(pattern => globPattern(pattern).test(path));
}

export function isArchitectureEvidence(path, config) {
  if ((config.architecture?.documents ?? []).includes(path)) return true;
  if ((config.architecture?.internalDocuments ?? []).includes(path)) return true;
  if (/^docs\/architecture\/src\/.+\.json$/iu.test(path)) return true;
  return /^docs\/architecture\/(?:components|flows)\/(?!README\.md$).+\.(?:md|mmd)$/iu.test(path);
}

export function isAdr(path) {
  return /^docs\/decisions\/ADR-(?!0000-)\d{4}-.+\.md$/u.test(path);
}

export function isIgnoredPath(path, cwd = process.cwd()) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', path], { cwd, stdio: 'ignore' });
    return false;
  } catch {}

  try {
    execFileSync('git', ['check-ignore', '--no-index', '--quiet', '--', path], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function requireObject(value, name, failures) {
  if (!value || value !== Object(value) || Array.isArray(value)) failures.push(`${name} must be an object`);
}

function validatePaths(name, values, failures) {
  if (!Array.isArray(values)) return failures.push(`${name} must be an array`);
  for (const value of values) {
    if (!isValidProjectPath(value)) failures.push(`${name} contains an invalid path`);
  }
}

function validateStarterStructure(config, cwd, failures) {
  for (const path of config.starter?.infrastructureRoots ?? []) {
    if (!isValidProjectPath(path)) continue;
    const kind = pathKind(resolve(cwd, path));
    if (kind === null) failures.push(`Missing starter infrastructure root: ${path}`);
    else if (kind !== 'directory') failures.push(`Starter infrastructure root must be a directory: ${path}`);
  }

  for (const path of config.starter?.rootFiles ?? []) {
    if (!isValidProjectPath(path)) continue;
    const kind = pathKind(resolve(cwd, path));
    if (kind === null) failures.push(`Missing starter root file: ${path}`);
    else if (kind !== 'file') failures.push(`Starter root file must be a file: ${path}`);
  }
}

function isValidProjectPath(value) {
  return value === String(value) && Boolean(value.trim()) && !isAbsolute(value) && !value.replace(/\\/gu, '/').split('/').includes('..');
}

function pathKind(path) {
  try {
    const stats = statSync(path);
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
  } catch {
    return null;
  }
}

function normalizeRoot(root) {
  const normalized = normalizePath(root).replace(/\/+$/u, '');
  return normalized ? `${normalized}/` : '';
}

function globPattern(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
    }
  }
  return new RegExp(`^${source}$`, 'iu');
}
