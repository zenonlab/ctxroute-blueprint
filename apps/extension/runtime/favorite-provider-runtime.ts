import { AniListFavoriteProviderAdapter, FavoriteProviderRateGate, KitsuFavoriteProviderAdapter, MangaUpdatesFavoriteProviderAdapter } from '@tobirink/adapters-browser';
import type { FavoriteProviderRateCheckpointPort } from '@tobirink/adapters-browser';

export function createFavoriteProviderPorts(checkpoints: FavoriteProviderRateCheckpointPort) {
  const anilist = new AniListFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('anilist', checkpoints));
  const kitsuAnime = new KitsuFavoriteProviderAdapter('kitsu-anime', undefined, new FavoriteProviderRateGate('kitsu-anime', checkpoints));
  const kitsuManga = new KitsuFavoriteProviderAdapter('kitsu-manga', undefined, new FavoriteProviderRateGate('kitsu-manga', checkpoints));
  const mangaupdates = new MangaUpdatesFavoriteProviderAdapter(undefined, new FavoriteProviderRateGate('mangaupdates', checkpoints));
  return Object.freeze({ anilist, 'kitsu-anime': kitsuAnime, 'kitsu-manga': kitsuManga, mangaupdates });
}
