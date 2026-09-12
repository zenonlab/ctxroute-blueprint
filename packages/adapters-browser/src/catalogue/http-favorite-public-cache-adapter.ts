import { favoriteCollectiveKeySchema, favoriteCollectiveLookupQuerySchema, favoritePublicCacheBatchRequestSchema, favoritePublicCacheBatchResponseSchema, favoritePublicCacheEntrySchema } from '@tobirink/application';
import type { FavoriteCollectiveKey, FavoritePublicCacheReadPort } from '@tobirink/application';
import { z } from 'zod';

export type FavoritePublicCacheFetch = (input: string, init: RequestInit) => Promise<Response>;
type CachedIdentity = ReturnType<typeof favoritePublicCacheEntrySchema.parse>;
type PreparedIdentityResult = { readonly kind: 'ABSENT' } | { readonly identity: CachedIdentity | undefined; readonly kind: 'CACHED' };

function exactHttpsOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') throw new TypeError('Favorite cache API must be an exact HTTPS origin.');
  return url.origin;
}

export class HttpFavoritePublicCacheAdapter implements FavoritePublicCacheReadPort {
  private readonly origin: string;
  private readonly prepared = new Map<string, { expiresAt: number; identity: CachedIdentity | undefined }>();
  constructor(origin: string, private readonly fetcher: FavoritePublicCacheFetch = fetch) { this.origin = exactHttpsOrigin(origin); }

  private cacheKey(key: FavoriteCollectiveKey): string {
    return JSON.stringify([key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion]);
  }

  private preparedIdentity(key: FavoriteCollectiveKey): PreparedIdentityResult {
    const cacheKey = this.cacheKey(key);
    const entry = this.prepared.get(cacheKey);
    if (entry === undefined) return { kind: 'ABSENT' };
    if (entry.expiresAt > Date.now()) return { identity: entry.identity, kind: 'CACHED' };
    this.prepared.delete(cacheKey);
    return { kind: 'ABSENT' };
  }

  async prepareFavoriteIdentities(inputs: readonly FavoriteCollectiveKey[]): Promise<void> {
    const keys = favoriteCollectiveLookupQuerySchema.parse(inputs);
    const missing = keys.filter((key) => this.preparedIdentity(key).kind === 'ABSENT');
    if (missing.length === 0) return;
    try {
      const response = await this.fetcher(new URL('/v1/catalogue/favorites/resolve-batch', this.origin).toString(), {
        body: JSON.stringify(favoritePublicCacheBatchRequestSchema.parse({ keys: missing })), cache: 'no-store', credentials: 'omit',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer',
      });
      if (!response.ok) throw new Error(`Favorite cache batch request failed with status ${response.status}.`);
      const body = await response.text();
      if (new TextEncoder().encode(body).byteLength > 64 * 1024) throw new Error('Favorite cache response exceeds its byte limit.');
      const parsed = favoritePublicCacheBatchResponseSchema.parse(JSON.parse(body));
      if (parsed.results.length !== missing.length || parsed.results.some((result, index) => result.fingerprint !== missing[index]?.fingerprint)) throw new Error('Favorite cache batch correlation failed.');
      for (let index = 0; index < missing.length; index += 1) {
        const key = missing[index];
        if (key !== undefined) {
          const identity = parsed.results[index]?.identity;
          this.prepared.set(this.cacheKey(key), { expiresAt: Date.now() + (identity === undefined ? 60_000 : 300_000), identity });
        }
      }
    } catch (error) {
      for (const key of missing) this.prepared.set(this.cacheKey(key), { expiresAt: Date.now() + 60_000, identity: undefined });
      throw error;
    }
  }

  async findFavoriteIdentity(input: FavoriteCollectiveKey) {
    const key = favoriteCollectiveKeySchema.parse(input);
    const cachedKey = this.cacheKey(key);
    const prepared = this.preparedIdentity(key);
    if (prepared.kind === 'CACHED') return prepared.identity;
    const url = new URL('/v1/catalogue/favorites/resolve', this.origin);
    url.searchParams.set('fingerprint', key.fingerprint);
    url.searchParams.set('mediaKind', key.mediaKind);
    url.searchParams.set('parserVersion', key.parserVersion);
    url.searchParams.set('siteRulesVersion', key.siteRulesVersion);
    const fetcher = this.fetcher;
    const response = await fetcher(url.toString(), { cache: 'default', credentials: 'omit', headers: { Accept: 'application/json' }, method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (response.status === 404) { this.prepared.set(cachedKey, { expiresAt: Date.now() + 60_000, identity: undefined }); return undefined; }
    if (!response.ok) throw new Error(`Favorite cache request failed with status ${response.status}.`);
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > 64 * 1024) throw new Error('Favorite cache response exceeds its byte limit.');
    const identity = z.strictObject({ identity: favoritePublicCacheEntrySchema }).parse(JSON.parse(body)).identity;
    this.prepared.set(cachedKey, { expiresAt: Date.now() + 300_000, identity });
    return identity;
  }
}
