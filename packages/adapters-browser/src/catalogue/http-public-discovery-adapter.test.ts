import { describe, expect, it, vi } from 'vitest';
import type { PublicDiscoveryKey } from '@tobirink/application';
import { HttpPublicDiscoveryAdapter } from './http-public-discovery-adapter';

const key: PublicDiscoveryKey = {
  fingerprint: 'a'.repeat(64), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3',
};
const query = { discoveryTitles: ['Frieren'], mediaKind: 'ANIME' as const, sourceTitles: ['Sousou no Frieren'] };

describe('HttpPublicDiscoveryAdapter', () => {
  it('creates a server request after a D1 miss without receiving a provider lease', async () => {
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json({ state: 'MISS' });
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ retryAt: '2026-09-14T12:15:00.000Z', state: 'PENDING' }, { status: 202 });
    });
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await expect(adapter.resolveOrRequest(key, query)).resolves.toEqual({ retryAt: '2026-09-14T12:15:00.000Z', state: 'PENDING' });
    expect(bodies).toEqual([{ key, query, schemaVersion: 3 }]);
    expect(JSON.stringify(bodies)).not.toMatch(/lease|consent|collective|bookmark|folder|progress/iu);
  });

  it('returns a full D1 profile without a second request', async () => {
    const profile = {
      candidate: { externalId: '154587', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Frieren'] },
      references: [{ externalId: '154587', provider: 'anilist' }], workId: 'work_anilist_154587',
    };
    const fetcher = vi.fn(async () => Response.json({ nextRefreshAt: '2026-09-21T12:00:00.000Z', profile, state: 'VERIFIED', verifiedAt: '2026-09-14T12:00:00.000Z' }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await expect(adapter.resolveOrRequest(key, query)).resolves.toMatchObject({ nextRefreshAt: '2026-09-21T12:00:00.000Z', profile, state: 'VERIFIED' });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns an unavailable request without resubmitting it automatically', async () => {
    const fetcher = vi.fn(async () => Response.json({ reason: 'ATTEMPT_LIMIT', state: 'UNAVAILABLE' }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await expect(adapter.resolveOrRequest(key, query)).resolves.toEqual({ reason: 'ATTEMPT_LIMIT', state: 'UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/v3/catalogue/discoveries?'), expect.objectContaining({ method: 'GET' }));
  });
});
