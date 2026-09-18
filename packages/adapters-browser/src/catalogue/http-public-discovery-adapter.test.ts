import { afterEach, describe, expect, it, vi } from 'vitest';
import { favoriteIdentityKey, importFavoriteSources } from '@tobirink/application';
import { MemoryStoragePort } from '@tobirink/contracts';
import type { PublicDiscoveryKey } from '@tobirink/application';
import { HttpPublicDiscoveryAdapter } from './http-public-discovery-adapter';

const key: PublicDiscoveryKey = {
  fingerprint: 'a'.repeat(64), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3',
};
const query = { discoveryTitles: ['Frieren'], mediaKind: 'ANIME' as const, sourceTitles: ['Sousou no Frieren'] };

describe('HttpPublicDiscoveryAdapter', () => {
  afterEach(() => vi.useRealTimers());
  it('keeps Retry-After across restart and refuses requests outside the wake budget', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage).requestRefresh(key)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await expect(restarted.requestRefresh(key)).rejects.toMatchObject({ code: 'ADMISSION_WAIT', retryAt: '2026-09-18T12:02:00.000Z' });
    restarted.setDeadline(Date.now() + 14_999);
    await expect(restarted.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'ADMISSION_WAIT' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('accepts the exact versioned key emitted by the application parser', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ bookmarkId: 'wire', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic Harbor', url: 'https://reader.invalid/manga/synthetic-harbor/42' }], storage, '2026-09-18T12:00:00.000Z');
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    const artifact = source && await storage.getFavoriteParseArtifact(source.id);
    if (!artifact) throw new Error('Missing artifact');
    const actualKey = await favoriteIdentityKey(artifact.artifact);
    expect(actualKey.siteRulesVersion).toContain(':');
    const fetcher = vi.fn(async () => Response.json({ state: 'UNAVAILABLE', reason: 'ATTEMPT_LIMIT' }));
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).resolveOrRequest(actualKey, query)).resolves.toMatchObject({ state: 'UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('resubmits an overdue PENDING after restart and shares admission cadence with refresh', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() }));
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage).resolveOrRequest(key, query);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_001);
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await restarted.resolveOrRequest(key, query);
    expect(fetcher.mock.calls).toHaveLength(3);
    await expect(restarted.requestRefresh(key)).rejects.toMatchObject({ code: 'ADMISSION_WAIT' });
    expect(fetcher.mock.calls).toHaveLength(3);
  });
  it.each([[429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE'], [409, 'CONTRACT_CONFLICT']] as const)('classifies HTTP %s without leaking response content', async (status, code) => {
    const fetcher = vi.fn(async () => new Response('private payload', { status, headers: { 'Retry-After': '120' } }));
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).resolveOrRequest(key, query)).rejects.toMatchObject({ code, httpStatus: status });
  });
  it('bounds stalled HTTP and malformed JSON responses', async () => {
    vi.useFakeTimers();
    const stalled = new HttpPublicDiscoveryAdapter('https://tobirink.com', async () => new Promise<Response>(() => undefined));
    const assertion = expect(stalled.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(15_000); await assertion;
    const malformed = new HttpPublicDiscoveryAdapter('https://tobirink.com', async () => new Response('not-json'));
    await expect(malformed.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('creates a server request after a D1 miss without receiving a provider lease', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-14T12:00:00.000Z');
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

  it('groups fifty reads, reuses the cached state and submits a bounded refresh', async () => {
    const profile = {
      candidate: { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] },
      references: [{ externalId: '154587', provider: 'anilist' as const }], workId: 'work_anilist_154587',
    };
    const verified = { nextRefreshAt: '2026-09-21T12:00:00.000Z', profile, state: 'VERIFIED' as const, verifiedAt: '2026-09-14T12:00:00.000Z' };
    const fetcher = vi.fn(async (input: string) => Response.json(input.endsWith('/lookup') ? [{ key, state: verified }] : verified, { status: input.endsWith('/refreshes') ? 202 : 200 }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await expect(adapter.lookup([key])).resolves.toEqual([{ key, state: verified }]);
    await expect(adapter.resolveOrRequest(key, query)).resolves.toEqual(verified);
    await expect(adapter.requestRefresh(key)).resolves.toEqual(verified);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      'https://tobirink.com/v3/catalogue/discoveries/lookup',
      'https://tobirink.com/v3/catalogue/discoveries/refreshes',
    ]);
  });
});
