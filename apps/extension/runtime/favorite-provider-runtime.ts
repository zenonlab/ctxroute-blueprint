import { AniListFavoriteProviderAdapter, FavoriteProviderRateGate, MangaUpdatesFavoriteProviderAdapter, WebExtensionProviderRateCheckpointAdapter } from '@tobirink/adapters-browser';
import type { FavoriteProviderCheckpointStorageArea } from '@tobirink/adapters-browser';

export function createFavoriteProviderPorts(storage: FavoriteProviderCheckpointStorageArea) {
  const checkpoints = new WebExtensionProviderRateCheckpointAdapter(storage);
  const anilist = new AniListFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('anilist', checkpoints));
  const mangaupdates = new MangaUpdatesFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('mangaupdates', checkpoints));
  return Object.freeze({ anilist, mangaupdates });
}
