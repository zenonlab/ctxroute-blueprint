import { z } from 'zod';
import type { FavoriteProviderRateCheckpointPort } from './provider-http';

type CheckpointKey = 'favorite-provider-next-allowed-at:anilist' | 'favorite-provider-next-allowed-at:mangaupdates';
interface ProviderRateStorageEnvelope {
  'favorite-provider-next-allowed-at:anilist'?: number;
  'favorite-provider-next-allowed-at:mangaupdates'?: number;
}
export interface FavoriteProviderCheckpointStorageArea {
  get(key: CheckpointKey): Promise<ProviderRateStorageEnvelope>;
  set(values: ProviderRateStorageEnvelope): Promise<void>;
}

const checkpointSchema = z.number().int().nonnegative();

export class WebExtensionProviderRateCheckpointAdapter implements FavoriteProviderRateCheckpointPort {
  constructor(private readonly storage: FavoriteProviderCheckpointStorageArea) {}

  async read(provider: 'anilist' | 'mangaupdates'): Promise<number | undefined> {
    const key: CheckpointKey = provider === 'anilist'
      ? 'favorite-provider-next-allowed-at:anilist'
      : 'favorite-provider-next-allowed-at:mangaupdates';
    const values = await this.storage.get(key);
    const value = provider === 'anilist'
      ? values['favorite-provider-next-allowed-at:anilist']
      : values['favorite-provider-next-allowed-at:mangaupdates'];
    const parsed = checkpointSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }

  write(provider: 'anilist' | 'mangaupdates', nextAllowedAt: number): Promise<void> {
    const value = checkpointSchema.parse(nextAllowedAt);
    return provider === 'anilist'
      ? this.storage.set({ 'favorite-provider-next-allowed-at:anilist': value })
      : this.storage.set({ 'favorite-provider-next-allowed-at:mangaupdates': value });
  }
}
