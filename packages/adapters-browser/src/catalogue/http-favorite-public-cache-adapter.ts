import { favoriteCollectiveKeySchema, providerCandidateSchema } from '@tobirink/application';
import type { FavoriteCollectiveKey, FavoritePublicCacheReadPort } from '@tobirink/application';
import { z } from 'zod';

export type FavoritePublicCacheFetch = (input: string, init: RequestInit) => Promise<Response>;

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') throw new TypeError('Favorite cache API must be an exact HTTPS origin.');
  return url.origin;
}

export class HttpFavoritePublicCacheAdapter implements FavoritePublicCacheReadPort {
  private readonly origin: string;
  constructor(origin: string, private readonly fetcher: FavoritePublicCacheFetch = fetch) { this.origin = exactHttpsOrigin(origin); }

  async findFavoriteCandidate(input: FavoriteCollectiveKey) {
    const key = favoriteCollectiveKeySchema.parse(input);
    const url = new URL('/v1/catalogue/favorites/resolve', this.origin);
    url.searchParams.set('fingerprint', key.fingerprint);
    url.searchParams.set('mediaKind', key.mediaKind);
    url.searchParams.set('parserVersion', key.parserVersion);
    url.searchParams.set('siteRulesVersion', key.siteRulesVersion);
    const response = await this.fetcher(url.toString(), { cache: 'default', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Favorite cache request failed with status ${response.status}.`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) throw new Error('Favorite cache response exceeds its byte limit.');
    return z.strictObject({ candidate: providerCandidateSchema }).parse(JSON.parse(body)).candidate;
  }
}
