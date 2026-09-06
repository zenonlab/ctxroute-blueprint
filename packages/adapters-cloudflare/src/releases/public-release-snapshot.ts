import { parsePublicReleaseSnapshot } from '@tobirink/application';
import type { PublicReleaseCachePort, PublicReleaseSnapshot, PublicReleaseSnapshotInput } from '@tobirink/application';
import { z } from 'zod';
export { parsePublicReleaseSnapshot, PUBLIC_RELEASE_AVAILABILITY, publicReleaseSnapshotSchema } from '@tobirink/application';
export type { PublicReleaseSnapshot, PublicReleaseSnapshotInput } from '@tobirink/application';

export const publicReleasePointerSchema = z.strictObject({ revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u) });

export type PublicReleaseSnapshotResult =
  | { snapshot: PublicReleaseSnapshot; source: 'network' }
  | { snapshot: PublicReleaseSnapshot; source: 'cache' };

export interface PublicReleaseRemote {
  loadLatest(): Promise<PublicReleaseSnapshotInput>;
}

export class PublicReleaseSnapshotAdapter {
  constructor(
    private readonly remote: PublicReleaseRemote,
    private readonly cache: PublicReleaseCachePort,
  ) {}

  async latest(): Promise<PublicReleaseSnapshotResult> {
    try {
      const snapshot = parsePublicReleaseSnapshot(await this.remote.loadLatest());
      await this.cache.save(snapshot);
      return { snapshot, source: 'network' };
    } catch {
      const cached = await this.cache.load();
      if (cached === undefined) throw new Error('Public release snapshot is unavailable');
      return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    }
  }
}
