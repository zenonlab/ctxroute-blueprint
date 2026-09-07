import type { StoragePort } from '@tobirink/application';

export class DexieProviderRateCheckpointAdapter {
  constructor(private readonly storage: StoragePort) {}

  async read(provider: 'anilist' | 'mangaupdates'): Promise<number | undefined> {
    return (await this.storage.getFavoriteProviderRateCheckpoint(provider))?.nextAllowedAt;
  }

  async write(provider: 'anilist' | 'mangaupdates', nextAllowedAt: number): Promise<void> {
    if (!Number.isSafeInteger(nextAllowedAt) || nextAllowedAt < 0) throw new TypeError('Provider checkpoint must be a non-negative safe integer.');
    await this.storage.putFavoriteProviderRateCheckpoint({ nextAllowedAt, provider });
  }
}
