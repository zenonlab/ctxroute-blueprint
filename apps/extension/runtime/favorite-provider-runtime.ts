import { AniListFavoriteProviderAdapter, FavoriteProviderRateGate, MangaUpdatesFavoriteProviderAdapter } from '@tobirink/adapters-browser';
import type { FavoriteProviderRateCheckpointPort } from '@tobirink/adapters-browser';

export function createFavoriteProviderPorts(checkpoints: FavoriteProviderRateCheckpointPort) {
  const anilist = new AniListFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('anilist', checkpoints));
  const mangaupdates = new MangaUpdatesFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('mangaupdates', checkpoints));
  return Object.freeze({ anilist, mangaupdates });
}
