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
});
