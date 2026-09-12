import { describe, expect, it, vi } from 'vitest';
import { HttpFavoritePublicCacheAdapter } from './http-favorite-public-cache-adapter';

const key = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: 'parser-v4', siteRulesVersion: 'rules-v3' };
const identity = { mediaKind: 'ANIME' as const, metadata: { genres: ['Adventure'], preSerialization: false, startYear: 2023 }, references: [{ externalId: '154587', provider: 'anilist' as const }] };

describe('HTTP favorite public cache', () => {
  it('reads a bounded strict public candidate without credentials', async () => {
    const fetcher = vi.fn(async function (this: void) {
      expect(this).toBeUndefined();
      return Response.json({ identity });
    });
    const adapter = new HttpFavoritePublicCacheAdapter('https://tobirink.test', fetcher);
    await expect(adapter.findFavoriteIdentity(key)).resolves.toEqual(identity);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/v1/catalogue/favorites/resolve?'), expect.objectContaining({ credentials: 'omit', method: 'GET' }));
  });

  it('treats a miss as empty and rejects private or oversized payloads', async () => {
    const miss = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => Response.json({ error: 'not-found' }, { status: 404 }));
    await expect(miss.findFavoriteIdentity(key)).resolves.toBeUndefined();
    const privateField = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => Response.json({ identity: { ...identity, title: 'Forbidden title' } }));
    await expect(privateField.findFavoriteIdentity(key)).rejects.toThrow();
    const oversized = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => new Response(JSON.stringify({ identity, padding: 'x'.repeat(70_000) }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(oversized.findFavoriteIdentity(key)).rejects.toThrow(/byte limit/u);
  });

  it('prepares several public fingerprints in one credential-free request', async () => {
    const secondKey = { ...key, fingerprint: 'b'.repeat(64), mediaKind: 'MANGA' as const };
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      expect(JSON.parse(String(init.body))).toEqual({ keys: [key, secondKey] });
      return Response.json({ results: [{ fingerprint: key.fingerprint, identity }, { fingerprint: secondKey.fingerprint }] });
    });
    const adapter = new HttpFavoritePublicCacheAdapter('https://tobirink.test', fetcher);
    await adapter.prepareFavoriteIdentities?.([key, secondKey]);
    await expect(adapter.findFavoriteIdentity(key)).resolves.toEqual(identity);
    await expect(adapter.findFavoriteIdentity(secondKey)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://tobirink.test/v1/catalogue/favorites/resolve-batch', expect.objectContaining({ credentials: 'omit', method: 'POST' }));
  });

  it('contains a failed batch so provider resolution can continue without per-key cache requests', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const adapter = new HttpFavoritePublicCacheAdapter('https://tobirink.test', fetcher);
    await expect(adapter.prepareFavoriteIdentities?.([key])).rejects.toThrow(/503/u);
    await expect(adapter.findFavoriteIdentity(key)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
