import type { StoragePort } from '@tobirink/application';
import type { FavoriteProvider } from '@tobirink/domain';

export class DexieProviderRateCheckpointAdapter {
  constructor(private readonly storage: StoragePort) {}

  async read(provider: FavoriteProvider): Promise<number | undefined> {
    return (await this.storage.getFavoriteProviderRateCheckpoint(provider))?.nextAllowedAt;
  }

  async write(provider: FavoriteProvider, nextAllowedAt: number): Promise<void> {
    if (!Number.isSafeInteger(nextAllowedAt) || nextAllowedAt < 0) throw new TypeError('Provider checkpoint must be a non-negative safe integer.');
    await this.storage.putFavoriteProviderRateCheckpoint({ nextAllowedAt, provider });
  }
}
