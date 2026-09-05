import { execFileSync } from 'node:child_process';
import { constants, existsSync, readFileSync } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTROL_FILES = Object.freeze([
  'AGENTS.md', 'CLAUDE.md', '.gitignore', '.codex/hooks.json', '.claude/settings.json',
  '.github/workflows/validate.yml', 'eslint.config.mjs',
  '.project/blueprint-version.json',
  'scripts/progress-core.mjs', 'scripts/progress-cli.mjs', 'scripts/progress-mcp.mjs',
  'scripts/progress-dashboard.mjs', 'scripts/progress-dashboard-manager.mjs',
  'scripts/progress-dashboard-app.mjs', 'scripts/progress-dashboard.html',
  'scripts/progress-dashboard.css', 'scripts/progress-dashboard-client.js',
  'scripts/blueprint-sync.mjs', 'scripts/blueprint-version.mjs',
  'scripts/blueprint-sensor.mjs', 'scripts/dependency-audit.mjs', 'scripts/hook-performance.mjs',
  '.githooks/validate-ctxroute.mjs',
]);
export const CONTROL_DIRECTORIES = Object.freeze([
  '.codex/agents', '.codex/hooks', '.claude/agents', '.claude/hooks/docs',
]);

export async function synchronizeBlueprint({ source = scriptRoot, target, apply = false, timestamp = new Date().toISOString().replace(/[:.]/gu, '-') } = {}) {
  const sourceRoot = resolve(source);
  const targetRoot = resolve(target ?? '');
  if (!target || sourceRoot === targetRoot) throw new Error('Provide a derived repository with --target; source and target must differ.');
  assertGitRepository(targetRoot);
  if (apply && gitStatus(targetRoot)) throw new Error('Target repository is dirty; commit or stash its changes before applying a blueprint update.');
  const files = trackedControlFiles(sourceRoot);
  const changes = [];
  for (const file of [...new Set(files)].sort()) {
    const sourcePath = resolve(sourceRoot, file);
    if (!await exists(sourcePath)) continue;
    const targetPath = resolve(targetRoot, file);
    await assertNoSymlinkPath(targetRoot, file);
    const sourceBody = await readFile(sourcePath);
    const targetBody = await readFile(targetPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (targetBody?.equals(sourceBody)) continue;
    changes.push({ file, action: targetBody ? 'update' : 'add' });
    if (!apply) continue;
    if (targetBody) {
      const backupPath = resolve(targetRoot, '.ctxroute', 'blueprint-backups', timestamp, file);
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(targetPath, backupPath);
    }
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath, constants.COPYFILE_FICLONE);
  }
  return {
    applied: apply,
    current: changes.length === 0,
    sourceVersion: await blueprintVersion(sourceRoot),
    targetVersion: await blueprintVersion(targetRoot),
    target: targetRoot,
    backup: apply && changes.some(change => change.action === 'update') ? `.ctxroute/blueprint-backups/${timestamp}` : null,
    changes,
  };
}

async function blueprintVersion(root) {
  try { return JSON.parse(await readFile(resolve(root, '.project/blueprint-version.json'), 'utf8')).version ?? null; }
  catch { return null; }
}

export function trackedControlFiles(root = scriptRoot) {
  const repository = resolve(root);
  const output = execFileSync('git', ['ls-files', '-z', '--', ...CONTROL_FILES, ...CONTROL_DIRECTORIES], {
    cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const allTracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean));
  const selected = new Set(output.split('\0')
    .filter(Boolean)
    .filter(file => !file.startsWith('.claude/hooks/docs/adr-memory/')));
  const queue = [...selected];
  for (const file of queue) {
    if (!/\.(?:[cm]?js)$/iu.test(file) || !existsSync(resolve(repository, file))) continue;
    const source = readFileSync(resolve(repository, file), 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/gu)) {
      const candidate = resolve(dirname(resolve(repository, file)), match[1]);
      const relativePath = candidate.slice(repository.length + 1).replaceAll('\\', '/');
      for (const dependency of [relativePath, `${relativePath}.mjs`, `${relativePath}.js`, `${relativePath}.cjs`, `${relativePath}.json`, `${relativePath}/index.mjs`, `${relativePath}/index.js`]) {
        if (allTracked.has(dependency) && !selected.has(dependency)) { selected.add(dependency); queue.push(dependency); break; }
      }
    }
  }
  return [...selected].filter(file => existsSync(resolve(repository, file))).sort();
}
function assertGitRepository(root) {
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, stdio: 'ignore' }); }
  catch { throw new Error('Target must be an existing Git repository.'); }
}
function gitStatus(root) { return execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(); }
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function assertNoSymlinkPath(root, file) {
  let current = root;
  for (const segment of file.split('/')) {
    current = resolve(current, segment);
    const details = await lstat(current).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (details?.isSymbolicLink()) throw new Error(`Refusing symlinked control-plane path: ${file}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const targetIndex = args.indexOf('--target');
  try {
    const check = args.includes('--check');
    const result = await synchronizeBlueprint({ target: targetIndex >= 0 ? args[targetIndex + 1] : undefined, apply: args.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (check && !result.current) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
