import { createProgress } from '@tobirink/domain';
import type { Progress } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export async function recordProgress(storage: StoragePort, input: Progress): Promise<Progress> {
  const progress = createProgress(input);
  await storage.transaction(['progress'], async (session) => session.putProgress(progress));
  return progress;
}
