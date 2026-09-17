import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export function safeStateDirectory(candidate, root = process.cwd()) {
  const lexicalRoot = resolve(root);
  const repository = realpathSync(root);
  const requested = resolve(lexicalRoot, candidate ?? '.ctxroute/state');
  const lexicalRelative = relative(lexicalRoot, requested);
  const absolute = !lexicalRelative.startsWith(`..${sep}`) && lexicalRelative !== '..' && !isAbsolute(lexicalRelative)
    ? resolve(repository, lexicalRelative)
    : requested;
  const local = relative(repository, absolute);
  if (!local || local.startsWith(`..${sep}`) || local === '..' || isAbsolute(local)) throw new Error('CTXROUTE_STATE_DIR must remain inside the repository');
  let current = repository;
  for (const segment of local.split(sep)) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) throw new Error('CTXROUTE_STATE_DIR cannot traverse a symlink');
  }
  return absolute;
}
