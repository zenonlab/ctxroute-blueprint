import { describe, expect, it, vi } from 'vitest';
import type { PublicDiscoveryClaimedRequest } from './contracts';
import { FavoriteProviderRetryError, type FavoriteProviderPort, type ProviderCandidate, type ResolutionProvider } from './provider-kit';
import { createPublicDiscoveryResolver, PublicDiscoveryInvocationYieldError, PublicDiscoverySearchContinuationError } from './resolver';
import type { PublicDiscoveryProviderPorts } from './resolver';
import { FavoriteProviderRateGate } from './provider-http';
import { MangaUpdatesFavoriteProviderAdapter } from './providers/mangaupdates';
import { KitsuFavoriteProviderAdapter } from './providers/kitsu';
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
  it.each(['verified', 'not-found'] as const)('continues past a rejected optional cover to a %s terminal result', async (outcome) => {
    const resource = (title: string) => ({
      id: title === 'Target' ? '42' : '41', type: 'anime', attributes: {
        abbreviatedTitles: [], canonicalTitle: title, slug: 'synthetic-title', subtype: 'TV', titles: {},
        posterImage: { large: 'https://images.example.test/cover.jpeg' },
      },
    });
    const offsets: string[] = [];
    const fetcher = vi.fn(async (input: string) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/42')) return Response.json({ data: resource('Target') });
      const offset = url.searchParams.get('page[offset]')!;
      offsets.push(offset);
      return Response.json(offset === '240'
        ? { data: [resource('Unrelated title')], links: { next: 'https://kitsu.io/api/edge/anime?page%5Boffset%5D=260' }, meta: { count: 261 } }
        : { data: outcome === 'verified' ? [resource('Target')] : [], links: { next: null }, meta: { count: outcome === 'verified' ? 261 : 260 } });
    });
    const adapter = new KitsuFavoriteProviderAdapter('kitsu-anime', fetcher,
      new FavoriteProviderRateGate('kitsu-anime', undefined, () => 10_000, async () => undefined));
    const input = { ...request('ANIME'), searchProgress: { candidates: [], cursor: '13', provider: 'kitsu-anime' as const, titleIndex: 0, version: 1 as const } };
    const result = await createPublicDiscoveryResolver({ ...providers(), 'kitsu-anime': adapter }).resolve(input);
    expect(offsets).toEqual(['240', '260']);
    expect(result.state).toBe(outcome === 'verified' ? 'VERIFIED' : 'NOT_FOUND');
    if (result.state === 'VERIFIED') expect(result.profile.candidate).not.toHaveProperty('cover');
    expect(fetcher).toHaveBeenCalledTimes(outcome === 'verified' ? 3 : 2);
  });

  it('reaches Kitsu when AniList returns an exact ID but cannot corroborate the requested season', async () => {
    const ports = providers({
      anilist: { ...candidate('anilist', 'ANIME', '123', 'Target'), format: 'TV' },
      'kitsu-anime': { ...candidate('kitsu-anime', 'ANIME', '42', 'Target'), format: 'TV' },
    });
    const input = request('ANIME');
    const result = await createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1, sourceFormat: 'NON_OVA', discoveryTitles: ['Target', 'Broad variant'] } });
    expect(ports.anilist.search).toHaveBeenCalledTimes(2);
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports['kitsu-anime'].hydrate).not.toHaveBeenCalled();
    expect(result).toEqual({ state: 'AMBIGUOUS', reason: 'season-unconfirmed', candidates: [{ provider: 'kitsu-anime', externalId: '42' }] });
  });

  it('offers an exact unseasoned identity for human review only after the primary search', async () => {
    const ports = providers({ 'kitsu-anime': { ...candidate('kitsu-anime', 'ANIME', '42', 'Target'), format: 'TV' } });
    const input = request('ANIME');
    const result = await createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1, sourceFormat: 'NON_OVA', discoveryTitles: ['Target', 'Broad variant'] } });
    expect(result).toEqual({ state: 'AMBIGUOUS', reason: 'season-unconfirmed', candidates: [{ provider: 'kitsu-anime', externalId: '42' }] });
    expect(ports.anilist.search).toHaveBeenCalledTimes(2);
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports['kitsu-anime'].hydrate).not.toHaveBeenCalled();
  });

  it.each([
    { titles: ['Target Season 2'] },
    { season: 2 },
    { titles: ['Targat'] },
    { format: 'OVA' },
    { preSerialization: true },
  ])('does not disguise contradictory or approximate evidence as a season review: %j', async (change) => {
    const ports = providers({ 'kitsu-anime': { ...candidate('kitsu-anime', 'ANIME', '42', 'Target'), format: 'TV', ...change } });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1, sourceFormat: 'NON_OVA', preSerialization: false } })).resolves.toMatchObject({ state: 'NOT_FOUND' });
  });

  it('does not convert primary provider failure into a season review', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    ports.anilist.search.mockRejectedValue(new Error('network unavailable'));
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1 } })).rejects.toThrow('network unavailable');
  });

  it('does not conclude a season review from an incomplete fallback page', async () => {
    const ports = providers();
    ports['kitsu-anime'].search.mockResolvedValue({ candidates: [candidate('kitsu-anime', 'ANIME', '42', 'Target')], complete: false, digest: 'incomplete', provider: 'kitsu-anime', truncated: true });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1 } })).rejects.toThrow('incomplete-provider-search');
  });

  it('keeps an unknown-media request outside the anime-only season Review contract', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    const input = request('UNKNOWN');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1 } })).resolves.toMatchObject({ state: 'NOT_FOUND' });
  });

  it('still verifies a corroborated fallback season instead of requiring human review', async () => {
    const ports = providers({ 'kitsu-anime': { ...candidate('kitsu-anime', 'ANIME', '42', 'Target'), season: 1 } });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 1 } })).resolves.toMatchObject({ state: 'VERIFIED' });
    expect(ports['kitsu-anime'].hydrate).toHaveBeenCalledOnce();
  });

  it.each([
    ['NON_OVA', 'OVA'],
    ['OVA', 'TV'],
  ] as const)('does not verify a %s request with a %s candidate', async (sourceFormat, format) => {
    const ports = providers({ anilist: { ...candidate('anilist', 'ANIME', '42', 'Target'), format } });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, sourceFormat } })).resolves.toMatchObject({ state: 'NOT_FOUND' });
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });

  it.each([undefined, 1])('requires season two corroboration instead of season %s', async (season) => {
    const target = candidate('anilist', 'ANIME', '42', 'Target');
    const ports = providers({ anilist: season === undefined ? target : { ...target, season } });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2 } })).resolves.toMatchObject({ state: 'NOT_FOUND' });
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });

  it('matches a corroborated season suffix without confusing intrinsic title numbers', async () => {
    const target = candidate('anilist', 'ANIME', '42', 'Area 51 2nd Season');
    const ports = providers({ anilist: target });
    ports.anilist.search.mockResolvedValue({ candidates: [target, candidate('anilist', 'ANIME', '43', 'Area 52 2nd Season')], complete: true, digest: 'season-fixture', provider: 'anilist', truncated: false });
    const input = request('ANIME', 'Area 51 Saison 2');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2 } })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { externalId: '42' } } });
  });

  it('does not use approximate matching to replace an intrinsic title number', async () => {
    const ports = providers({ anilist: { ...candidate('anilist', 'ANIME', '42', 'Area 52'), season: 2 } });
    const input = request('ANIME', 'Area 51');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2 } })).resolves.toMatchObject({ state: 'NOT_FOUND' });
  });

  it('does not turn an incompatible candidate on an incomplete page into NOT_FOUND', async () => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Target'), format: 'OVA' };
    const ports = providers({ anilist: target });
    ports.anilist.search.mockResolvedValue({ candidates: [target], complete: false, digest: 'partial-ova', provider: 'anilist', truncated: true });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, sourceFormat: 'NON_OVA' } })).rejects.toThrow('incomplete-provider-search');
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });

  it.each([
    { mediaKind: 'MANGA' as const },
    { format: 'OVA' },
    { season: 1 },
    { preSerialization: true },
  ])('rejects searched hydration constraint drift: %j', async (drift) => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Target'), format: 'TV', season: 2 };
    const ports = providers({ anilist: target });
    ports.anilist.hydrate.mockResolvedValue({ ...target, ...drift });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2, sourceFormat: 'NON_OVA', preSerialization: false } })).rejects.toThrow('hydrated-candidate-incompatible');
    expect(ports['kitsu-anime'].search).not.toHaveBeenCalled();
  });

  it('keeps an UNKNOWN searched identity in its proven lane during hydration', async () => {
    const target = candidate('anilist', 'ANIME', '42', 'Target');
    const ports = providers({ anilist: target });
    ports.anilist.hydrate.mockResolvedValue({ ...target, mediaKind: 'MANGA' });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toThrow('hydrated-candidate-incompatible');
  });

  it('checks searched hydration constraints after a provider fallback too', async () => {
    const first = { ...candidate('anilist', 'ANIME', '42', 'Target'), format: 'TV' };
    const second = { ...candidate('kitsu-anime', 'ANIME', '43', 'Target'), format: 'TV' };
    const ports = providers({ anilist: first, 'kitsu-anime': second });
    ports.anilist.hydrate.mockRejectedValue(new Error('network unavailable'));
    ports['kitsu-anime'].hydrate.mockResolvedValue({ ...second, format: 'OVA' });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, sourceFormat: 'NON_OVA' } })).rejects.toThrow('hydrated-candidate-incompatible');
  });

  it('accepts a comic subtype correction while keeping the exact searched reference', async () => {
    const target = candidate('mangadex', 'MANGA', '42', 'Target');
    const ports = providers({ mangadex: target });
    ports.mangadex.hydrate.mockResolvedValue({ ...target, mediaKind: 'MANHWA' });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'mangadex', externalId: '42', mediaKind: 'MANHWA' } } });
  });

  it.each(['season', 'format'] as const)('retains search evidence when the same exact hydrated identity omits %s', async (omitted) => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Target'), format: 'OVA', season: 2 };
    const ports = providers({ anilist: target });
    const hydrated = omitted === 'season'
      ? { ...candidate('anilist', 'ANIME', '42', 'Hydrated Title'), format: 'OVA' }
      : { ...candidate('anilist', 'ANIME', '42', 'Hydrated Title'), season: 2 };
    ports.anilist.hydrate.mockResolvedValue(hydrated);
    const input = request('ANIME');
    const result = await createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2, sourceFormat: 'OVA' } });
    expect(result).toMatchObject({ state: 'VERIFIED', profile: { candidate: hydrated } });
    if (result.state !== 'VERIFIED') throw new Error('Expected a verified result.');
    expect(result.profile.candidate).not.toHaveProperty(omitted);
    expect(result.profile.candidate.titles).toEqual(['Hydrated Title']);
  });

  it('does not replace a contradictory hydrated season title with search evidence', async () => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Target'), season: 2 };
    const ports = providers({ anilist: target });
    ports.anilist.hydrate.mockResolvedValue(candidate('anilist', 'ANIME', '42', 'Target Season 1'));
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2 } })).rejects.toThrow('hydrated-candidate-incompatible');
  });

  it.each([
    { provider: 'anilist' as const, externalId: '43' },
    { provider: 'kitsu-anime' as const, externalId: '42' },
  ])('never carries search evidence to a different hydrated identity: %j', async (reference) => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Target'), format: 'OVA', season: 2 };
    const ports = providers({ anilist: target });
    ports.anilist.hydrate.mockResolvedValue(candidate(reference.provider, 'ANIME', reference.externalId, 'Hydrated Title'));
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, season: 2, sourceFormat: 'OVA' } })).rejects.toThrow('hydrated-identity-mismatch');
  });

  it('keeps explicit reference hydration authoritative over title-derived season and format', async () => {
    const target = { ...candidate('anilist', 'ANIME', '42', 'Another Title'), format: 'OVA', season: 1 };
    const ports = providers({ anilist: target });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, explicitProviderReference: { provider: 'anilist', externalId: '42' }, season: 2, sourceFormat: 'NON_OVA' } })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: target } });
    expect(ports.anilist.search).not.toHaveBeenCalled();
  });

  it.each([12345, 67890])('hydrates a translated MangaUpdates hit without trusting a different identity: %s', async hydratedId => {
    let now = 0;
    const gate = new FavoriteProviderRateGate('mangaupdates', undefined, () => now, async delay => { now += delay; });
    const fetcher = vi.fn(async (url: string) => url.endsWith('/search')
      ? Response.json({ results: [{ record: { series_id: 12345, title: 'Original Title', type: 'Manga' }, hit_title: 'Target' }], total_hits: 10000 })
      : Response.json({ series_id: hydratedId, title: 'Original Title', type: 'Manga', associated: [{ title: 'Target' }] }));
    const ports = { ...providers(), mangaupdates: new MangaUpdatesFavoriteProviderAdapter(fetcher, gate) };
    const result = createPublicDiscoveryResolver(ports).resolve(request('MANGA'));
    if (hydratedId === 12345) await expect(result).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { externalId: '12345' } } });
    else await expect(result).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('follows a real MangaUpdates search cursor before deciding the work is absent', async () => {
    let now = 0;
    let nextAllowedAt = 0;
    const controls = {
      recordFailure: vi.fn(async () => undefined),
      recordSuccess: vi.fn(async () => undefined),
      reserve: vi.fn(async (_provider, at, interval) => {
        const reservedAt = Math.max(at, nextAllowedAt);
        nextAllowedAt = reservedAt + interval;
        return { notBefore: reservedAt, probeOnly: false };
      }),
    };
    const wait = vi.fn(async (delay: number) => { now += delay; });
    const gate = new FavoriteProviderRateGate('mangaupdates', controls, () => now, wait);
    const series = (id: number, title: string) => ({ series_id: id, title, type: 'Manga' });
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/search')) {
        const body = JSON.parse(String(init.body));
        return Response.json({ results: [{ record: series(body.page, body.page === 1 ? 'Unrelated work' : 'Target') }], total_hits: 101 });
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
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('finishes a resumed final MangaUpdates page with an unrelated overlong title', async () => {
    const fetcher = vi.fn(async () => Response.json({
      results: [{ record: { series_id: 12345, title: 'A'.repeat(201), type: 'Manga' } }], total_hits: 3778,
    }));
    const ports = { ...providers(), mangaupdates: new MangaUpdatesFavoriteProviderAdapter(fetcher) };
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...request('MANGA'),
      searchProgress: { provider: 'mangaupdates', cursor: 'mu2:38', titleIndex: 0, candidates: [], version: 1 },
    })).resolves.toMatchObject({ state: 'NOT_FOUND' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(ports.mangadex.search).not.toHaveBeenCalled();
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
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

  it('checkpoints after four pages when no exact identity proves the remaining search unnecessary', async () => {
    const ports = providers();
    ports.anilist.search.mockImplementation(async ({ cursor }) => ({
      candidates: [], complete: false, digest: `page-${cursor}`, nextCursor: String(Number(cursor) + 1), provider: 'anilist', truncated: true,
    }));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toMatchObject({
      message: 'public-discovery-search-continuation',
      searchProgress: { candidates: [], cursor: '5', provider: 'anilist', titleIndex: 0, version: 1 },
    });
    expect(ports.anilist.search.mock.calls.map(([query]) => query.cursor)).toEqual(['1', '2', '3', '4']);
  });

  it('resumes directly at the persisted page and verifies an exact later result', async () => {
    const target = candidate('anilist', 'ANIME', '42', 'Target');
    const ports = providers({ anilist: target });
    ports.anilist.search.mockImplementation(async ({ cursor }) => ({
      candidates: cursor === '5' ? [target] : [], complete: cursor === '5', digest: `page-${cursor}`,
      nextCursor: cursor === '5' ? undefined : String(Number(cursor) + 1), provider: 'anilist', truncated: cursor !== '5',
    }));
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...request('ANIME'), searchProgress: {
      candidates: [], cursor: '5', provider: 'anilist', titleIndex: 0, version: 1,
    } })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: target } });
    expect(ports.anilist.search.mock.calls.map(([query]) => query.cursor)).toEqual(['5']);
  });

  it('checkpoints the current alias when a known-media invocation budget is reached', async () => {
    const target = candidate('mangadex', 'MANGA', 'md-1', 'Target');
    const ports = providers({ mangadex: target });
    ports.mangadex.search.mockImplementationOnce(async () => ({ candidates: [], complete: true, digest: 'alias', provider: 'mangadex', truncated: false }))
      .mockRejectedValueOnce(new PublicDiscoveryInvocationYieldError());
    const base = request('MANGA');
    const input = { ...base, query: { ...base.query, discoveryTitles: ['Alias', 'Target'] } };
    let checkpoint;
    try { await createPublicDiscoveryResolver(ports).resolve(input); }
    catch (error) {
      if (!(error instanceof PublicDiscoverySearchContinuationError)) throw error;
      checkpoint = error.searchProgress;
    }
    expect(checkpoint).toEqual({ candidates: [], cursor: '1', provider: 'mangadex', titleIndex: 1, version: 1 });
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, searchProgress: checkpoint })).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { externalId: 'md-1' } },
    });
    expect(ports.mangadex.search.mock.calls.map(([query]) => query.titles[0])).toEqual(['Alias', 'Target', 'Target']);
  });

  it('resumes an unknown-media anime page without restarting the first page', async () => {
    const target = candidate('anilist', 'ANIME', '42', 'Target');
    const ports = providers({ anilist: target });
    const pages: string[] = [];
    ports.anilist.search.mockImplementation(async ({ cursor }) => {
      pages.push(cursor);
      return { candidates: cursor === '5' ? [target] : [], complete: cursor === '5',
        digest: cursor, nextCursor: cursor === '5' ? undefined : String(Number(cursor) + 1), provider: 'anilist', truncated: cursor !== '5' };
    });
    const input = request('UNKNOWN');
    let checkpoint;
    try { await createPublicDiscoveryResolver(ports).resolve(input); }
    catch (error) {
      if (!(error instanceof PublicDiscoverySearchContinuationError)) throw error;
      checkpoint = error.searchProgress;
    }
    expect(checkpoint).toMatchObject({ provider: 'anilist', cursor: '5' });
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, searchProgress: checkpoint })).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { provider: 'anilist', externalId: '42' } },
    });
    expect(pages).toEqual(['1', '2', '3', '4', '5']);
  });

  it('preserves an anime match while an unknown-media manga lane crosses the invocation budget', async () => {
    const anime = candidate('anilist', 'ANIME', '42', 'Target');
    const manga = candidate('mangaupdates', 'MANGA', '24', 'Target');
    const ports = providers({ anilist: anime, mangaupdates: manga });
    ports.mangaupdates.search.mockRejectedValueOnce(new PublicDiscoveryInvocationYieldError());
    const input = request('UNKNOWN');
    let checkpoint;
    try { await createPublicDiscoveryResolver(ports).resolve(input); }
    catch (error) {
      if (!(error instanceof PublicDiscoverySearchContinuationError)) throw error;
      checkpoint = error.searchProgress;
    }
    expect(checkpoint).toMatchObject({ provider: 'mangaupdates', animeLane: { state: 'MATCH', references: [{ provider: 'anilist', externalId: '42' }] } });
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, searchProgress: checkpoint })).resolves.toMatchObject({ state: 'AMBIGUOUS' });
    expect(ports.anilist.search).toHaveBeenCalledOnce();
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
    expect(ports.mangaupdates.search).toHaveBeenCalledTimes(2);
  });

  it('does not checkpoint past an unavailable anime lane for unknown media', async () => {
    const ports = providers();
    ports.anilist.search.mockRejectedValueOnce(new Error('HTTP 503'));
    ports.mangaupdates.search.mockImplementation(async ({ cursor }) => ({ candidates: [], complete: false, digest: 'partial',
      nextCursor: String(Number(cursor) + 1), provider: 'mangaupdates', truncated: true }));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toThrow('HTTP 503');
  });

  it('rejects a manga checkpoint that omits the completed anime lane', async () => {
    const ports = providers();
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...request('UNKNOWN'), searchProgress: {
      candidates: [], cursor: '1', provider: 'mangaupdates', titleIndex: 0, version: 1,
    } })).rejects.toThrow('provider-search-progress-lane-mismatch');
    expect(ports.anilist.search).not.toHaveBeenCalled();
  });

  it('does not skip a provider that failed before a later budget checkpoint', async () => {
    const ports = providers();
    ports.mangadex.search.mockRejectedValueOnce(new Error('HTTP 503'));
    ports['kitsu-manga'].search.mockRejectedValueOnce(new PublicDiscoveryInvocationYieldError());
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toThrow('HTTP 503');
  });

  it.each(['verified', 'empty', 'recovered', 'cleared', 'deferred'] as const)('resumes paginated fallback after a primary failure: %s', async (outcome) => {
    const target = candidate('kitsu-manga', 'MANGA', '42', 'Target');
    const ports = providers({ 'kitsu-manga': target });
    ports.mangadex.search.mockRejectedValue(new Error('HTTP 503'));
    const pages: string[] = [];
    ports['kitsu-manga'].search.mockImplementation(async ({ cursor }) => {
      pages.push(cursor);
      if (cursor === '5') return { candidates: outcome === 'verified' ? [target] : [], complete: true, digest: 'fallback-page', provider: 'kitsu-manga', truncated: false };
      return { candidates: [], complete: false, digest: 'fallback-page', provider: 'kitsu-manga', truncated: true, nextCursor: String(Number(cursor) + 1) };
    });
    let checkpoint;
    try { await createPublicDiscoveryResolver(ports).resolve(request('MANGA')); }
    catch (error) {
      expect(error).toBeInstanceOf(PublicDiscoverySearchContinuationError);
      if (!(error instanceof PublicDiscoverySearchContinuationError)) throw error;
      checkpoint = error.searchProgress;
    }
    expect(checkpoint).toMatchObject({ provider: 'kitsu-manga', cursor: '5', retryProviders: ['mangadex'] });
    if (outcome === 'recovered' || outcome === 'cleared') {
      const recovered = candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc', 'Target');
      ports.mangadex.search.mockResolvedValue({ candidates: outcome === 'recovered' ? [recovered] : [], complete: true, digest: 'recovered', provider: 'mangadex', truncated: false });
      ports.mangadex.hydrate.mockResolvedValue(recovered);
    }
    if (outcome === 'deferred') ports.mangadex.search.mockRejectedValue(new FavoriteProviderRetryError('cadence', Date.now() + 120_000));
    const resumed = createPublicDiscoveryResolver(ports).resolve({ ...request('MANGA'), searchProgress: checkpoint });
    if (outcome === 'empty') await expect(resumed).rejects.toThrow('HTTP 503');
    else if (outcome === 'deferred') await expect(resumed).rejects.toBeInstanceOf(FavoriteProviderRetryError);
    else await expect(resumed).resolves.toMatchObject({ state: outcome === 'cleared' ? 'NOT_FOUND' : 'VERIFIED' });
    expect(pages).toEqual(outcome === 'recovered' ? ['1', '2', '3', '4'] : ['1', '2', '3', '4', '5']);
    expect(ports.mangadex.search).toHaveBeenCalledTimes(2);
  });

  it.each([['anilist'], ['kitsu-manga'], ['mangaupdates'], ['mangadex', 'mangadex']] as const)('rejects invalid retry-provider checkpoints %j', async (...retryProviders) => {
    const ports = providers();
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...request('MANGA'), searchProgress: {
      candidates: [], cursor: '5', provider: 'kitsu-manga', retryProviders, titleIndex: 0, version: 1,
    } })).rejects.toThrow('provider-search-progress-lane-mismatch');
    expect(ports.mangadex.search).not.toHaveBeenCalled();
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

  it('does not issue later pages or fallback calls after the shared ninety-second search budget', async () => {
    vi.useFakeTimers();
    try {
      const ports = providers();
      ports.anilist.search.mockImplementation(async () => {
        await new Promise((resolve) => { setTimeout(resolve, 95_000); });
        return { candidates: [], complete: false, digest: 'late', nextCursor: '2', provider: 'anilist', truncated: true };
      });
      const outcome = expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toThrow('incomplete-provider-search:deadline');
      await vi.advanceTimersByTimeAsync(90_000);
      await outcome;
      expect(ports['kitsu-anime'].search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(ports.anilist.search).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

  it('allows four slowly paced manga titles across all three lanes before the search deadline', async () => {
    vi.useFakeTimers();
    try {
      const ports = providers();
      const pacedSearch = async (provider: 'mangadex' | 'mangaupdates' | 'kitsu-manga') => {
        await new Promise((resolve) => { setTimeout(resolve, 7_000); });
        return { candidates: [], complete: true, digest: `paced-${provider}`, provider, truncated: false };
      };
      ports.mangadex.search.mockImplementation(() => pacedSearch('mangadex'));
      ports['kitsu-manga'].search.mockImplementation(() => pacedSearch('kitsu-manga'));
      ports.mangaupdates.search.mockImplementation(() => pacedSearch('mangaupdates'));
      const outcome = expect(createPublicDiscoveryResolver(ports).resolve({ ...request('MANGA'), query: {
        discoveryTitles: ['One', 'Two', 'Three', 'Four'], mediaKind: 'MANGA', sourceTitles: ['One', 'Two', 'Three', 'Four'],
      } })).resolves.toEqual({ reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' });
      await vi.advanceTimersByTimeAsync(89_000);
      await outcome;
      expect(ports.mangadex.search).toHaveBeenCalledTimes(4);
      expect(ports['kitsu-manga'].search).toHaveBeenCalledTimes(4);
      expect(ports.mangaupdates.search).toHaveBeenCalledTimes(4);
    } finally { vi.useRealTimers(); }
  });

  it('uses AniList then Kitsu Anime without touching manga providers', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-anime' } } });
    expect(ports.anilist.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it('searches MangaDex, Kitsu Manga and MangaUpdates in order', async () => {
    const ports = providers({ mangaupdates: candidate('mangaupdates', 'MANGA', '84', 'Target') });
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'mangaupdates' } } });
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
    expect(ports.mangadex.search.mock.invocationCallOrder[0]).toBeLessThan(ports['kitsu-manga'].search.mock.invocationCallOrder[0] ?? 0);
    expect(ports['kitsu-manga'].search.mock.invocationCallOrder[0]).toBeLessThan(ports.mangaupdates.search.mock.invocationCallOrder[0] ?? 0);
  });

  it('accepts an exact MangaDex manga before MangaUpdates can exhaust the shared page budget', async () => {
    const target = candidate('mangadex', 'MANGA', 'md-manga-fast', 'Target');
    const ports = providers({ mangadex: target });
    ports.mangaupdates.search.mockImplementation(async ({ cursor }) => ({
      candidates: [], complete: false, digest: `page-${cursor}`, nextCursor: String(Number(cursor) + 1), provider: 'mangaupdates', truncated: true,
    }));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      profile: { candidate: { externalId: 'md-manga-fast', provider: 'mangadex' } }, state: 'VERIFIED',
    });
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it('accepts an exact MangaDex identity before MangaUpdates can exhaust the shared page budget', async () => {
    const target = candidate('mangadex', 'MANHWA', 'md-fast', 'Target');
    const ports = providers({ mangadex: target });
    ports.mangaupdates.search.mockImplementation(async ({ cursor }) => ({
      candidates: [], complete: false, digest: `page-${cursor}`, nextCursor: String(Number(cursor) + 1), provider: 'mangaupdates', truncated: true,
    }));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANHWA'))).resolves.toMatchObject({
      profile: { candidate: { externalId: 'md-fast', provider: 'mangadex' } }, state: 'VERIFIED',
    });
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
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

  it('recovers an unavailable exact MangaUpdates identity only through a hydrated linked MangaDex identity', async () => {
    const exact = { provider: 'mangaupdates' as const, externalId: '12345' };
    const linked = { ...candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc', 'Target'), linkedReferences: [exact] };
    const ports = providers({ mangadex: linked });
    ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    const input = request('MANGA');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, explicitProviderReference: exact },
    })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: linked, references: [
      { provider: 'mangadex', externalId: linked.externalId }, exact,
    ] } });
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports.mangadex.hydrate).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it.each(['unlinked-search', 'unlinked-hydration', 'wrong-title'] as const)(
    'keeps an unavailable exact identity technical when the fallback is %s', async (failure) => {
      const exact = { provider: 'mangaupdates' as const, externalId: '12345' };
      const linked = { ...candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc',
        failure === 'wrong-title' ? 'Different work' : 'Target'), linkedReferences: [exact] };
      const ports = providers({ mangadex: failure === 'unlinked-search' ? { ...linked, linkedReferences: [] } : linked });
      ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
      if (failure === 'unlinked-hydration') ports.mangadex.hydrate.mockResolvedValueOnce({ ...linked, linkedReferences: [] });
      const input = request('MANGA');
      await expect(createPublicDiscoveryResolver(ports).resolve({
        ...input, query: { ...input.query, explicitProviderReference: exact },
      })).rejects.toThrow('HTTP 503');
    },
  );

  it.each(['unlinked', 'linked-wrong-title'] as const)(
    'continues past an %s title match to a linked identity on the next page', async (firstPage) => {
    const exact = { provider: 'mangaupdates' as const, externalId: '12345' };
    const unrelated = { ...candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc',
      firstPage === 'unlinked' ? 'Target' : 'Different work'),
    };
    const linked = { ...candidate('mangadex', 'MANGA', '22345678-1234-4234-8234-123456789abc', 'Target'), linkedReferences: [exact] };
    const ports = providers({ mangadex: linked });
    ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    ports.mangadex.search.mockResolvedValueOnce({ candidates: [firstPage === 'unlinked' ? unrelated : { ...unrelated, linkedReferences: [exact] }], complete: false, digest: 'page-one',
      nextCursor: '2', provider: 'mangadex', truncated: true }).mockResolvedValueOnce({ candidates: [linked],
      complete: true, digest: 'page-two', provider: 'mangadex', truncated: false });
    const input = request('MANGA');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, explicitProviderReference: exact },
    })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: linked } });
    expect(ports.mangadex.search).toHaveBeenCalledTimes(2);
    expect(ports.mangadex.search.mock.calls[1]?.[0]).toMatchObject({ cursor: '2' });
    },
  );

  it('keeps an UNKNOWN explicit MangaUpdates reference in the manga lane', async () => {
    const exact = { provider: 'mangaupdates' as const, externalId: '12345' };
    const linked = { ...candidate('mangadex', 'MANGA', '12345678-1234-4234-8234-123456789abc', 'Target'), linkedReferences: [exact] };
    const ports = providers({ mangadex: linked });
    ports.mangaupdates.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    const input = request('UNKNOWN');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, explicitProviderReference: exact },
    })).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: linked } });
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports.anilist.search).not.toHaveBeenCalled();
  });

  it.each(['ANIME', 'UNKNOWN'] as const)('recovers an exact AniList identity through linked Kitsu evidence for %s', async (mediaKind) => {
    const exact = { provider: 'anilist' as const, externalId: '154587' };
    const linked = { ...candidate('kitsu-anime', 'ANIME', '46474', 'Target'), linkedReferences: [exact] };
    const ports = providers({ 'kitsu-anime': linked });
    ports.anilist.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    const input = request(mediaKind);
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, explicitProviderReference: exact } }))
      .resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: linked, references: expect.arrayContaining([exact]) } });
    expect(ports['kitsu-anime'].search).toHaveBeenCalledOnce();
    expect(ports.mangadex.search).not.toHaveBeenCalled();
  });

  it.each(['missing', 'different', 'lost-on-hydration', 'wrong-title', 'wrong-media'] as const)('rejects %s exact AniList fallback evidence', async (mode) => {
    const exact = { provider: 'anilist' as const, externalId: '154587' };
    const linked = { ...candidate('kitsu-anime', mode === 'wrong-media' ? 'MANGA' : 'ANIME', '46474', mode === 'wrong-title' ? 'Other work' : 'Target'), linkedReferences: mode === 'missing' ? [] : [{ ...exact, externalId: mode === 'different' ? '999' : exact.externalId }] };
    const ports = providers({ 'kitsu-anime': linked });
    const failure = new Error('HTTP 503');
    ports.anilist.hydrate.mockRejectedValueOnce(failure);
    if (mode === 'lost-on-hydration') ports['kitsu-anime'].hydrate.mockResolvedValueOnce({ ...linked, linkedReferences: [] });
    const input = request('ANIME');
    await expect(createPublicDiscoveryResolver(ports).resolve({ ...input, query: { ...input.query, explicitProviderReference: exact } })).rejects.toBe(failure);
  });

  it.each(['mangaupdates', 'anilist'] as const)('does not launch fallback searches for an exact %s cadence deferral', async (provider) => {
    const exact = { provider, externalId: '12345' };
    const ports = providers();
    const deferred = new FavoriteProviderRetryError('cadence', Date.now() + 60_000);
    ports[provider].hydrate.mockRejectedValueOnce(deferred);
    const input = request(provider === 'anilist' ? 'ANIME' : 'MANGA');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, explicitProviderReference: exact },
    })).rejects.toBe(deferred);
    expect(ports.mangadex.search).not.toHaveBeenCalled();
    expect(ports['kitsu-anime'].search).not.toHaveBeenCalled();
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

  it('falls back from MangaDex to Kitsu Manga after a transient failure', async () => {
    const ports = providers({ 'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target') });
    ports.mangadex.search.mockRejectedValueOnce(new Error('HTTP 429'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({ state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-manga' } } });
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
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
    expect(ports.mangadex.search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('falls back to Kitsu when a matched MangaDex identity cannot be hydrated transiently', async () => {
    const ports = providers({
      mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target'),
      'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target'),
    });
    ports.mangadex.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      profile: { candidate: { provider: 'kitsu-manga', externalId: '84' } }, state: 'VERIFIED',
    });
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
    expect(ports['kitsu-manga'].hydrate).toHaveBeenCalledOnce();
  });

  it('hydrates a linked MangaUpdates identity after MangaDex hydration fails', async () => {
    const linked = { externalId: '12345', provider: 'mangaupdates' as const };
    const mangadex = { ...candidate('mangadex', 'MANGA', 'md-1', 'Target'), linkedReferences: [linked] };
    const ports = providers({ mangadex, mangaupdates: candidate('mangaupdates', 'MANGA', '12345', 'Target') });
    ports.mangadex.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { provider: 'mangaupdates', externalId: '12345' } },
    });
    expect(ports.mangaupdates.hydrate).toHaveBeenCalledExactlyOnceWith(linked);
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
  });

  it('does not publish an unrelated linked MangaUpdates identity', async () => {
    const linked = { externalId: '12345', provider: 'mangaupdates' as const };
    const mangadex = { ...candidate('mangadex', 'MANGA', 'md-1', 'Target'), linkedReferences: [linked] };
    const ports = providers({ mangadex });
    ports.mangadex.hydrate.mockRejectedValueOnce(new Error('HTTP 503'));
    ports.mangaupdates.hydrate.mockResolvedValueOnce(candidate('mangaupdates', 'MANGA', '12345', 'Different Work'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toThrow('HTTP 503');
    expect(ports.mangaupdates.hydrate).toHaveBeenCalledExactlyOnceWith(linked);
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
  });

  it('falls back from MangaDex to Kitsu after a method failure', async () => {
    const ports = providers({ 'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target') });
    ports.mangadex.search.mockRejectedValueOnce(new Error('HTTP 401'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { provider: 'kitsu-manga', externalId: '84' } },
    });
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
  });

  it('preserves the last spent error when every manga search provider is unavailable', async () => {
    const ports = providers();
    const failure = new Error('TimeoutError');
    ports.mangadex.search.mockRejectedValueOnce(new Error('HTTP 429'));
    ports['kitsu-manga'].search.mockRejectedValueOnce(new Error('HTTP 503'));
    ports.mangaupdates.search.mockRejectedValueOnce(failure);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toBe(failure);
  });

  it.each(['cadence', 'HTTP 429'])('retains a spent search failure before a later %s deferral', async (reason) => {
    const ports = providers();
    const failure = new Error('HTTP 503');
    const deferred = new FavoriteProviderRetryError(reason, Date.now() + 120_000);
    ports.mangaupdates.search.mockRejectedValueOnce(failure);
    ports.mangadex.search.mockRejectedValueOnce(deferred);
    ports['kitsu-manga'].search.mockRejectedValueOnce(deferred);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toBe(failure);
  });

  it.each(['ANIME', 'MANGA'] as const)('retains a spent %s failure across UNKNOWN lanes', async (failedLane) => {
    const ports = providers();
    const failure = new Error('HTTP 503');
    const deferred = new FavoriteProviderRetryError('cadence', Date.now() + 120_000);
    for (const provider of ['anilist', 'kitsu-anime'] as const) ports[provider].search.mockRejectedValue(failedLane === 'ANIME' ? failure : deferred);
    for (const provider of ['mangaupdates', 'mangadex', 'kitsu-manga'] as const) ports[provider].search.mockRejectedValue(failedLane === 'MANGA' ? failure : deferred);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toBe(failure);
  });

  it('retains the latest deadline when every search provider defers', async () => {
    const ports = providers();
    const latest = new FavoriteProviderRetryError('HTTP 429', Date.now() + 240_000);
    ports.anilist.search.mockRejectedValueOnce(latest);
    ports['kitsu-anime'].search.mockRejectedValueOnce(new FavoriteProviderRetryError('cadence', Date.now() + 120_000));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('ANIME'))).rejects.toBe(latest);
  });

  it.each(['cadence', 'HTTP 429'])('retains a spent hydration failure before a later %s deferral', async (reason) => {
    const ports = providers({ mangaupdates: candidate('mangaupdates', 'MANGA', '12345', 'Target') });
    const failure = new Error('HTTP 503');
    const deferred = new FavoriteProviderRetryError(reason, Date.now() + 120_000);
    ports.mangaupdates.hydrate.mockRejectedValueOnce(failure);
    ports.mangadex.search.mockRejectedValueOnce(deferred);
    ports['kitsu-manga'].search.mockRejectedValueOnce(deferred);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toBe(failure);
  });

  it('retains a spent fallback hydration failure after an earlier deferral', async () => {
    const ports = providers({
      mangaupdates: candidate('mangaupdates', 'MANGA', '12345', 'Target'),
      mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target'),
    });
    const failure = new Error('HTTP 503');
    const deferred = new FavoriteProviderRetryError('cadence', Date.now() + 120_000);
    ports.mangaupdates.hydrate.mockRejectedValueOnce(deferred);
    ports.mangadex.hydrate.mockRejectedValueOnce(failure);
    ports['kitsu-manga'].search.mockRejectedValueOnce(deferred);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toBe(failure);
  });

  it.each([
    ['ANIME', 'cadence'], ['ANIME', 'HTTP 429'],
    ['MANGA', 'cadence'], ['MANGA', 'HTTP 429'],
    ['UNKNOWN', 'cadence'], ['UNKNOWN', 'HTTP 429'],
  ] as const)('retains a spent %s search failure when fallback hydration ends in %s', async (mediaKind, reason) => {
    const manga = mediaKind === 'MANGA';
    const fallback = manga ? 'mangadex' : 'kitsu-anime';
    const ports = providers({ [fallback]: candidate(fallback, manga ? 'MANGA' : 'ANIME', '42', 'Target') });
    const failure = new Error('HTTP 503');
    const deferred = new FavoriteProviderRetryError(reason, Date.now() + 120_000);
    ports[manga ? 'mangaupdates' : 'anilist'].search.mockRejectedValueOnce(failure);
    ports[fallback].hydrate.mockRejectedValueOnce(deferred);
    if (manga) ports['kitsu-manga'].search.mockRejectedValueOnce(deferred);
    await expect(createPublicDiscoveryResolver(ports).resolve(request(mediaKind))).rejects.toBe(failure);
    expect(ports[fallback].hydrate).toHaveBeenCalledOnce();
  });

  it('retains a spent UNKNOWN search failure before another media lane defers', async () => {
    const ports = providers({ 'kitsu-anime': candidate('kitsu-anime', 'ANIME', '42', 'Target') });
    const failure = new Error('HTTP 503');
    ports.anilist.search.mockRejectedValueOnce(failure);
    for (const provider of ['mangaupdates', 'mangadex', 'kitsu-manga'] as const) {
      ports[provider].search.mockRejectedValueOnce(new FavoriteProviderRetryError('cadence', Date.now() + 120_000));
    }
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toBe(failure);
    expect(ports['kitsu-anime'].hydrate).not.toHaveBeenCalled();
  });

  it.each(['search', 'hydrate'] as const)('does not publish NOT_FOUND after a %s failure and a missing fallback identity', async (phase) => {
    const ports = providers({
      mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target'),
      'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target'),
    });
    ports.mangadex[phase].mockRejectedValueOnce(new Error('HTTP 503'));
    ports['kitsu-manga'].hydrate.mockResolvedValueOnce(undefined);
    const gateway = {
      claim: async () => ({ claimToken: 'x'.repeat(64), requests: [request('MANGA')], schemaVersion: 3 as const }),
      defer: vi.fn(async () => undefined),
      publish: vi.fn(async () => ({ published: 1, replayed: 0 })),
    };
    const report = await runPublicDiscoveryBatch({
      gateway, limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-26T10:00:00.000Z',
      resolver: createPublicDiscoveryResolver(ports),
    });
    expect(report).toEqual({ claimed: 1, deferred: 0, failed: 1, published: 0, replayed: 0 });
    expect(gateway.publish).not.toHaveBeenCalled();
    expect(gateway.defer).not.toHaveBeenCalled();
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
  });

  it.each(['search', 'hydrate'] as const)('preserves the latest %s Retry-After through a missing fallback identity', async (phase) => {
    const ports = providers({
      mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target'),
      'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target'),
    });
    const latest = new FavoriteProviderRetryError('HTTP 429', Date.now() + 240_000);
    ports.mangadex[phase].mockRejectedValueOnce(latest);
    ports['kitsu-manga'].hydrate.mockResolvedValueOnce(undefined);
    ports.mangaupdates.search.mockRejectedValueOnce(new FavoriteProviderRetryError('cadence', Date.now() + 120_000));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).rejects.toBe(latest);
    expect(ports['kitsu-manga'].search).toHaveBeenCalledOnce();
    expect(ports.mangaupdates.search).toHaveBeenCalledOnce();
  });

  it.each(['search', 'hydrate'] as const)('continues to a VERIFIED fallback after a %s failure and missing identity', async (phase) => {
    const ports = providers({
      mangaupdates: candidate('mangaupdates', 'MANGA', '12345', 'Target'),
      mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target'),
      'kitsu-manga': candidate('kitsu-manga', 'MANGA', '84', 'Target'),
    });
    ports.mangadex[phase].mockRejectedValueOnce(new Error('HTTP 503'));
    ports['kitsu-manga'].hydrate.mockResolvedValueOnce(undefined);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toMatchObject({
      state: 'VERIFIED', profile: { candidate: { provider: 'mangaupdates', externalId: '12345' } },
    });
  });

  it('keeps an explicit missing identity NOT_FOUND without a prior provider failure', async () => {
    const ports = providers();
    const input = request('MANGA');
    await expect(createPublicDiscoveryResolver(ports).resolve({
      ...input, query: { ...input.query, explicitProviderReference: { provider: 'mangadex', externalId: 'md-1' } },
    })).resolves.toEqual({ state: 'NOT_FOUND', reason: 'exact-provider-identity-not-found' });
    expect(ports.mangaupdates.search).not.toHaveBeenCalled();
    expect(ports.mangadex.search).not.toHaveBeenCalled();
  });

  it('keeps a matched missing identity NOT_FOUND without a prior provider failure', async () => {
    const ports = providers({ mangadex: candidate('mangadex', 'MANGA', 'md-1', 'Target') });
    ports.mangadex.hydrate.mockResolvedValueOnce(undefined);
    await expect(createPublicDiscoveryResolver(ports).resolve(request('MANGA'))).resolves.toEqual({
      state: 'NOT_FOUND', reason: 'matched-provider-identity-not-found',
    });
    expect(ports['kitsu-manga'].search).not.toHaveBeenCalled();
  });

  it('does not publish one UNKNOWN lane while the other lane is unavailable', async () => {
    const ports = providers({ anilist: candidate('anilist', 'ANIME', '1', 'Target') });
    ports.mangaupdates.search.mockRejectedValueOnce(new Error('HTTP 429'));
    await expect(createPublicDiscoveryResolver(ports).resolve(request('UNKNOWN'))).rejects.toThrow('HTTP 429');
    expect(ports.anilist.hydrate).not.toHaveBeenCalled();
  });
});
