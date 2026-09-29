import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderJson } from './provider-http';
import type { FavoriteProviderFetch, FavoriteProviderRuntimeControlPort } from './provider-http';
import type { FavoriteProvider } from './provider-kit';

export function createRecoveryRateGate(provider: FavoriteProvider, fetcher: FavoriteProviderFetch, controls?: FavoriteProviderRuntimeControlPort): FavoriteProviderRateGate {
  return new FavoriteProviderRateGate(provider, controls, undefined, undefined, () => probeFavoriteProvider(provider, fetcher));
}

export async function probeFavoriteProvider(provider: FavoriteProvider, fetcher: FavoriteProviderFetch): Promise<void> {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' };
  const limit = 8 * 1024;
  if (provider === 'anilist') {
    await readFavoriteProviderJson(fetcher, 'https://graphql.anilist.co', {
      method: 'POST', headers, body: JSON.stringify({ query: 'query TobirinkHealth { __typename }' }),
    }, z.object({ data: z.object({ __typename: z.literal('Query') }).strict() }).strict(), limit);
  } else if (provider === 'mangaupdates') {
    await readFavoriteProviderJson(fetcher, 'https://api.mangaupdates.com/v1/series/search', {
      method: 'POST', headers, body: JSON.stringify({ search: 'tobirinkhealthcheckzeroresult', page: 1, perpage: 25 }),
    }, z.object({ total_hits: z.literal(0), results: z.array(z.never()).length(0) }), limit);
  } else if (provider === 'mangadex') {
    await readFavoriteProviderJson(fetcher, 'https://api.mangadex.org/manga?limit=1&ids%5B%5D=00000000-0000-4000-8000-000000000000', {
      method: 'GET', headers,
    }, z.object({ result: z.literal('ok'), response: z.literal('collection'), data: z.array(z.never()).length(0) }), limit);
  } else {
    const media = provider === 'kitsu-anime' ? 'anime' : 'manga';
    await readFavoriteProviderJson(fetcher, `https://kitsu.io/api/edge/${media}?page%5Blimit%5D=1&fields%5B${media}%5D=slug`, {
      method: 'GET', headers,
    }, z.object({ data: z.array(z.object({ id: z.string().min(1), type: z.literal(media), attributes: z.object({ slug: z.string().min(1) }) })).length(1) }), limit);
  }
}
