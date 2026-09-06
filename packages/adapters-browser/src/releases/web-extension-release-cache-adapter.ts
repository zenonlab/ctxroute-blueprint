import { parsePublicReleaseSnapshot, publicReleaseSnapshotSchema } from '@tobirink/application';
import type { PublicReleaseCachePort, PublicReleaseSnapshot, PublicReleaseSnapshotInput } from '@tobirink/application';

const releaseCacheKey = 'tobirink.public-releases.v1';

export interface WebExtensionReleaseCacheStorage {
  get(key: typeof releaseCacheKey): Promise<{ 'tobirink.public-releases.v1'?: unknown }>;
  set(value: { 'tobirink.public-releases.v1': PublicReleaseSnapshot }): Promise<void>;
}

export class WebExtensionPublicReleaseCacheAdapter implements PublicReleaseCachePort {
  constructor(private readonly storage: WebExtensionReleaseCacheStorage) {}

  async load(): Promise<PublicReleaseSnapshotInput | undefined> {
    const value = (await this.storage.get(releaseCacheKey))[releaseCacheKey];
    if (value === undefined) return undefined;
    const parsed = publicReleaseSnapshotSchema.safeParse(value);
    return parsed.success ? parsePublicReleaseSnapshot(parsed.data) : undefined;
  }

  async save(snapshot: PublicReleaseSnapshot): Promise<void> {
    await this.storage.set({ [releaseCacheKey]: parsePublicReleaseSnapshot(snapshot) });
  }
}
