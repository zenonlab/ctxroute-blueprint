import { pathToFileURL } from 'node:url';
import { reconcileManagedWorktrees } from '../../scripts/worktree-manager.mjs';

export async function reconcileHook(root = process.cwd()) {
  const { results } = await reconcileManagedWorktrees(root, { repair: false });
  const actionable = results.filter(item => item.action === 'NEEDS_ATTENTION'
    || ['REGISTERED_PATH_MISSING', 'ORPHAN_REGISTERED_MISSING'].includes(item.classification));
  return actionable.length
    ? { systemMessage: `Worktree intervention required: ${actionable.map(item => `${item.path} (${item.classification})`).join(', ')}` }
    : null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  reconcileHook().then(output => { if (output) process.stdout.write(JSON.stringify(output)); })
    .catch(error => process.stdout.write(JSON.stringify({ systemMessage: `Worktree inventory failed open: ${error.message}` })));
}
