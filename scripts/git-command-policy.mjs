const MUTATING = new Set(['add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'commit', 'fetch', 'gc', 'merge', 'mv', 'pull', 'push', 'rebase', 'repack', 'reset', 'restore', 'rm', 'stash', 'switch', 'tag', 'update-ref', 'worktree']);
const READ_ONLY = new Set(['annotate', 'blame', 'cat-file', 'check-ignore', 'diff', 'diff-tree', 'for-each-ref', 'grep', 'log', 'ls-files', 'merge-base', 'name-rev', 'rev-list', 'rev-parse', 'show', 'show-ref', 'status', 'symbolic-ref', 'version', 'whatchanged']);
const GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']);

export function classifyGitCommand(argv) {
  const values = Array.isArray(argv) ? argv.map(String) : tokenize(String(argv ?? ''));
  const gitIndexes = values.map((value, index) => /(?:^|\/)git$/u.test(value) ? index : -1).filter(index => index >= 0);
  if (!gitIndexes.length) return { git: false, allowed_for_worker: true, classification: 'NOT_GIT', subcommand: null };
  const classifications = gitIndexes.map(gitIndex => classifyAt(values, gitIndex));
  return classifications.find(item => !item.allowed_for_worker) ?? classifications[0];
}

function classifyAt(values, gitIndex) {
  let index = gitIndex + 1;
  while (index < values.length && values[index].startsWith('-')) {
    const option = values[index];
    index += 1;
    if (GLOBAL_VALUE_OPTIONS.has(option) || [...GLOBAL_VALUE_OPTIONS].some(name => option === name)) index += 1;
  }
  const subcommand = values[index] ?? null;
  const allowed = Boolean(subcommand) && READ_ONLY.has(subcommand) && !MUTATING.has(subcommand);
  return { git: true, allowed_for_worker: allowed, classification: allowed ? 'READ_ONLY' : 'MUTATION_FORBIDDEN', subcommand };
}

export function assertWorkerGitCommand(argv) {
  const result = classifyGitCommand(argv);
  if (!result.allowed_for_worker) {
    const error = new Error(`worker Git mutation is forbidden: ${result.subcommand ?? '(missing subcommand)'}`);
    error.causeCode = 'WORKER_GIT_MUTATION_FORBIDDEN';
    throw error;
  }
  return result;
}

function tokenize(command) { return command.trim().split(/\s+/u).filter(Boolean); }
