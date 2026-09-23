import { describe, expect, it, vi } from 'vitest';
import type { PublicDiscoveryClaimedRequest } from './contracts';
import { FavoriteProviderRetryError, type FavoriteProviderPort, type ProviderCandidate, type ResolutionProvider } from './provider-kit';
import { createPublicDiscoveryResolver } from './resolver';
import type { PublicDiscoveryProviderPorts } from './resolver';
import { FavoriteProviderRateGate } from './provider-http';
import { MangaUpdatesFavoriteProviderAdapter } from './providers/mangaupdates';
import { runPublicDiscoveryBatch } from './collector';

function candidate(provider: ResolutionProvider, mediaKind: ProviderCandidate['mediaKind'], externalId: string, title: string): ProviderCandidate {
  return { externalId, mediaKind, preSerialization: false, provider, titles: [title] };
}

function port(provider: ResolutionProvider, result?: ProviderCandidate): FavoriteProviderPort & { hydrate: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> } {
  return {
    hydrate: vi.fn(async () => result),
    search: vi.fn(async () => ({ candidates: result === undefined ? [] : [result], complete: true, digest: `${provider}:fixture`, provider, truncated: false })),
  };
}

function request(mediaKind: PublicDiscoveryClaimedRequest['query']['mediaKind'], title = 'Target'): PublicDiscoveryClaimedRequest {
  return {
    attempt: 1,
    key: { fingerprint: 'a'.repeat(64), mediaKind, parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
    query: { discoveryTitles: [title], mediaKind, sourceTitles: [title] },
    requestDigest: 'b'.repeat(64),
    schemaVersion: 3,
  };
}

function providers(values: Partial<Record<ResolutionProvider, ProviderCandidate>> = {}): PublicDiscoveryProviderPorts & Record<ResolutionProvider, ReturnType<typeof port>> {
  return {
    anilist: port('anilist', values.anilist),
    mangaupdates: port('mangaupdates', values.mangaupdates),
    mangadex: port('mangadex', values.mangadex),
    'kitsu-anime': port('kitsu-anime', values['kitsu-anime']),
    'kitsu-manga': port('kitsu-manga', values['kitsu-manga']),
  };
}

describe('standalone provider resolver', () => {
  it('follows a real MangaUpdates search cursor before deciding the work is absent', async () => {
    let now = 0;
    let nextAllowedAt = 0;
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async (_provider, at, interval) => {
        const reservedAt = Math.max(at, nextAllowedAt);
        nextAllowedAt = reservedAt + interval;
        return reservedAt;
      }),
    };
    const wait = vi.fn(async (delay: number) => { now += delay; });
    const gate = new FavoriteProviderRateGate('mangaupdates', controls, () => now, wait);
    const series = (id: number, title: string) => ({ series_id: id, title, type: 'Manga' });
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/search')) {
        const body = JSON.parse(String(init.body));
        return Response.json({ results: [{ record: series(body.page, body.page === 1 ? 'Unrelated work' : 'Target') }], total_hits: 26 });
      }
      return Response.json(series(2, 'Target'));
    });
    const ports = { ...providers(), mangaupdates: new MangaUpdatesFavoriteProviderAdapter(fetcher, gate) };
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      profile: { candidate: { externalId: '2', provider: 'mangaupdates' } }, state: 'VERIFIED',
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.slice(0, 2).map(([, init]) => JSON.parse(String(init.body)).page)).toEqual([1, 2]);
    expect(wait.mock.calls).toEqual([[6_000], [6_000]]);
    expect(controls.recordFailure).not.toHaveBeenCalled();
    expect(ports.mangadex.search).not.toHaveBeenCalled();
  });

  it('does not publish NOT_FOUND when every manga provider returns an incomplete page', async () => {
    const ports = providers();
    for (const provider of ['mangaupdates', 'mangadex', 'kitsu-manga'] as const) {
      ports[provider].search.mockResolvedValue({ candidates: [], complete: false, digest: 'partial', provider, truncated: true });
    }
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toThrow('incomplete-provider-search');
  });

  it('counts an incomplete search as an attempted failure, not an endless cadence deferral', async () => {
    const ports = providers();
    ports.anilist.search.mockResolvedValue({ candidates: [], complete: false, digest: 'partial', provider: 'anilist', truncated: true });
    const gateway = {
      claim: async () => ({ claimToken: 'x'.repeat(64), requests: [request('ANIME')], schemaVersion: 3 as const }),
      defer: vi.fn(async () => undefined),
      publish: vi.fn(async () => ({ published: 1, replayed: 0 })),
    };
    const report = await runPublicDiscoveryBatch({
      gateway, limit: 1, nonce: () => '12345678-1234-4234-8234-123456789abc', now: () => '2026-09-23T10:00:00.000Z',
      resolver: createPublicDiscoveryResolver(ports),
    });
    expect(report).toEqual({ claimed: 1, deferred: 0, failed: 1, published: 0, replayed: 0 });
    expect(gateway.defer).not.toHaveBeenCalled();
    expect(gateway.publish).not.toHaveBeenCalled();
  });

  it('keeps a genuine rate-gate deferral and its Retry-After deadline', async () => {
    const ports = providers();
    const unavailable = new FavoriteProviderRetryError('cadence', Date.now() + 120_000);
    ports.anilist.search.mockRejectedValue(unavailable);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toBe(unavailable);
  });

  it('stops at four pages when no exact identity proves the remaining search unnecessary', async () => {
    const ports = providers();
    ports.anilist.search.mockImplementation(async ({ cursor }) => ({
      candidates: [], complete: false, digest: `page-${cursor}`, nextCursor: String(Number(cursor) + 1), provider: 'anilist', truncated: true,
    }));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search:page-limit');
    expect(ports.anilist.search.mock.calls.map(([query]) => query.cursor)).toEqual(['1', '2', '3', '4']);
  });

  it('stops repeated cursors rather than claiming the provider was exhausted', async () => {
    const ports = providers();
    ports.anilist.search.mockResolvedValue({ candidates: [], complete: false, digest: 'partial', nextCursor: '2', provider: 'anilist', truncated: true });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search:cursor');
    expect(ports.anilist.search).toHaveBeenCalledTimes(2);
  });

  it('does not promote a fuzzy match from an incomplete result', async () => {
    const ports = providers({ anilist: candidate('anilist', 'ANIME', '1', 'Targat') });
    ports.anilist.search.mockResolvedValue({
      candidates: [candidate('anilist', 'ANIME', '1', 'Targat')], complete: false, digest: 'partial', provider: 'anilist', truncated: true,
    });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search');
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });

  it('retains an admissible early exact proof without fetching unneeded pages', async () => {
    const target = candidate('anilist', 'ANIME', '99', 'Target');
    const ports = providers({ anilist: target });
    ports.anilist.search.mockResolvedValue({ candidates: [target], complete: false, digest: 'exact', nextCursor: '2', provider: 'anilist', truncated: true });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({ state: 'VERIFIED' });
    expect(ports.anilist.search).toHaveBeenCalledOnce();
  });

  it('starts each distinct alias at page one without repeating duplicate aliases', async () => {
    const target = candidate('anilist', 'ANIME', '99', 'Target');
    const ports = providers({ anilist: target });
    ports.anilist.search.mockImplementation(async ({ titles }) => ({
      candidates: titles[0] === 'Target' ? [target] : [], complete: true, digest: 'alias', provider: 'anilist', truncated: false,
    }));
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, discoveryTitles: ['Alias', 'Alias', 'Target'] },
    })).resolves.toMatchObject({ state: 'VERIFIED' });
    expect(ports.anilist.search.mock.calls.map(([query]) => [query.titles[0], query.cursor])).toEqual([['Alias', '1'], ['Target', '1']]);
  });

  it('does not lose an incomplete fallback behind a later transient provider failure', async () => {
    const ports = providers({ mangaupdates: candidate('mangaupdates', 'MANGA', '1', 'Target') });
    ports.mangaupdates.hydrate.mockRejectedValue(new Error('HTTP 503'));
    ports.mangadex.search.mockResolvedValue({ candidates: [], complete: false, digest: 'partial', provider: 'mangadex', truncated: true });
    ports['kitsu-manga'].search.mockRejectedValue(new FavoriteProviderRetryError('cadence', Date.now() + 120_000));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toThrow('incomplete-provider-search');
  });

  it('finds an exact candidate beyond the first twenty-five unrelated results', async () => {
    const target = candidate('anilist', 'ANIME', '99', 'Target');
    const ports = providers({ anilist: target });
    const unrelated = Array.from({ length: 20 }, (_, index) => candidate('anilist', 'ANIME', String(index + 1), `Unrelated ${index}`));
    ports.anilist.search
      .mockResolvedValueOnce({ candidates: unrelated, complete: false, digest: 'first', nextCursor: '2', provider: 'anilist', truncated: true })
      .mockResolvedValueOnce({ candidates: [...unrelated.slice(0, 19).map((value, index) => ({ ...value, externalId: String(index + 21) })), target], complete: true, digest: 'last', provider: 'anilist', truncated: false });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({
      profile: { candidate: { externalId: '99' } }, state: 'VERIFIED',
    });
  });

  it('refuses to silently discard comparable identities at the candidate bound', async () => {
    const ports = providers();
    const fuzzy = (offset: number, count: number) => Array.from({ length: count }, (_, index) => candidate('anilist', 'ANIME', String(index + offset), 'Targat'));
    ports.anilist.search
      .mockResolvedValueOnce({ candidates: fuzzy(1, 20), complete: false, digest: 'first', nextCursor: '2', provider: 'anilist', truncated: true })
      .mockResolvedValueOnce({ candidates: fuzzy(21, 6), complete: true, digest: 'last', provider: 'anilist', truncated: false });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search:candidate-limit');
  });

  it('still returns NOT_FOUND when all searched provider pages are genuinely complete', async () => {
    await expect(createPublicDiscoveryResolver(providers()).resolve(request('MANGA'))).resolves.toEqual({
      reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND',
    });
  });

  it('does not issue later pages or fallback calls after the shared twenty-second search budget', async () => {
    vi.useFakeTimers();
    try {
      const ports = providers();
      ports.anilist.search.mockImplementation(async () => {
        await new Promise((resolve) => { setTimeout(resolve, 25_000); });
        return { candidates: [], complete: false, digest: 'late', nextCursor: '2', provider: 'anilist', truncated: true };
      });
      const outcome = expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search:deadline');
      await vi.advanceTimersByTimeAsync(20_000);
      await outcome;
      expect(ports['kitsu-anime'].search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ports.anilist.search).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('uses AniList then Kitsu Anime without touching manga providers', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-anime' } } });
    expect(ports.anilist.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it('uses MangaUpdates, MangaDex and Kitsu Manga in order', async () => {
    const ports = providers({ 'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-manga' } } });
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('reports ambiguity when unknown media matches both provider lanes', async () => {
    const ports = providers({
      anilist: candidate('anilist', 'ANIME', '1', 'Target'),
      mangaupdates: candidate('mangaupdates', 'MANGA', '2', 'Target'),
    });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).resolves.toMatchObject({ state: 'AMBIGUOUS', candidates: [{ provider: 'anilist' }, { provider: 'mangaupdates' }] });
  });

  it('hydrates an explicit provider identity without searching', async () => {
    const exact = candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc', 'Target');
    const ports = providers({ mangadex: exact });
    const base = request('MANGA');
    const input = {
      ...base,
      query: {
        ...base.query,
        explicitProviderReference: { externalId: exact.externalId, provider: 'mangadex' as const },
      },
    };
    await expect(createPublicDiscoveryResolver(ports).resolve(input)).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: exact } });
    expect(ports.mangadex.search).not.toHaveBeenCalled();
    expect(ports.mangadex.hydrate).toHaveBeenCalledOnce();
  });

  it('preserves exact same-work references without relation exploration', async () => {
    const exact = {
      ...candidate('anilist', 'ANIME', '154587', 'Shared Title'),
      linkedReferences: [{ externalId: '46474', provider: 'kitsu-anime' as const }],
    };
    const ports = providers({ anilist: exact });
    const base = request('ANIME', 'Shared Title');
    const resolution = await createPublicDiscoveryResolver(ports).resolve({
      ...base, query: { ...base.query, explicitProviderReference: { externalId: '154587', provider: 'anilist' } },
    });
    expect(resolution).toMatchObject({
      profile: { candidate: { mediaKind: 'ANIME' }, references: [
        { externalId: '154587', provider: 'anilist' },
        { externalId: '46474', provider: 'kitsu-anime' },
      ] },
      state: 'VERIFIED',
    });
  });

  it.each(['HTTP 403', 'HTTP 429', 'TimeoutError', 'incomplete provider page'])('falls back after a transient %s', async (failure) => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    ports.anilist.search.mockRejectedValueOnce(new Error(failure));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-anime' } } });
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
  });

  it('falls back from MangaUpdates to MangaDex after a transient failure', async () => {
    const ports = providers({ mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target') });
    ports.mangaupdates.search.mockRejectedValueOnce(new Error('HTTP 429'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'mangadex' } } });
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
  });

  it('does not publish an explicit identity when hydration returns another reference', async () => {
    const ports = providers({ mangadex: candidate('mangadex', 'MANGA', 'other-id', 'Target') });
    const input = request('MANGA');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input,
      query: { ...input.query, explicitProviderReference: { externalId: 'expected-id', provider: 'mangadex' } },
    })).rejects.toThrow('hydrated-identity-mismatch');
  });

  it('uses the same exact MangaUpdates search identity when its hydration endpoint returns HTTP 405', async () => {
    const exact = candidate('mangaupdates', 'MANGA', '12345', 'Target');
    const ports = providers({ mangaupdates: exact });
    ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 405'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      profile: { candidate: { externalId: '12345', provider: 'mangaupdates' } }, state: 'VERIFIED',
    });
    expect(ports.mangadex.search).not.toHaveBeenCalled();
  });

  it('falls back to Kitsu when a matched MangaUpdates identity cannot be hydrated transiently', async () => {
    const ports = providers({
      mangaupdates: candidate('mangaupdates', 'MANGA', '12345', 'Target'),
      'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target'),
    });
    ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      profile: { candidate: { provider: 'kitsu-manga', externalId: '84' } }, state: 'VERIFIED',
    });
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].hydrate).toHaveBeenCalledOnce();
  });

  it('falls back from MangaUpdates to Kitsu after a method failure', async () => {
    const ports = providers({ 'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target') });
    ports.mangaupdates.search.mockRejectedValueOnce(new Error('HTTP 401'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-manga', externalId: '84' } },
    });
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('returns a retryable error when every manga search lane is unavailable', async () => {
    const ports = providers();
    ports.mangaupdates.search.mockRejectedValueOnce(new Error('HTTP 503'));
    ports.mangadex.search.mockRejectedValueOnce(new Error('HTTP 429'));
    ports['kitsu-manga'].search.mockRejectedValueOnce(new Error('TimeoutError'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toMatchObject({
      message: 'TimeoutError', retryAt: expect.any(Number),
    });
  });

  it('does not publish one UNKNOWN lane while the other lane is unavailable', async () => {
    const ports = providers({ anilist: candidate('anilist', 'ANIME', '1', 'Target') });
    ports.mangaupdates.search.mockRejectedValueOnce(new Error('HTTP 429'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toThrow('HTTP 429');
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });
});
