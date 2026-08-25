import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inspectInstallation } from './postinstall.mjs';

const root = process.cwd();
const commit = '76b45a57543c940c51e382a41adb749faa44bbc4';
const failures = [];
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const config = readJson('ctxroute-config.json');
const installedPackage = readJson('node_modules/ctxroute/package.json');
failures.push(...inspectInstallation(root));

const archiveUrl = `https://github.com/zenonlab/ctxroute/archive/${commit}.tar.gz`;
if (packageJson?.devDependencies?.ctxroute !== archiveUrl) {
  failures.push('package.json must pin CTXRoute to the reviewed HTTPS archive');
}

const lockEntry = packageLock?.packages?.['node_modules/ctxroute'];
if (lockEntry?.resolved !== archiveUrl) {
  failures.push('package-lock.json must resolve the pinned CTXRoute HTTPS archive');
}

if (installedPackage?.version !== '2.0.0') failures.push('CTXRoute 2.0.0 is not installed');

if (config?.enabled !== true || config?.frames !== 1) failures.push('ctxroute-config.json must enable CTXRoute with one Codex frame');

const requiredHooks = ['session-inject.js', 'codex-doc-inject.js', 'codex-doc-write-guard.js', 'turn-count.js', 'canary-check.js', 'ctxroute-reset.js'];
for (const name of requiredHooks) {
  if (!existsSync(resolve('node_modules', 'ctxroute', 'src', 'hooks', name))) failures.push(`Installed CTXRoute hook is missing: ${name}`);
}

const rulesDirectory = join('.claude', 'hooks', 'docs');
if (!existsSync(rulesDirectory) || !readdirSync(rulesDirectory).some(name => name.endsWith('.md'))) failures.push('.claude/hooks/docs/ must contain at least one CTXRoute document');

if (!failures.length) {
  const environment = {
    ...process.env,
    CTXROUTE_CONFIG_PATH: join(root, 'ctxroute-config.json'),
    CTXROUTE_DOCS_DIR: join(root, 'docs', 'mcp'),
    CTXROUTE_FILEDOCS_DIR: join(root, '.claude', 'hooks', 'docs'),
    CTXROUTE_FLEET_HOOKS_DIR: join(root, '.claude', 'hooks'),
    CTXROUTE_SESSIONDOCS_DIR: join(root, 'docs', 'session'),
    CTXROUTE_STATE_DIR: join(root, '.ctxroute', 'state'),
  };
  const doctor = spawnSync(process.execPath, ['node_modules/ctxroute/tools/doctor.js', '--quiet'], { cwd: root, env: environment, encoding: 'utf8' });
  if (doctor.status !== 0) failures.push(`CTXRoute doctor failed: ${(doctor.stderr || doctor.stdout).trim()}`);
  const corpus = spawnSync(process.execPath, ['node_modules/ctxroute/tools/lint-corpus.js', '--quiet'], { cwd: root, env: environment, encoding: 'utf8' });
  if (corpus.status !== 0) failures.push(`CTXRoute corpus lint failed: ${(corpus.stderr || corpus.stdout).trim()}`);
}

if (failures.length) {
  console.error([...new Set(failures)].join('\n'));
  process.exit(1);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { failures.push(`${path}: missing or invalid JSON`); return null; }
}
