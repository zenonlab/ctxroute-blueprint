import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTROL_FILES = Object.freeze([
  'AGENTS.md', 'CLAUDE.md', '.codex/hooks.json', '.claude/settings.json',
  'scripts/progress-core.mjs', 'scripts/progress-cli.mjs', 'scripts/progress-mcp.mjs',
  'scripts/progress-dashboard.mjs', 'scripts/progress-dashboard-manager.mjs',
  'scripts/progress-dashboard-app.mjs',
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
  const files = [...CONTROL_FILES, ...await directoryFiles(sourceRoot, CONTROL_DIRECTORIES)];
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
  return { applied: apply, target: targetRoot, backup: apply && changes.some(change => change.action === 'update') ? `.ctxroute/blueprint-backups/${timestamp}` : null, changes };
}

async function directoryFiles(root, directories) {
  const files = [];
  for (const directory of directories) await walk(resolve(root, directory), directory, files);
  return files;
}
async function walk(absolute, relativeDirectory, files) {
  let entries;
  try { entries = await readdir(absolute, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) await walk(resolve(absolute, entry.name), relativePath, files);
    else if (entry.isFile()) files.push(relativePath);
  }
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
    const result = await synchronizeBlueprint({ target: targetIndex >= 0 ? args[targetIndex + 1] : undefined, apply: args.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
