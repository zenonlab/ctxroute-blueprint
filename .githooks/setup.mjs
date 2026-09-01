import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function main() {
  const checkOnly = process.argv.includes('--check');
  const npmCli = process.env.npm_execpath;
  const initialGitStatus = capture('git', ['status', '--porcelain']);

  requireVersion('Node.js', process.versions.node, [22, 13, 0]);
  if (!npmCli) fail('Run setup through npm: npm run setup');

  const npmVersion = capture(process.execPath, [npmCli, '--version']);
  requireVersion('npm', npmVersion, [10, 0, 0]);
  const gitVersion = capture('git', ['--version']);
  const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
  const pythonVersion = capture(pythonCommand, ['--version']).replace(/^Python\s+/u, '');
  requireVersion('Python', pythonVersion, [3, 10, 0]);
  const uvVersion = capture('uv', ['--version']).match(/\d+\.\d+\.\d+/u)?.[0] ?? '';
  if (uvVersion !== '0.11.2') fail(`uv 0.11.2 is required; found ${uvVersion || 'unknown'}.`);
  console.log(`Setup prerequisites: Node.js ${process.versions.node}, npm ${npmVersion}, Python ${pythonVersion}, uv ${uvVersion}, ${gitVersion}.`);
  if (!existsSync('package-lock.json')) fail('package-lock.json is required; run npm install to create it.');
  if (!existsSync('packages/code-review-graph/uv.lock')) fail('packages/code-review-graph/uv.lock is required; run uv lock --project packages/code-review-graph.');
  console.log('Lockfile: package-lock.json found.');

  if (checkOnly) {
    console.log(`Setup prerequisites are available: Node.js ${process.versions.node}, npm ${npmVersion}, Python ${pythonVersion}, uv ${uvVersion}.`);
    return;
  }

  runStep('Install pinned dependencies (CTXRoute + Archify restore via postinstall)', process.execPath, [npmCli, 'ci']);
  runStep('Synchronize configured Sensor language packs', process.execPath, [npmCli, 'run', 'sensor:languages', '--', 'sync'], { silent: true });
  runStep('Synchronize code-review-graph from the frozen uv lock', 'uv', ['sync', '--project', 'packages/code-review-graph', '--frozen', '--python', '3.12']);
  runStep('Verify code-review-graph 2.3.8', process.execPath, [npmCli, 'run', 'crg:version']);
  runStep('Build the initial code-review-graph graph', process.execPath, [npmCli, 'run', 'crg:build']);
  runStep('Enable repository Git hooks', 'git', ['config', 'core.hooksPath', '.githooks']);
  runStep('Verify Git hooks activation', 'git', ['config', '--get', 'core.hooksPath']);
  runStep('Validate the complete starter', process.execPath, [npmCli, 'run', 'validate']);
  const finalGitStatus = capture('git', ['status', '--porcelain']);
  if (finalGitStatus !== initialGitStatus) fail('Setup changed tracked files; inspect git status before continuing.');

  console.log('CTXRoute Blueprint setup is complete.');
}

export function runStep(label, command, args, {
  silent = false,
  spawn = spawnSync,
  log = value => console.log(value),
  error = value => console.error(value),
  terminate = code => process.exit(code),
} = {}) {
  if (!silent) log(`\n${label}...`);
  const result = silent
    ? spawn(command, args, { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(command, args, { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error) {
    error(`${label} failed: ${result.error.message}`);
    terminate(1);
    return result;
  }
  if (result.status !== 0) {
    if (silent) {
      const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      if (detail) error(detail);
      error(`${label} failed with status ${result.status ?? 'unknown'}.`);
    }
    terminate(result.status ?? 1);
  }
  return result;
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: process.cwd(), encoding: 'utf8' });
  if (result.error || result.status !== 0) fail(`Required command is unavailable: ${command}`);
  return result.stdout.trim();
}

function requireVersion(name, version, minimum) {
  const actual = String(version).split('.').slice(0, 3).map(value => Number.parseInt(value, 10));
  const valid = actual.length === 3 && actual.every(Number.isInteger);
  const firstDifference = actual.findIndex((value, index) => value !== minimum[index]);
  const supported = valid && (firstDifference === -1 || actual[firstDifference] > minimum[firstDifference]);
  if (!supported) fail(`${name} ${minimum.join('.')}+ is required; found ${version}.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
