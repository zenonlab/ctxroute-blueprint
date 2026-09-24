import { execFile as callback } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(callback);

export async function verifyWorkerRoots(primaryRoot, worktree, dependencies = {}) {
  const run = dependencies.execFile ?? execFile;
  const primary = await realpath(primaryRoot);
  const assigned = await realpath(worktree);
  const gitPath = async (cwd, flag) => {
    const output = String((await run('git', ['rev-parse', flag], { cwd, encoding: 'utf8' })).stdout).trim();
    return realpath(isAbsolute(output) ? output : resolve(cwd, output));
  };
  const top = await gitPath(primary, '--show-toplevel');
  const assignedTop = await gitPath(assigned, '--show-toplevel');
  const common = await gitPath(primary, '--git-common-dir');
  const assignedCommon = await gitPath(assigned, '--git-common-dir');
  if (top !== primary || assignedTop !== assigned || common !== assignedCommon || primary === assigned) throw new Error('worker root does not match the primary Git repository and assigned worktree');
  return { primary, worktree: assigned };
}
