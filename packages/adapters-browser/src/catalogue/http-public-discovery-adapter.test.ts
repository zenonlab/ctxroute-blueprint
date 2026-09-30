import { afterEach, describe, expect, it, vi } from 'vitest';
import { favoriteIdentityKey, importFavoriteSources, requestPublicFavoriteDiscoveryRecovery } from '@tobirink/application';
import { MemoryStoragePort } from '@tobirink/contracts';
import type { PublicDiscoveryKey } from '@tobirink/application';
import { HttpPublicDiscoveryAdapter } from './http-public-discovery-adapter';
import { publicDiscoverySeasonReviewAccept } from '@tobirink/public-discovery';

const key: PublicDiscoveryKey = {
  fingerprint: 'a'.repeat(64), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3',
};
const query = { discoveryTitles: ['Frieren'], mediaKind: 'ANIME' as const, sourceTitles: ['Sousou no Frieren'] };

describe('HttpPublicDiscoveryAdapter', () => {
  it('announces season Review support on reads, admissions, recovery and grouped lookup', async () => {
    const pending = { state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() };
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => Response.json(init.method === 'GET' ? { state: 'MISS' } : pending));
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).resolveOrRequest(key, query);
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).requestRecovery(key, query);
    const grouped = vi.fn(async () => Response.json([{ key, state: pending }]));
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', grouped).lookup([key]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [, init] of fetcher.mock.calls) expect(new Headers(init.headers).get('Accept')).toBe(publicDiscoverySeasonReviewAccept);
    expect(grouped).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Accept: publicDiscoverySeasonReviewAccept, 'Content-Type': 'application/json' } }));
  });

  it.each(['season-unconfirmed', 'multiple-identities'])('validates a single Review reference against its reason: %s', async (reason) => {
    const state = { state: 'AMBIGUOUS', reason, candidates: [{ provider: 'kitsu-anime', externalId: '42' }], verifiedAt: '2026-09-30T12:00:00.000Z' };
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', async () => Response.json(state));
    if (reason === 'season-unconfirmed') await expect(adapter.resolveOrRequest(key, query)).resolves.toMatchObject(state);
    else await expect(adapter.resolveOrRequest(key, query)).rejects.toThrow();
  });

  afterEach(() => vi.useRealTimers());
  it('preserves the real adapter receiver through the application recovery use case', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ bookmarkId: 'receiver', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic Series', url: 'https://reader.invalid/anime/synthetic-series' }], storage, '2026-09-23T12:00:00.000Z');
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    const record = await storage.getFavoriteParseArtifact(source!.id);
    const identity = await favoriteIdentityKey(record!.artifact);
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() }, { status: 202 }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await expect(requestPublicFavoriteDiscoveryRecovery(adapter, identity, record!.artifact)).resolves.toMatchObject({ state: 'PENDING' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('uses the remaining wake time and aborts HTTP before the wake expires', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    let signal: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Promise<Response>(() => undefined);
    });
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    adapter.setDeadline(Date.now() + 4_000);
    const assertion = expect(adapter.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await assertion;
    expect(signal?.aborted).toBe(true);
  });
  it('does not spend its remaining wake budget sleeping for an admission reservation', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-23T12:00:00.000Z');
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: '2026-09-23T12:05:00.000Z' }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    await adapter.requestRecovery(key, query);
    adapter.setDeadline(Date.now() + 500);
    await expect(adapter.requestRecovery({ ...key, fingerprint: 'b'.repeat(64) }, query)).rejects.toMatchObject({ code: 'ADMISSION_WAIT' });
    expect(Date.now()).toBe(Date.parse('2026-09-23T12:00:00.000Z'));
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('keeps Retry-After across restart and refuses requests outside the wake budget', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage).requestRefresh(key)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await expect(restarted.requestRefresh(key)).rejects.toMatchObject({ code: 'ADMISSION_WAIT', retryAt: '2026-09-18T12:02:00.000Z' });
    restarted.setDeadline(Date.now() + 999);
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
  it.each([false, true])('only observes overdue PENDING after restart with a stored clock %s', async storedClock => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    if (storedClock) clocks[`public-discovery-pending-v1:${JSON.stringify(key)}`] = Date.now() + 60_000;
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() }));
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage).resolveOrRequest(key, query);
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_001);
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await restarted.resolveOrRequest(key, query);
    expect(fetcher.mock.calls).toHaveLength(2);
  });
  it('never re-admits an explicitly recovered request when its polling deadline expires', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-28T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => Response.json({
      state: 'PENDING', retryAt: '2026-09-28T12:01:00.000Z',
    }, { status: init.method === 'POST' ? 202 : 200 }));
    await new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage).requestRecovery(key, query);
    vi.setSystemTime(Date.now() + 90_000);
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await expect(restarted.resolveOrRequest(key, query)).resolves.toEqual({ state: 'PENDING', retryAt: '2026-09-28T12:02:30.000Z' });
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'GET']);
  });
  it.each([[429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE'], [409, 'CONTRACT_CONFLICT']] as const)('classifies HTTP %s without leaking response content', async (status, code) => {
    const fetcher = vi.fn(async () => new Response('private payload', { status, headers: { 'Retry-After': '120' } }));
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).resolveOrRequest(key, query)).rejects.toMatchObject({ code, httpStatus: status });
  });
  it('bounds stalled HTTP and malformed JSON responses', async () => {
    vi.useFakeTimers();
    const stalled = new HttpPublicDiscoveryAdapter('https://tobirink.com', async () => new Promise<Response>(() => undefined));
    const assertion = expect(stalled.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(44_999);
    await vi.advanceTimersByTimeAsync(1); await assertion;
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

  it('paces concurrent admissions without converting short waits into retryable failures', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-14T12:00:00.000Z');
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => init.method === 'GET'
      ? Response.json({ state: 'MISS' })
      : Response.json({ retryAt: new Date(Date.now() + 60_000).toISOString(), state: 'PENDING' }, { status: 202 }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    const requests = [
      adapter.resolveOrRequest({ ...key, fingerprint: '1'.repeat(64) }, { ...query, discoveryTitles: ['Frieren One'] }),
      adapter.resolveOrRequest({ ...key, fingerprint: '2'.repeat(64) }, { ...query, discoveryTitles: ['Frieren Two'] }),
      adapter.resolveOrRequest({ ...key, fingerprint: '3'.repeat(64) }, { ...query, discoveryTitles: ['Frieren Three'] }),
    ];
    const settled = Promise.all(requests);
    await vi.runAllTimersAsync();
    await expect(settled).resolves.toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(3);
  });

  it('shares one read and admission for four identical concurrent submissions', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-26T12:00:00.000Z');
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => Response.json(init.method === 'GET'
      ? { state: 'MISS' }
      : { state: 'PENDING', retryAt: '2026-09-26T12:01:00.000Z' }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    const requests = Promise.all(Array.from({ length: 4 }, () => adapter.resolveOrRequest({ ...key }, { ...query })));
    await vi.runAllTimersAsync();
    expect(await requests).toEqual(Array.from({ length: 4 }, () => ({ state: 'PENDING', retryAt: '2026-09-26T12:01:00.000Z' })));
    expect(fetcher.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST']);
  });

  it('does not share a submitted result with a different query for the same key', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-26T12:00:00.000Z');
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => Response.json(init.method === 'GET'
      ? { state: 'MISS' }
      : { state: 'PENDING', retryAt: '2026-09-26T12:01:00.000Z' }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher);
    const first = adapter.resolveOrRequest(key, query);
    const different = expect(adapter.resolveOrRequest(key, { ...query, season: 2 })).rejects.toMatchObject({ code: 'ADMISSION_WAIT' });
    await vi.runAllTimersAsync();
    await expect(first).resolves.toMatchObject({ state: 'PENDING' });
    await different;
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
  });

  it.each(['resolveOrRequest', 'requestRecovery'] as const)('persists a lost %s response lease across restart even when D1 still reads MISS', async (method) => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-26T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = { get: async () => clocks, set: async (values: Record<string, number>) => { Object.assign(clocks, values); } };
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      if (init.method === 'GET') return Response.json({ state: 'MISS' });
      throw new TypeError('Response lost');
    });
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await expect(adapter[method](key, query)).rejects.toMatchObject({ code: 'NETWORK' });
    await vi.advanceTimersByTimeAsync(1_101);
    const restarted = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    await expect(restarted.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'ADMISSION_WAIT', retryAt: '2026-09-26T12:01:00.000Z' });
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(restarted.resolveOrRequest(key, query)).rejects.toMatchObject({ code: 'NETWORK' });
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'POST')).toHaveLength(2);
  });

  it('keeps the key reservation atomic even when durable storage takes longer than admission cadence', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-26T12:00:00.000Z');
    const clocks: Record<string, number> = {};
    const storage = {
      get: async () => clocks,
      set: async (values: Record<string, number>) => {
        if (Object.keys(values).some((name) => name.startsWith('public-discovery-pending-v1:'))) await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
        Object.assign(clocks, values);
      },
    };
    const fetcher = vi.fn(async () => Response.json({ state: 'PENDING', retryAt: new Date(Date.now() + 60_000).toISOString() }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    const requests = Promise.allSettled([adapter.requestRecovery(key, query), adapter.requestRecovery(key, { ...query, season: 2 })]);
    await vi.runAllTimersAsync();
    expect(await requests).toMatchObject([{ status: 'fulfilled', value: { state: 'PENDING' } }, { status: 'rejected', reason: { code: 'ADMISSION_WAIT' } }]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('releases a rejected shared read so a later terminal result wins over an active lease', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-26T12:00:00.000Z');
    const clocks = { [`public-discovery-pending-v1:${JSON.stringify(key)}`]: Date.now() + 60_000 };
    const storage = { get: async () => clocks, set: async () => undefined };
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValue(Response.json({ state: 'NOT_FOUND', reason: 'NO_MATCH', verifiedAt: new Date().toISOString() }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher, storage);
    const failed = await Promise.allSettled(Array.from({ length: 4 }, () => adapter.resolveOrRequest(key, query)));
    expect(failed.every((result) => result.status === 'rejected')).toBe(true);
    await expect(adapter.resolveOrRequest(key, query)).resolves.toMatchObject({ state: 'NOT_FOUND' });
    expect(fetcher).toHaveBeenCalledTimes(2);
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

  it('rearms an unavailable request only through the explicit recovery method', async () => {
    vi.useFakeTimers(); vi.setSystemTime('2026-09-18T12:00:00.000Z');
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      expect(init.method).toBe('POST');
      return Response.json({ retryAt: new Date(Date.now() + 60_000).toISOString(), state: 'PENDING' }, { status: 202 });
    });
    await expect(new HttpPublicDiscoveryAdapter('https://tobirink.com', fetcher).requestRecovery(key, query)).resolves.toMatchObject({ state: 'PENDING' });
    expect(fetcher).toHaveBeenCalledOnce();
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
