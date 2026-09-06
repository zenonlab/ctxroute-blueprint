import { pathToFileURL } from 'node:url';
import { reconcileManagedWorktrees } from '../../scripts/worktree-manager.mjs';

export async function reconcileHook(root = process.cwd()) {
  const result = await reconcileManagedWorktrees(root);
  return result.removed.length ? { systemMessage: `Cleaned orphaned worktrees: ${result.removed.join(', ')}` } : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  reconcileHook().then(output => { if (output) process.stdout.write(JSON.stringify(output)); })
    .catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Worktree cleanup failed open: ${error.message}` })));
}
