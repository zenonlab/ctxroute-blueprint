import { z } from 'zod';
import type { FavoriteProvider } from '@tobirink/domain';
import type { FavoriteProviderRateCheckpointPort } from './provider-http';

type CheckpointKey = `favorite-provider-next-allowed-at:${FavoriteProvider}`;
type ProviderRateStorageEnvelope = Partial<Record<CheckpointKey, number>>;
export interface FavoriteProviderCheckpointStorageArea {
  get(key: CheckpointKey): Promise<ProviderRateStorageEnvelope>;
  set(values: ProviderRateStorageEnvelope): Promise<void>;
}

const checkpointSchema = z.number().int().nonnegative();

function checkpointKey(provider: FavoriteProvider): CheckpointKey {
  if (provider === 'anilist') return 'favorite-provider-next-allowed-at:anilist';
  if (provider === 'kitsu-anime') return 'favorite-provider-next-allowed-at:kitsu-anime';
  if (provider === 'kitsu-manga') return 'favorite-provider-next-allowed-at:kitsu-manga';
  if (provider === 'mangadex') return 'favorite-provider-next-allowed-at:mangadex';
  return 'favorite-provider-next-allowed-at:mangaupdates';
}

export class WebExtensionProviderRateCheckpointAdapter implements FavoriteProviderRateCheckpointPort {
  constructor(private readonly storage: FavoriteProviderCheckpointStorageArea) {}

  async read(provider: FavoriteProvider): Promise<number | undefined> {
    const key = checkpointKey(provider);
    const values = await this.storage.get(key);
    const parsed = checkpointSchema.safeParse(values[key]);
    return parsed.success ? parsed.data : undefined;
  }

  write(provider: FavoriteProvider, nextAllowedAt: number): Promise<void> {
    const value = checkpointSchema.parse(nextAllowedAt);
    const key = checkpointKey(provider);
    return this.storage.set({ [key]: value });
  }
}
