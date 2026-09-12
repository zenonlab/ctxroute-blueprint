import { describe, expect, it, vi } from 'vitest';
import { HttpFavoritePublicCacheAdapter } from './http-favorite-public-cache-adapter';

const key = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: 'parser-v4', siteRulesVersion: 'rules-v3' };
const candidate = { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };

describe('HTTP favorite public cache', () => {
  it('reads a bounded strict public candidate without credentials', async () => {
    const fetcher = vi.fn(async () => Response.json({ candidate }));
    const adapter = new HttpFavoritePublicCacheAdapter('https://tobirink.test', fetcher);
    await expect(adapter.findFavoriteCandidate(key)).resolves.toEqual(candidate);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/v1/catalogue/favorites/resolve?'), expect.objectContaining({ credentials: 'omit', method: 'GET' }));
  });

  it('treats a miss as empty and rejects private or oversized payloads', async () => {
    const miss = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => Response.json({ error: 'not-found' }, { status: 404 }));
    await expect(miss.findFavoriteCandidate(key)).resolves.toBeUndefined();
    const privateField = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => Response.json({ candidate: { ...candidate, bookmarkUrl: 'https://private.invalid' } }));
    await expect(privateField.findFavoriteCandidate(key)).rejects.toThrow();
    const oversized = new HttpFavoritePublicCacheAdapter('https://tobirink.test', async () => new Response(JSON.stringify({ candidate, padding: 'x'.repeat(70_000) }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(oversized.findFavoriteCandidate(key)).rejects.toThrow(/byte limit/u);
  });
});
