import { describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryResolver, publicDiscoveryCandidateSchema } from '@tobirink/public-discovery';
import { createLibrary, createProviderCandidateEnvelope, createSourceEvidence, createWork, libraryId, workId } from '@tobirink/domain';
import type { DurableTask, FavoriteResolutionClaim, FavoriteResolutionOutboxPort } from '../tasks';
import { blockTask, claimTask, isTaskAvailable, retryTask } from '../tasks';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';
import { reconcileFavoriteSourcePresence } from '../use-cases/reconcile-favorite-source-presence';
import { repairMissingFavoriteCovers, runFavoriteResolutionSlice } from './favorite-resolution-runner';
import { favoriteCandidateWorkId, persistFavoriteResolutionCompletion } from './favorite-resolution-commit';
import { FavoriteProviderRetryError } from './provider-ports';
import { PublicDiscoveryError } from '../public-discovery';
import type { FavoriteProviderSearchQuery } from './provider-ports';
import type { FavoriteIdentityKey } from './favorite-identity-lookup';
import { bundledFavoriteSiteRules, createFavoriteSiteAdapters } from './site-rules';

const now = '2026-09-07T12:00:00.000Z';
const favorite = { bookmarkId: 'runner', folderPath: ['Anime'], order: 0, state: 'eligible' as const, title: 'Frieren', url: 'https://reader.example/anime/frieren' };
const candidate = { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };
const unusedSearch = { search: async () => { throw new Error('not routed'); } };
const unusedHydration = { hydrate: async () => undefined };
function candidatePorts(anilist: { search: () => Promise<ReturnType<typeof createProviderCandidateEnvelope>> }, kitsuAnime = unusedSearch) {
  return { anilist, 'kitsu-anime': kitsuAnime, 'kitsu-manga': unusedSearch, mangadex: unusedSearch, mangaupdates: unusedSearch } as const;
}
function hydrationPorts(anilist: { hydrate: () => Promise<typeof candidate | undefined> }, kitsuAnime = unusedHydration) {
  return { anilist, 'kitsu-anime': kitsuAnime, 'kitsu-manga': unusedHydration, mangadex: unusedHydration, mangaupdates: unusedHydration } as const;
}

class MemoryOutbox implements FavoriteResolutionOutboxPort {
  constructor(private readonly storage: MemoryStoragePort, private readonly id: string) {}
  async claimNext(input: FavoriteResolutionClaim) {
    const task = await this.storage.getFavoriteResolutionTask(this.id);
    if (task === undefined || task.state === 'COMMITTED' || task.state === 'BLOCKED' || !isTaskAvailable(task, input.claimedAt)) return undefined;
    const claimed = claimTask(task, input.claimToken, input.claimedAt, input.claimExpiresAt);
    await this.storage.putFavoriteResolutionTask(claimed);
    return claimed;
  }
  async change(id: string, transition: (task: DurableTask) => DurableTask) {
    const task = await this.storage.getFavoriteResolutionTask(id);
    if (task === undefined) throw new Error('Missing task.');
    const next = transition(task); await this.storage.putFavoriteResolutionTask(next); return next;
  }
  block(id: string, token: string, reason: string) { return this.change(id, (task) => blockTask(task, token, reason)); }
  async nextAvailableAt() {
    const task = await this.storage.getFavoriteResolutionTask(this.id);
    return task === undefined || task.state === 'COMMITTED' || task.state === 'BLOCKED' ? undefined : task.availableAt;
  }
  retry(id: string, token: string, retryAt: string) { return this.change(id, (task) => retryTask(task, token, retryAt)); }
}

async function fixture(input = favorite, adapters: Parameters<typeof importFavoriteSources>[3] = []) {
  const storage = new MemoryStoragePort();
  await importFavoriteSources([input], storage, now, adapters);
  const task = (await storage.getFavoriteResolutionTask('favorite-resolution_c_72756e6e6572'));
  if (task === undefined) throw new Error('Expected resolution task.');
  return { outbox: new MemoryOutbox(storage, task.id), storage, task };
}

describe('runFavoriteResolutionSlice', () => {
  it.each((['MANGA', 'ANIME'] as const).flatMap(mediaKind => (['linked', 'direct', 'missing-link', 'wrong-link', 'missing-reference', 'wrong-direct', 'wrong-provider'] as const).map(mode => ({ mediaKind, mode }))))('projects resolver identity evidence into Library: $mediaKind $mode', async ({ mediaKind, mode }) => {
    const exact = { provider: mediaKind === 'ANIME' ? 'anilist' as const : 'mangaupdates' as const, externalId: '12345' };
    const manga = { ...exact, mediaKind, preSerialization: false, titles: ['Target'] };
    const linked = { ...manga, provider: mediaKind === 'ANIME' ? 'kitsu-anime' as const : 'mangadex' as const, externalId: mediaKind === 'ANIME' ? '46474' : '12345678-1234-4234-8234-123456789abc', linkedReferences: [exact] };
    const origin = mediaKind === 'ANIME' ? 'https://anilist.co' : 'https://www.mangaupdates.com';
    const { storage, outbox } = await fixture({ ...favorite, folderPath: [mediaKind], title: 'Target', url: `${origin}/series/12345` }, [{
      id: 'test-linked', origins: [origin],
      analyze: (input, url) => createSourceEvidence({ aliases: [], diagnostics: [], explicitProviderReference: exact, key: input.sourceKey, mediaKind, origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH'], sourceAdapter: 'test-linked', strategy: 'exact-origin', title: input.title }),
    }]);
    const serverHydrate = vi.fn(async () => { if (mode === 'direct') return manga; throw new Error('HTTP 503'); });
    const resolver = createPublicDiscoveryResolver({
      anilist: { ...unusedSearch, ...unusedHydration }, 'kitsu-anime': { ...unusedSearch, ...unusedHydration }, 'kitsu-manga': { ...unusedSearch, ...unusedHydration },
      mangaupdates: { ...unusedSearch, ...unusedHydration }, mangadex: { ...unusedSearch, ...unusedHydration },
      [exact.provider]: { ...unusedSearch, hydrate: serverHydrate },
      [linked.provider]: { hydrate: async () => linked, search: async () => ({ candidates: [linked], complete: true, digest: 'linked-fixture', provider: linked.provider, truncated: false }) },
    });
    const browserSearch = vi.fn(unusedSearch.search);
    const browserHydrate = vi.fn(unusedHydration.hydrate);
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts({ search: browserSearch }), hydration: hydrationPorts({ hydrate: browserHydrate }),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'linked-public',
      publicDiscovery: { resolveOrRequest: async (key, query) => {
        const resolved = await resolver.resolve({ attempt: 1, key, query, requestDigest: 'b'.repeat(64), schemaVersion: 3 });
        if (resolved.state !== 'VERIFIED') throw new Error('Expected verified resolver result');
        const profile = resolved.profile;
        if (mode === 'wrong-direct') return { ...resolved, verifiedAt: now, profile: { ...profile, candidate: { ...manga, externalId: '54321' } } };
        if (mode === 'wrong-provider') return { ...resolved, verifiedAt: now, profile: { ...profile, candidate: { ...linked, provider: 'kitsu-manga', externalId: '42' } } };
        if (mode === 'missing-link') return { ...resolved, verifiedAt: now, profile: { ...profile, candidate: { ...profile.candidate, linkedReferences: [] } } };
        if (mode === 'wrong-link') return { ...resolved, verifiedAt: now, profile: { ...profile, candidate: { ...profile.candidate, linkedReferences: [{ ...exact, externalId: '54321' }] } } };
        if (mode === 'missing-reference') return { ...resolved, verifiedAt: now, profile: { ...profile, references: [{ provider: linked.provider, externalId: linked.externalId }] } };
        return { ...resolved, verifiedAt: now };
      } },
    });
    const accepted = mode === 'direct' || mode === 'linked';
    expect(result).toMatchObject({ completed: accepted ? 1 : 0, retried: accepted ? 0 : 1 });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual(accepted ? { kind: 'RESOLVED' } : { kind: 'RETRYABLE', reason: 'INTERNAL_FAILURE' });
    expect(source?.reviewId).toBeUndefined();
    expect(await storage.listWorks({ limit: 10 })).toHaveLength(accepted ? 1 : 0);
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds ?? []).toEqual(accepted ? [source?.matchedWorkId] : []);
    expect(serverHydrate).toHaveBeenCalledOnce();
    expect(browserSearch).not.toHaveBeenCalled();
    expect(browserHydrate).not.toHaveBeenCalled();
  });

  it('commits all 32 public provider metadata values without provider access or recovery admission', async () => {
    const { storage, outbox, task } = await fixture({ ...favorite, folderPath: ['Manga'], title: 'Synthetic manga', url: 'https://reader.example/manga/synthetic-manga' });
    const titles = ['Synthetic manga', ...Array.from({ length: 31 }, (_, index) => `Alias ${index}`)];
    const discovered = publicDiscoveryCandidateSchema.parse({
      externalId: '12345', provider: 'mangaupdates', mediaKind: 'MANGA', preSerialization: false,
      titles, titleVariants: titles.map((title) => ({ title })),
      categories: Array.from({ length: 32 }, (_, index) => `Category ${index}`),
      genres: Array.from({ length: 32 }, (_, index) => `Genre ${index}`),
    });
    const search = vi.fn(unusedSearch.search);
    const hydrate = vi.fn(unusedHydration.hydrate);
    const resolveOrRequest = vi.fn(async () => ({ state: 'VERIFIED' as const, verifiedAt: now, profile: {
      candidate: discovered, references: [{ provider: discovered.provider, externalId: discovered.externalId }], workId: 'work_public_metadata',
    } }));
    const requestRecovery = vi.fn(async () => { throw new Error('Recovery must not be admitted.'); });
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts({ search }), hydration: hydrationPorts({ hydrate }),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'public-metadata', publicDiscovery: { resolveOrRequest, requestRecovery },
    });
    expect(result).toMatchObject({ completed: 1, retried: 0, blocked: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'COMMITTED', attempt: 1 });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RESOLVED' });
    const work = await storage.getWork(workId('work_public_metadata'));
    expect(work?.hydration?.candidate).toEqual(discovered);
    expect(work?.hydration?.providerTitleKeys).toHaveLength(32);
    expect(resolveOrRequest).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect(requestRecovery).not.toHaveBeenCalled();
  });

  it.each(['categories', 'genres'] as const)('preserves blocked taxonomy beyond the sixteenth public %s', async (field) => {
    const { storage, outbox } = await fixture();
    const discovered = publicDiscoveryCandidateSchema.parse({ ...candidate, [field]: [...Array.from({ length: 31 }, (_, index) => `Label ${index}`), 'Hentai'] });
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'taxonomy-tail',
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'VERIFIED', verifiedAt: now, profile: {
        candidate: discovered, references: [{ provider: discovered.provider, externalId: discovered.externalId }], workId: 'work_blocked_tail',
      } }) },
    });
    expect(result).toMatchObject({ completed: 1, retried: 0, blocked: 0 });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' });
    expect(await storage.listWorks({ limit: 10 })).toEqual([]);
  });

  it.each([
    { extra: { categories: Array.from({ length: 33 }, (_, index) => `Category ${index}`) }, code: 'DISCOVERY_CANDIDATE_SCHEMA_INVALID' },
    { extra: { cover: { attribution: 'AniList', url: 'https://untrusted.invalid/private-cover.jpg' } }, code: 'DISCOVERY_CANDIDATE_DOMAIN_INVALID' },
  ])('records a bounded provider-result diagnostic for $code', async ({ extra, code }) => {
    const { storage, outbox } = await fixture();
    const trace: unknown[] = [];
    await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'invalid-metadata', trace: (event) => { trace.push(event); },
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'VERIFIED', verifiedAt: now, profile: {
        candidate: { ...candidate, ...extra }, references: [{ provider: candidate.provider, externalId: candidate.externalId }], workId: 'work_invalid_metadata',
      } }) },
    });
    expect(trace).toContainEqual({ operation: 'provider-result', outcome: 'failed', code });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'INTERNAL_FAILURE' });
    expect(await storage.listWorks({ limit: 10 })).toEqual([]);
    expect(JSON.stringify(trace)).not.toMatch(/Frieren|untrusted|private-cover|Category/iu);
  });

  it('never exposes an unknown uppercase private error message in diagnostics', async () => {
    const { storage, outbox } = await fixture();
    vi.spyOn(storage, 'getFavoriteParseArtifact').mockRejectedValueOnce(new Error('PRIVATE_BOOKMARK_TITLE'));
    const trace: unknown[] = [];
    await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'private-error', trace: (event) => { trace.push(event); },
    });
    expect(trace).toContainEqual({ operation: 'resolution-commit', outcome: 'failed', code: 'INTERNAL_FAILURE' });
    expect(JSON.stringify(trace)).not.toContain('PRIVATE_BOOKMARK_TITLE');
  });

  it('commits remote ambiguity as comparable references without inventing provider profiles', async () => {
    const { storage, outbox, task } = await fixture();
    const references = [{ provider: 'anilist' as const, externalId: '154587' }, { provider: 'anilist' as const, externalId: '154588' }];
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'remote-ambiguity',
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'AMBIGUOUS', candidates: [...references, references[0]!], reason: 'EXACT_TITLE_COLLISION', verifiedAt: now }) },
    });
    expect(result).toMatchObject({ completed: 1, retried: 0, blocked: 0 });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' });
    expect(source?.reviewId && await storage.getFavoriteReviewCandidateSet(source.reviewId)).toMatchObject({ candidates: [], references, totalCandidates: 2, provenance: 'public-discovery' });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'COMMITTED' });
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('rejects a duplicate remote reference instead of inventing an ambiguity', async () => {
    const { storage, outbox } = await fixture();
    const reference = { provider: 'anilist' as const, externalId: '154587' };
    await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'duplicate-ambiguity',
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'AMBIGUOUS', candidates: [reference, reference], reason: 'EXACT_TITLE_COLLISION', verifiedAt: now }) },
    });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'INTERNAL_FAILURE' });
  });

  it('commits a verified result even when every observational trace fails', async () => {
    const { storage, outbox, task } = await fixture();
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'trace-failure',
      trace: async () => { throw new Error('DIAGNOSTIC_STORAGE_UNAVAILABLE'); },
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'VERIFIED', verifiedAt: now, profile: { candidate, references: [{ provider: candidate.provider, externalId: candidate.externalId }], workId: 'work_verified_trace' } }) },
    });
    expect(result).toMatchObject({ completed: 1, retried: 0, blocked: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'COMMITTED' });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RESOLVED' });
  });
  it('reuses a canonical public work for an exact provider URL without a slug', async () => {
    const { storage, outbox } = await fixture({ ...favorite, url: 'https://anilist.co/anime/154587', title: 'Local bookmark' }, [{
      id: 'exact-test', origins: ['https://anilist.co'], analyze: (source, url) => createSourceEvidence({
        aliases: [], diagnostics: [], key: source.sourceKey, mediaKind: 'ANIME', origin: url.origin, path: url.pathname,
        proofs: ['CATEGORY_PATH'], sourceAdapter: 'exact-test', strategy: 'exact-origin', explicitProviderReference: { provider: 'anilist', externalId: '154587' },
      }),
    }]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('anilist:154587'));
    const id = workId(`work_${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 48)}`);
    await storage.putWork(createWork({ id, externalReferences: [{ provider: 'anilist', externalId: '154587' }], preferredTitle: 'Frieren', mediaKind: 'anime', hydration: {
      candidate, hydratedAt: now, matcherVersion: 'favorite-matcher-v4', favoriteAliasKeys: [], providerTitleKeys: ['frieren'],
    } }));
    const resolveOrRequest = vi.fn(async () => { throw new Error('No network'); });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source && (await storage.getFavoriteParseArtifact(source.id))?.artifact.sourceEvidence.explicitProviderReference).toEqual({ provider: 'anilist', externalId: '154587' });
    const getWork = vi.spyOn(storage, 'getWork');
    const result = await runFavoriteResolutionSlice({ storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration), libraryId: libraryId('library_primary'), now: () => now, token: () => 'exact', publicDiscovery: { resolveOrRequest } });
    expect(getWork).toHaveBeenCalledWith(id);
    expect(result).toMatchObject({ completed: 1, retried: 0 });
    expect(resolveOrRequest).not.toHaveBeenCalled();
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.matchedWorkId).toBe(id);
  });
  it.each(['RATE_LIMITED', 'ADMISSION_WAIT', 'TIMEOUT', 'NETWORK'] as const)('preserves attempts during %s', async (code) => {
    const { storage, outbox, task } = await fixture();
    await storage.putFavoriteResolutionTask({ ...task, attempt: 7 });
    await runFavoriteResolutionSlice({ storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration), libraryId: libraryId('library_primary'), now: () => now, token: () => 'wait', publicDiscovery: {
      resolveOrRequest: async () => { throw new PublicDiscoveryError(code, undefined, '2026-09-07T12:05:00.000Z'); },
    } });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ attempt: 7, state: 'RETRY_AT', availableAt: '2026-09-07T12:05:00.000Z' });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: code });
  });
  it('emits only bounded admission and commit trace events', async () => {
    const { storage, outbox } = await fixture();
    const trace: unknown[] = [];
    const result = await runFavoriteResolutionSlice({
      storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, token: () => 'trace',
      publicDiscovery: { resolveOrRequest: async () => ({ state: 'PENDING' as const, retryAt: '2026-09-07T12:05:00.000Z' }) },
      trace: async (event) => { trace.push(event); },
    });
    expect(result).toMatchObject({ completed: 0, retried: 1 });
    expect(trace).toEqual([
      { operation: 'admission', outcome: 'started' },
      { operation: 'admission', outcome: 'pending', code: 'PENDING', durationMs: expect.any(Number) },
    ]);
    expect(JSON.stringify(trace)).not.toMatch(/Frieren|reader\.example|runner/iu);
  });
  it('resolves a stale verified local identity while D1 and providers are unavailable', async () => {
    const { storage, outbox } = await fixture();
    const id = favoriteCandidateWorkId(candidate);
    await storage.putWork(createWork({ id, externalReferences: [{ provider: candidate.provider, externalId: candidate.externalId }], preferredTitle: 'Frieren', mediaKind: 'anime', hydration: {
      candidate, hydratedAt: '2020-01-01T00:00:00.000Z', matcherVersion: 'favorite-matcher-v4', favoriteAliasKeys: [], providerTitleKeys: ['frieren'],
    } }));
    const resolveOrRequest = vi.fn(async () => { throw new Error('D1 unavailable'); });
    const hydrate = vi.fn(async () => { throw new Error('MV3 provider forbidden'); });
    const result = await runFavoriteResolutionSlice({ storage, outbox, candidates: candidatePorts(unusedSearch), hydration: hydrationPorts({ hydrate }), libraryId: libraryId('library_primary'), now: () => now, token: () => 'local', publicDiscovery: { resolveOrRequest } });
    expect(result.completed).toBe(1);
    expect(resolveOrRequest).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]).toMatchObject({ matchedWorkId: id, resolution: { kind: 'RESOLVED' } });
  });
  it('requeues blocked automatic errors only once per recovery version', async () => {
    const { storage, task } = await fixture();
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (!source) throw new Error('Missing source');
    await storage.putFavoriteSource({ ...source, resolution: { kind: 'RETRYABLE', reason: 'AUTOMATIC_ATTEMPT_LIMIT' } });
    const blocked = blockTask(claimTask(task, 'old', now, '2026-09-07T12:01:00.000Z'), 'old', 'AUTOMATIC_ATTEMPT_LIMIT');
    await storage.putFavoriteResolutionTask(blocked);
    await importFavoriteSources([favorite], storage, now);
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'READY', attempt: 0 });
    await storage.putFavoriteResolutionTask(blocked);
    await importFavoriteSources([favorite], storage, now);
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'BLOCKED' });
    expect(await storage.getFavoriteResolutionReceipt(`${source.id}:queue-recovery-v3`)).toBeDefined();
  });
  it('sends a structurally cleaned Manhwaz identity to MangaUpdates', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{
      ...favorite, bookmarkId: 'manhwaz-routing', folderPath: ['Manga'], title: 'kage no jitsuryokusha ni naritakute 006',
      url: 'https://manhwaz.com/webtoon/kage-no-jitsuryokusha-ni-naritakute-006/chapter-66.1',
    }], storage, now, createFavoriteSiteAdapters(bundledFavoriteSiteRules));
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    const task = source === undefined ? undefined : await storage.getFavoriteResolutionTask(source.id.replace(/^source_/u, 'favorite-resolution_'));
    if (task === undefined) throw new Error('Expected Manhwaz resolution task.');
    const manga = { externalId: '12345', mediaKind: 'MANHWA' as const, preSerialization: false, provider: 'mangaupdates' as const, titles: ['kage no jitsuryokusha ni naritakute'] };
    const queries: FavoriteProviderSearchQuery[] = [];
    const result = await runFavoriteResolutionSlice({
      candidates: { ...candidatePorts(unusedSearch), mangaupdates: { search: async (query) => {
        queries.push(query);
        return createProviderCandidateEnvelope({ candidates: [manga], complete: true, digest: 'clean-title', provider: 'mangaupdates', truncated: false });
      } } },
      hydration: { ...hydrationPorts(unusedHydration), mangaupdates: { hydrate: async () => manga } },
      libraryId: libraryId('library_primary'), now: () => now, outbox: new MemoryOutbox(storage, task.id), storage, token: () => 'clean-title',
    });
    expect(queries[0]?.titles).toEqual(['kage no jitsuryokusha ni naritakute']);
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'COMMITTED' });
    expect(result).toMatchObject({ completed: 1, retried: 0 });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]).toMatchObject({ resolution: { kind: 'RESOLVED' } });
  });

  it('sends the cleaned request to D1 and never searches providers in the extension', async () => {
    const { storage, outbox } = await fixture();
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    const artifactRecord = source && await storage.getFavoriteParseArtifact(source.id);
    if (!artifactRecord) throw new Error('Expected favorite parse artifact.');
    await storage.putFavoriteParseArtifact({ ...artifactRecord, artifact: {
      ...artifactRecord.artifact,
      aliases: ['FRIEREN', 'Fern', 'Sousou no Frieren', 'Frieren Beyond Journey', 'Journey End', 'Elf Mage']
        .map((value) => ({ provenance: 'stable-url-slug' as const, value })),
    } });
    const search = vi.fn(async () => createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'leased-search', provider: 'anilist', truncated: false }));
    const hydrate = vi.fn(async () => candidate);
    const resolveOrRequest = vi.fn(async () => ({ retryAt: '2026-09-07T12:15:00.000Z', state: 'PENDING' as const }));
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search }), hydration: hydrationPorts({ hydrate }),
      libraryId: libraryId('library_primary'), now: () => now, outbox,
      publicDiscovery: { resolveOrRequest },
      storage, token: () => 'public-cache',
    });
    expect(result).toMatchObject({ completed: 0, retried: 1 });
    expect(search).not.toHaveBeenCalled(); expect(hydrate).not.toHaveBeenCalled();
    expect(resolveOrRequest).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) }), expect.objectContaining({
      discoveryTitles: ['frieren', 'Fern', 'Sousou no Frieren', 'sousounofrieren'],
      sourceTitles: ['frieren', 'Fern', 'Sousou no Frieren', 'Frieren Beyond Journey'],
    }));
  });

  it('Q-08 waits for a pending public discovery without searching or exhausting attempts', async () => {
    const { storage, outbox, task } = await fixture();
    await storage.putFavoriteResolutionTask({ ...task, attempt: 7 });
    const search = vi.fn(async () => { throw new Error('provider search must not run'); });
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search }), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, outbox,
      publicDiscovery: {
        resolveOrRequest: async () => ({ retryAt: '2026-09-07T12:05:00.000Z', state: 'PENDING' }),
      },
      storage, token: () => 'public-pending',
    });
    expect(result).toMatchObject({ blocked: 0, completed: 0, retried: 1 });
    expect(search).not.toHaveBeenCalled();
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ attempt: 7, availableAt: '2026-09-07T12:05:00.000Z', state: 'RETRY_AT' });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PUBLIC_DISCOVERY_PENDING' });
  });

  it('keeps an unavailable public discovery retryable without searching providers', async () => {
    const { storage, outbox, task } = await fixture();
    await storage.putFavoriteResolutionTask({ ...task, attempt: 7 });
    const search = vi.fn(async () => { throw new Error('provider search must not run'); });
    const requestRecovery = vi.fn(async () => { throw new Error('automatic rearm must not run'); });
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search }), hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, outbox,
      publicDiscovery: { requestRecovery, resolveOrRequest: async () => ({ reason: 'ATTEMPT_LIMIT', state: 'UNAVAILABLE' }) },
      storage, token: () => 'public-unavailable',
    });
    expect(result).toMatchObject({ blocked: 0, completed: 0, retried: 1 });
    expect(search).not.toHaveBeenCalled();
    expect(requestRecovery).not.toHaveBeenCalled();
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT', attempt: 7, availableAt: '2026-09-07T12:15:00.000Z' });
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
  });

  it('uses a verified D1 identity without repeating title search', async () => {
    const { storage, outbox } = await fixture();
    const search = vi.fn(async () => { throw new Error('provider search must not run'); });
    const hydrate = vi.fn(async () => candidate);
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search }), hydration: hydrationPorts({ hydrate }),
      libraryId: libraryId('library_primary'), now: () => now, outbox,
      publicDiscovery: {
        resolveOrRequest: async () => ({ profile: {
          candidate,
          references: [{ externalId: candidate.externalId, provider: 'anilist' }], workId: 'work_anilist_154587',
        }, state: 'VERIFIED', verifiedAt: now }),
      },
      storage, token: () => 'public-verified',
    });
    expect(result).toMatchObject({ completed: 1, retried: 0 });
    expect(search).not.toHaveBeenCalled();
    expect(hydrate).not.toHaveBeenCalled();
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]).toMatchObject({ resolution: { kind: 'RESOLVED' } });
  });

  it.each(['none', 'mangadex', 'mangaupdates'])('hydrates the linked primary ID and preserves existing work identity: %s', async (cachedProvider) => {
    const cached = cachedProvider !== 'none';
    const { storage, outbox } = await fixture();
    const mdId = '12345678-1234-4234-8234-123456789abc';
    const primary = { ...candidate, provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const, externalId: '12345' };
    const md = { ...primary, provider: 'mangadex' as const, externalId: mdId, linkedReferences: [{ provider: 'mangaupdates' as const, externalId: '12345' }] };
    if (cached) {
      const id = favoriteCandidateWorkId(md);
      const cachedCandidate = cachedProvider === 'mangaupdates' ? { ...primary, linkedReferences: [{ provider: md.provider, externalId: md.externalId }] } : md;
      await storage.putWork(createWork({ id, externalReferences: [{ provider: md.provider, externalId: md.externalId }, { provider: primary.provider, externalId: primary.externalId }], mediaKind: 'manga', preferredTitle: 'Synthetic', hydration: { candidate: cachedCandidate, hydratedAt: now, matcherVersion: 'favorite-matcher-v3', favoriteAliasKeys: [], providerTitleKeys: [] } }));
      await storage.putLibrary(createLibrary(libraryId('library_primary'), [id]));
    }
    const sourceAdapter = { id: 'fixture-md', origins: ['https://mangadex.org'], analyze: () => createSourceEvidence({ aliases: [], canonicalUrl: `https://mangadex.org/title/${mdId}`, diagnostics: [], explicitProviderReference: { provider: 'mangadex', externalId: mdId }, key: 'fixture', mediaKind: 'MANGA', origin: 'https://mangadex.org', path: `/title/${mdId}`, proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-md', strategy: 'exact-origin' }) };
    await importFavoriteSources([{ ...favorite, url: `https://mangadex.org/title/${mdId}` }], storage, now, [sourceAdapter]);
    const hydratedIds: string[] = [];
    const result = await runFavoriteResolutionSlice({ candidates: candidatePorts(unusedSearch), hydration: { ...hydrationPorts(unusedHydration), mangadex: { hydrate: async () => md }, mangaupdates: { hydrate: async (reference) => { hydratedIds.push(reference.externalId); return primary; } } }, libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'cross-reference' });
    expect(result.completed).toBe(1);
    expect(hydratedIds).toEqual(cachedProvider === 'mangaupdates' ? [] : ['12345']);
    const works = await storage.listWorks({ limit: 10 });
    expect(works).toHaveLength(1);
    if (cached) expect(works[0]?.id).toBe(favoriteCandidateWorkId(md));
    expect(works[0]).toMatchObject({ hydration: { candidate: { provider: 'mangaupdates' } }, externalReferences: expect.arrayContaining([{ provider: 'mangadex', externalId: mdId }, { provider: 'mangaupdates', externalId: '12345' }]) });
  });
  it('keeps an exact MangaUpdates identity retryable when bounded 405 recovery cannot return that ID', async () => {
    const { storage, task, outbox } = await fixture();
    await importFavoriteSources([{ ...favorite, url: 'https://reader.example/manga/frieren' }], storage, now);
    const manga = { ...candidate, provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const };
    const pages: (string | undefined)[] = [];
    let clock = now;
    const dependencies = {
      synchronized: { lookup: async (keys: readonly FavoriteIdentityKey[]) => keys.map(key => ({ fingerprint: key.fingerprint, kind: 'FOUND' as const, mediaKind: 'MANGA' as const, references: [{ provider: manga.provider, externalId: manga.externalId }] })) },
      candidates: { ...candidatePorts(unusedSearch), mangaupdates: { search: async (query: FavoriteProviderSearchQuery) => {
        pages.push(query.cursor);
        return createProviderCandidateEnvelope(query.cursor === undefined
          ? { candidates: [], complete: false, digest: 'page-1', nextCursor: '2', provider: 'mangaupdates', truncated: true }
          : { candidates: [manga], complete: true, digest: 'page-2', provider: 'mangaupdates', truncated: false });
      } } },
      hydration: { ...hydrationPorts(unusedHydration), mangaupdates: { hydrate: async () => { throw new Error('HTTP 405'); } } },
      libraryId: libraryId('library_primary'), now: () => clock, outbox, storage, token: () => 'd1-manga',
    };
    await runFavoriteResolutionSlice(dependencies);
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT', availableAt: '2026-09-07T12:15:00.000Z' });
    expect(pages).toEqual([undefined]);
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    expect(await storage.getLibrary(libraryId('library_primary'))).toBeUndefined();
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it('commits provider evidence so a later pass never repeats the search', async () => {
    const { outbox, storage } = await fixture();
    let clock = now;
    let searches = 0;
    const dependencies = {
      candidates: candidatePorts({ search: async () => { searches += 1; return createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'saved-evidence', provider: 'anilist', truncated: false }); } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }), libraryId: libraryId('library_primary'), now: () => clock, outbox, storage, token: () => 'd1-outage',
    };
    await runFavoriteResolutionSlice(dependencies);
    expect(searches).toBe(1);
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toHaveLength(1);
    clock = '2026-09-07T12:16:00.000Z';
    await runFavoriteResolutionSlice(dependencies);
    expect(searches).toBe(1);
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toHaveLength(1);
  });

  it('blocks a provider outage after eight attempts until an explicit retry', async () => {
    const { storage, task, outbox } = await fixture();
    await storage.putFavoriteResolutionTask({ ...task, attempt: 7 });
    await runFavoriteResolutionSlice({ candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration), libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'eighth' });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'BLOCKED', blockedReason: 'AUTOMATIC_ATTEMPT_LIMIT' });
    expect(await storage.readFavoriteResolutionCounts()).toMatchObject({ blocked: 1, observed: 1, processing: 0, retryable: 0, unsupported: 0 });
  });
  it('uses the private synchronized lookup before title search and preserves its public references', async () => {
    const { outbox, storage } = await fixture();
    let searches = 0;
    const references = [{ provider: 'kitsu-anime' as const, externalId: '46474' }, { provider: 'anilist' as const, externalId: candidate.externalId }];
    await runFavoriteResolutionSlice({
      synchronized: { lookup: async (keys) => keys.map((key) => ({ fingerprint: key.fingerprint, kind: 'FOUND', mediaKind: 'ANIME', references })) },
      candidates: candidatePorts({ search: async () => { searches += 1; throw new Error('unexpected search'); } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }), libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'owner-token',
    });
    expect(searches).toBe(0);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RESOLVED' });
    expect(source?.matchedWorkId && await storage.getWork(source.matchedWorkId)).toMatchObject({ externalReferences: references });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });
  it('reconstructs synchronized ambiguity into the private Review set before title search', async () => {
    const { outbox, storage } = await fixture();
    const first = { ...candidate, canonicalUrl: 'https://anilist.co/anime/154587', cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/154587.jpg' } };
    const second = { ...candidate, canonicalUrl: 'https://kitsu.app/anime/46474', externalId: '46474', provider: 'kitsu-anime' as const };
    const search = vi.fn(async () => { throw new Error('unexpected search'); });
    await runFavoriteResolutionSlice({
      synchronized: { lookup: async (keys) => keys.map((key) => ({ fingerprint: key.fingerprint, identities: [
        { mediaKind: 'ANIME' as const, references: [{ provider: 'anilist' as const, externalId: first.externalId }] },
        { mediaKind: 'ANIME' as const, references: [{ provider: 'kitsu-anime' as const, externalId: second.externalId }] },
      ], kind: 'AMBIGUOUS' as const })) },
      candidates: candidatePorts({ search }),
      hydration: hydrationPorts({ hydrate: async () => first }, { hydrate: async () => second }),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'owner-ambiguity',
    });
    expect(search).not.toHaveBeenCalled();
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source).toMatchObject({ resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' } });
    expect(source?.reviewId && await storage.getFavoriteReviewCandidateSet(source.reviewId)).toMatchObject({ candidates: [{ externalId: first.externalId }, { externalId: second.externalId }], provenance: 'synchronized-identities' });
  });
  it('schedules provider Retry-After without asking the fallback provider', async () => {
    const { outbox, storage, task } = await fixture();
    const retryAt = '2026-09-07T14:00:00.000Z';
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { throw new FavoriteProviderRetryError('429', new Date(retryAt).valueOf()); } }),
      hydration: hydrationPorts(unusedHydration), libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'rate-token',
    });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ availableAt: retryAt, state: 'RETRY_AT' });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });
  it.each([false, true])('reuses a hydrated identity and refreshes it only after expiry (%s)', async (expired) => {
    const { outbox, storage } = await fixture();
    let searches = 0;
    let hydrations = 0;
    let clock = now;
    const dependencies = {
      candidates: candidatePorts({ search: async () => {
        searches += 1;
        return createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'cached-search', provider: 'anilist', truncated: false });
      } }),
      hydration: hydrationPorts({ hydrate: async () => { hydrations += 1; return candidate; } }),
      libraryId: libraryId('library_primary'), now: () => clock, outbox, storage, token: () => 'cache-token',
    };
    await runFavoriteResolutionSlice(dependencies);
    const [original] = await storage.listFavoriteSources({ limit: 1 });
    clock = expired ? '2026-10-07T12:00:00.000Z' : '2026-09-07T12:01:00.000Z';
    await importFavoriteSources([{ ...favorite, bookmarkId: 'cache-copy' }], storage, clock);
    const copy = (await storage.listFavoriteSources({ limit: 100 })).find((source) => source.id !== original?.id);
    const pending = copy === undefined ? undefined : await storage.getFavoriteResolutionTask(copy.id.replace(/^source_/u, 'favorite-resolution_'));
    if (pending === undefined) throw new Error('Expected copied favorite task.');
    const result = await runFavoriteResolutionSlice({ ...dependencies, outbox: new MemoryOutbox(storage, pending.id) });
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    expect(searches).toBe(1);
    expect(hydrations).toBe(expired ? 2 : 1);
    const sources = await storage.listFavoriteSources({ limit: 100 });
    expect(sources.every((source) => source.matchedWorkId === original?.matchedWorkId)).toBe(true);
    expect(original?.matchedWorkId && await storage.getWork(original.matchedWorkId)).toMatchObject({ hydration: { hydratedAt: expired ? clock : now } });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it('persists a hydrated Work and committed effect atomically without Review', async () => {
    const { outbox, storage, task } = await fixture();
    const envelope = createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'search-1', provider: 'anilist', truncated: false });
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => envelope }),
      hydration: hydrationPorts({ hydrate: async () => candidate }),
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ effectRecord: 'resolved:anilist:154587', state: 'COMMITTED' });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source && await storage.getFavoriteResolutionReceipt(`${source.id}:favorite-resolution`)).toMatchObject({ effectDigest: 'resolved:anilist:154587', idempotencyKey: task.idempotencyKey });
    expect(source?.reviewId).toBeUndefined();
    expect(source?.resolution).toEqual({ kind: 'RESOLVED' });
    expect(source?.matchedWorkId && await storage.getWork(source.matchedWorkId)).toMatchObject({ preferredTitle: 'Frieren' });
    await expect(storage.getLibrary(libraryId('library_primary'))).resolves.toMatchObject({ workIds: [source?.matchedWorkId] });
  });

  it('schedules an internal failure separately from a provider outage', async () => {
    const { outbox, storage, task } = await fixture();
    const envelope = createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'invariant-search', provider: 'anilist', truncated: false });
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => envelope }),
      hydration: hydrationPorts({ hydrate: async () => ({ ...candidate, externalId: 'wrong-id' }) }),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'invariant-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 0, continuationRequired: false, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT', availableAt: '2026-09-07T12:00:30.000Z', blockedReason: 'INTERNAL_RESOLUTION_FAILURE' });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'INTERNAL_FAILURE' });
    expect(await storage.readFavoriteResolutionCounts()).toMatchObject({ internalErrors: 1 });
  });

  it('persists bookmark progression with the hydrated provider maximum', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ ...favorite, title: 'Frieren épisode 7' }], storage, now);
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_c_72756e6e6572');
    if (task === undefined) throw new Error('Expected progression task.');
    const hydrated = { ...candidate, episodeCount: 28 };
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => createProviderCandidateEnvelope({ candidates: [hydrated], complete: true, digest: 'progress-search', provider: 'anilist', truncated: false }) }),
      hydration: hydrationPorts({ hydrate: async () => hydrated }), libraryId: libraryId('library_primary'), now: () => now,
      outbox: new MemoryOutbox(storage, task.id), storage, token: () => 'progress-token',
    });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.matchedWorkId && await storage.findProgressByWorkId(source.matchedWorkId)).toMatchObject({ kind: 'episode', maximum: 28, value: 7 });

    await importFavoriteSources([{ ...favorite, title: 'Frieren épisode 3' }], storage, '2026-09-07T12:01:00.000Z');
    const revisedTask = await storage.getFavoriteResolutionTask('favorite-resolution_c_72756e6e6572');
    if (revisedTask === undefined) throw new Error('Expected revised progression task.');
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => createProviderCandidateEnvelope({ candidates: [hydrated], complete: true, digest: 'lower-progress-search', provider: 'anilist', truncated: false }) }),
      hydration: hydrationPorts({ hydrate: async () => hydrated }), libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:01:00.000Z',
      outbox: new MemoryOutbox(storage, revisedTask.id), storage, token: () => 'lower-progress-token',
    });
    expect(source?.matchedWorkId && await storage.findProgressByWorkId(source.matchedWorkId)).toMatchObject({ kind: 'episode', maximum: 28, value: 7 });
  });

  it('persists a retry after a recoverable provider failure', async () => {
    const { outbox, storage, task } = await fixture();
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { throw new Error('offline'); } }),
      hydration: hydrationPorts({ hydrate: async () => undefined }),
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 0, continuationRequired: false, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
  });

  it('traces provider failures and internal commit failures without private data', async () => {
    const { outbox, storage } = await fixture();
    const events: Array<{ readonly operation: string; readonly outcome: string; readonly code?: string }> = [];
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { throw new Error('offline'); } }),
      hydration: hydrationPorts({ hydrate: async () => undefined }),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'trace-token',
      trace: (event) => { events.push({ operation: event.operation, outcome: event.outcome, code: event.code }); },
    });
    expect(result.retried).toBe(1);
    expect(events).toContainEqual({ operation: 'provider-result', outcome: 'failed', code: 'anilist:PROVIDER_UNAVAILABLE' });
    expect(events.every((event) => !JSON.stringify(event).includes('offline'))).toBe(true);
  });

  it('uses one complete Kitsu fallback after a complete AniList NO_MATCH', async () => {
    const { outbox, storage, task } = await fixture();
    const kitsuCandidate = { ...candidate, externalId: '46474', provider: 'kitsu-anime' as const };
    const fallback = createProviderCandidateEnvelope({ candidates: [kitsuCandidate], complete: true, digest: 'kitsu-search', provider: 'kitsu-anime', truncated: false });
    const result = await runFavoriteResolutionSlice({
      candidates: {
        anilist: { search: async () => createProviderCandidateEnvelope({ candidates: [], complete: true, digest: 'empty-primary', provider: 'anilist', truncated: false }) },
        'kitsu-anime': { search: async () => fallback },
        'kitsu-manga': unusedSearch,
        mangaupdates: unusedSearch,
      },
      hydration: {
        anilist: unusedHydration,
        'kitsu-anime': { hydrate: async () => kitsuCandidate },
        'kitsu-manga': unusedHydration,
        mangaupdates: unusedHydration,
      },
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'claim-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ effectRecord: 'resolved:kitsu-anime:46474', state: 'COMMITTED' });
  });

  it('commits a detached source without contacting a provider', async () => {
    const { outbox, storage, task } = await fixture();
    await reconcileFavoriteSourcePresence([], storage);
    let providerCalls = 0;
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { providerCalls += 1; throw new Error('must not run'); } }),
      hydration: hydrationPorts({ hydrate: async () => undefined }),
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });

    expect(providerCalls).toBe(0);
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ effectRecord: 'source:detached', state: 'COMMITTED' });
  });

  it('Q-07 hydrates an explicit provider reference without title rematching', async () => {
    const storage = new MemoryStoragePort();
    const explicitFavorite = { ...favorite, bookmarkId: 'explicit', title: 'Titre local volontairement différent', url: 'https://anilist.co/anime/154587/frieren' };
    await importFavoriteSources([explicitFavorite], storage, now, [{
      analyze: (input, url) => createSourceEvidence({ aliases: [], diagnostics: [], explicitProviderReference: { externalId: '154587', provider: 'anilist' }, key: input.sourceKey, mediaKind: 'ANIME', origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH'], sourceAdapter: 'test-anilist', strategy: 'exact-origin', title: input.title }),
      id: 'test-anilist',
      origins: ['https://anilist.co'],
    }]);
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_g_6578706c69636974');
    if (task === undefined) throw new Error('Expected explicit task.');
    const outbox = new MemoryOutbox(storage, task.id);
    let searches = 0;
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { searches += 1; throw new Error('must not search'); } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }),
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });

    expect(searches).toBe(0);
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RESOLVED' });
    expect(source?.reviewId).toBeUndefined();
  });

  it.each([true, false])('hydrates a MangaUpdates ID through bounded search after a 405 response (explicit %s)', async (explicit) => {
    const storage = new MemoryStoragePort();
    const manga = { externalId: '12345', mediaKind: 'MANGA' as const, preSerialization: false, provider: 'mangaupdates' as const, titles: ['Synthetic Manga'], displayTitle: 'Synthetic Manga' };
    const novel = { ...manga, externalId: '54321', preSerialization: true, titles: ['Synthetic Manga (Novel)'], displayTitle: 'Synthetic Manga (Novel)' };
    const explicitFavorite = { ...favorite, bookmarkId: 'explicit-mu', title: 'Synthetic Manga', url: explicit ? 'https://www.mangaupdates.com/series/abc123/synthetic-manga' : 'https://reader.example/manga/synthetic-manga' };
    await importFavoriteSources([explicitFavorite], storage, now, [{
      analyze: (input, url) => createSourceEvidence({ aliases: [{ provenance: 'stable-url-slug', value: 'Synthetic Manga' }], diagnostics: [], explicitProviderReference: { externalId: '12345', provider: 'mangaupdates' }, key: input.sourceKey, mediaKind: 'MANGA', origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], sourceAdapter: 'test-mu', strategy: 'exact-origin', title: 'Synthetic Manga' }),
      id: 'test-mu', origins: ['https://www.mangaupdates.com'],
    }]);
    const [imported] = await storage.listFavoriteSources({ limit: 1 });
    const task = imported === undefined ? undefined : await storage.getFavoriteResolutionTask(imported.id.replace(/^source_/u, 'favorite-resolution_'));
    if (task === undefined) throw new Error('Expected explicit MangaUpdates task.');
    const result = await runFavoriteResolutionSlice({
      candidates: { ...candidatePorts({ search: async () => createProviderCandidateEnvelope({ candidates: [manga], complete: true, digest: 'mu-search', provider: 'mangaupdates', truncated: false }) }), mangaupdates: { search: async () => createProviderCandidateEnvelope({ candidates: [manga, novel], complete: true, digest: 'mu-search', provider: 'mangaupdates', truncated: false }) } },
      hydration: { ...hydrationPorts(unusedHydration), mangaupdates: { hydrate: async () => { throw new Error('Favorite provider request failed with HTTP 405.'); } } },
      libraryId: libraryId('library_primary'), now: () => now, outbox: new MemoryOutbox(storage, task.id), storage, token: () => 'mu-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 1, continuationRequired: false, retried: 0 });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RESOLVED' });
    expect(source?.reviewId).toBeUndefined();
  });

  it('applies blocked taxonomy after exact hydration without creating a Work', async () => {
    const storage = new MemoryStoragePort();
    const explicitFavorite = { ...favorite, bookmarkId: 'blocked', url: 'https://anilist.co/anime/154587/frieren' };
    await importFavoriteSources([explicitFavorite], storage, now, [{
      analyze: (input, url) => createSourceEvidence({ aliases: [], diagnostics: [], explicitProviderReference: { externalId: '154587', provider: 'anilist' }, key: input.sourceKey, mediaKind: 'ANIME', origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH'], sourceAdapter: 'test-anilist', strategy: 'exact-origin', title: input.title }),
      id: 'test-anilist', origins: ['https://anilist.co'],
    }]);
    const task = await storage.getFavoriteResolutionTask('favorite-resolution_e_626c6f636b6564');
    if (task === undefined) throw new Error('Expected blocked-taxonomy task.');
    const blockedCandidate = { ...candidate, categories: ['Hentai'] };
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => { throw new Error('must not search'); } }),
      hydration: hydrationPorts({ hydrate: async () => blockedCandidate }),
      libraryId: libraryId('library_primary'), now: () => now, outbox: new MemoryOutbox(storage, task.id), storage, token: () => 'claim-token',
    });

    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.reviewId).toBeUndefined();
    expect(source?.resolution).toEqual({ kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' });
    await expect(storage.getLibrary(libraryId('library_primary'))).resolves.toBeUndefined();
  });

  it('retries an incomplete candidate envelope instead of selecting a visible result', async () => {
    const { outbox, storage, task } = await fixture();
    const incomplete = createProviderCandidateEnvelope({ candidates: [candidate], complete: false, digest: 'partial', provider: 'anilist', truncated: true });
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => incomplete }),
      hydration: hydrationPorts({ hydrate: async () => candidate }),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'claim-token',
    });

    expect(result).toEqual({ blocked: 0, completed: 0, continuationRequired: false, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
  });

  it('persists only the bounded ambiguous candidates used by Review', async () => {
    const { outbox, storage } = await fixture();
    const second = { ...candidate, externalId: '154588' };
    const ambiguous = createProviderCandidateEnvelope({ candidates: [candidate, second], complete: true, digest: 'ambiguous', provider: 'anilist', truncated: false });
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => ambiguous }),
      hydration: hydrationPorts({ hydrate: async () => { throw new Error('must not hydrate'); } }),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'claim-token',
    });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source && await storage.getFavoriteReviewCandidateSet(source.reviewId)).toMatchObject({ candidates: [{ externalId: '154587' }, { externalId: '154588' }], digest: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  });

  it('refuses to publish an ambiguous Review without comparable candidates', async () => {
    const { storage, task } = await fixture();
    const claimed = claimTask(task, 'ambiguous-token', now, '2026-09-07T12:01:00.000Z');
    await storage.putFavoriteResolutionTask(claimed);
    await expect(persistFavoriteResolutionCompletion(
      { libraryId: libraryId('library_primary'), now: () => now, storage }, claimed, 'ambiguous-token',
      { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, 'review:invalid-empty',
    )).rejects.toThrow('AMBIGUOUS_REVIEW_REQUIRES_COMPARABLE_IDENTITIES');
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
  });

  it('does not count duplicate hydrated candidates as distinct comparable identities', async () => {
    const { storage, task } = await fixture();
    const claimed = claimTask(task, 'duplicate-token', now, '2026-09-07T12:01:00.000Z');
    await storage.putFavoriteResolutionTask(claimed);
    await expect(persistFavoriteResolutionCompletion(
      { libraryId: libraryId('library_primary'), now: () => now, storage }, claimed, 'duplicate-token',
      { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, 'review:invalid-duplicates', undefined,
      { candidates: [candidate, candidate], digest: 'duplicate-candidates', recordedAt: now, totalCandidates: 2 },
    )).rejects.toThrow('AMBIGUOUS_REVIEW_REQUIRES_COMPARABLE_IDENTITIES');
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it.each([{ externalId: '154587', accepted: false }, { externalId: '154588', accepted: true }])('counts candidate and reference identities distinctly: $externalId', async ({ externalId, accepted }) => {
    const { storage, task } = await fixture();
    const claimed = claimTask(task, 'mixed-token', now, '2026-09-07T12:01:00.000Z');
    await storage.putFavoriteResolutionTask(claimed);
    const completion = persistFavoriteResolutionCompletion(
      { libraryId: libraryId('library_primary'), now: () => now, storage }, claimed, 'mixed-token',
      { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, 'review:mixed-identities', undefined,
      { candidates: [candidate], references: [{ provider: 'anilist', externalId }], digest: `mixed-${externalId}`, recordedAt: now, totalCandidates: 2 },
    );
    if (accepted) await expect(completion).resolves.toBeUndefined();
    else await expect(completion).rejects.toThrow('AMBIGUOUS_REVIEW_REQUIRES_COMPARABLE_IDENTITIES');
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toHaveLength(accepted ? 1 : 0);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('keeps a terminal NOT_FOUND actionable instead of making a no-match decision', async () => {
    const { outbox, storage } = await fixture();
    const empty = createProviderCandidateEnvelope({ candidates: [], complete: true, digest: 'empty-primary', provider: 'anilist', truncated: false });
    const fallback = createProviderCandidateEnvelope({ candidates: [], complete: true, digest: 'empty-fallback', provider: 'kitsu-anime', truncated: false });
    await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => empty }, { search: async () => fallback }),
      hydration: hydrationPorts(unusedHydration),
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'claim-token',
    });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toMatchObject([{ reason: 'NOT_FOUND', status: 'pending' }]);
    expect(await storage.listReviews({ limit: 100, status: 'no-match' })).toEqual([]);
  });

  it('rejects an expired claim before writing a Work, source resolution or receipt', async () => {
    const { storage, task } = await fixture();
    const claimed = claimTask(task, 'expired-token', now, '2026-09-07T12:01:00.000Z');
    await storage.putFavoriteResolutionTask(claimed);
    await expect(persistFavoriteResolutionCompletion({ libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:01:00.000Z', storage }, claimed, 'expired-token', { kind: 'RESOLVED' }, 'resolved:anilist:154587', candidate)).rejects.toThrow('STALE_PRIVATE_REFERENCE');
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toBeUndefined();
    expect(source && await storage.getFavoriteResolutionReceipt(`${source.id}:favorite-resolution`)).toBeUndefined();
    expect(await storage.getLibrary(libraryId('library_primary'))).toBeUndefined();
    expect(await storage.getFavoriteResolutionTask(task.id)).toEqual(claimed);
  });

  it('requests a continuation when a provider call exhausts the wake budget', async () => {
    const { outbox, storage, task } = await fixture();
    let clock = now;
    const result = await runFavoriteResolutionSlice({
      candidates: candidatePorts({ search: async () => {
        clock = '2026-09-07T12:01:01.000Z';
        return createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'late', provider: 'anilist', truncated: false });
      } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }),
      libraryId: libraryId('library_primary'), now: () => clock, outbox, storage, token: () => 'expired-request',
    });
    expect(result).toEqual({ blocked: 0, completed: 0, continuationRequired: true, retried: 0 });
    const current = await storage.getFavoriteResolutionTask(task.id);
    expect(current?.state).toBe('CLAIMED');
    expect(current && isTaskAvailable(current, clock)).toBe(true);
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it('bounds provider pagination to the first relevance window', async () => {
    const { outbox, storage, task } = await fixture();
    let clock = new Date(now).valueOf();
    const requestedPages: string[] = [];
    const dependencies = {
      candidates: candidatePorts({ search: async (input: { cursor?: string }) => {
        const page = Number(input.cursor ?? '1');
        requestedPages.push(String(page));
        const envelope = { candidates: [page === 10 ? candidate : { ...candidate, externalId: String(page), titles: [`Unrelated identity ${page}`] }], complete: page === 10, digest: `page-${page}`, provider: 'anilist' as const, truncated: page !== 10 };
        return createProviderCandidateEnvelope(page === 10 ? envelope : { ...envelope, nextCursor: String(page + 1) });
      } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }), libraryId: libraryId('library_primary'),
      now: () => new Date(clock).toISOString(), outbox, storage, token: () => 'resume-token',
    };
    await importFavoriteSources([favorite], storage, dependencies.now());
    const result = await runFavoriteResolutionSlice(dependencies);
    expect(result.blocked).toBe(0);
    expect(requestedPages).toEqual(['1']);
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });
});

describe('repairMissingFavoriteCovers', () => {
  it.each(['ambiguous', 'incomplete', 'unrelated', 'no-cover'] as const)('preserves the existing work for a %s MangaUpdates result', async (scenario) => {
    const storage = new MemoryStoragePort();
    const mangadex = { ...candidate, provider: 'mangadex' as const, externalId: '12345678-1234-4234-8234-123456789abc', mediaKind: 'MANGA' as const, cover: { attribution: 'MangaDex', url: 'https://uploads.mangadex.org/covers/fixture.jpg' } };
    const work = createWork({ id: workId('work_cover_guard'), preferredTitle: 'Frieren', mediaKind: 'manga', externalReferences: [{ provider: 'mangadex', externalId: mangadex.externalId }], hydration: { candidate: mangadex, favoriteAliasKeys: [], hydratedAt: now, matcherVersion: 'matcher-v1', providerTitleKeys: [] } });
    await storage.putWork(work);
    const base = { ...candidate, provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const, titles: scenario === 'unrelated' ? ['Unrelated Title'] : ['Frieren'] };
    const preferred = scenario === 'no-cover' ? base : { ...base, cover: { attribution: 'MangaUpdates', url: 'https://cdn.mangaupdates.com/image/fixture.jpg' } };
    const candidates = scenario === 'ambiguous' ? [preferred, { ...preferred, externalId: '87654' }] : [preferred];
    const input = { candidates, complete: scenario !== 'incomplete', truncated: scenario === 'incomplete', digest: 'guard', provider: 'mangaupdates' as const };
    const envelope = createProviderCandidateEnvelope(scenario === 'incomplete' ? { ...input, nextCursor: '2' } : input);
    await repairMissingFavoriteCovers(storage, hydrationPorts(unusedHydration), () => now, undefined, { ...candidatePorts(unusedSearch), mangaupdates: { search: async () => envelope } });
    expect(await storage.getWork(work.id)).toEqual(work);
  });
  it('prefers a bounded MangaUpdates cover for an existing MangaDex work', async () => {
    const storage = new MemoryStoragePort();
    const mangadex = { ...candidate, provider: 'mangadex' as const, externalId: '12345678-1234-4234-8234-123456789abc', mediaKind: 'MANGA' as const, cover: { attribution: 'MangaDex', url: 'https://uploads.mangadex.org/covers/12345678-1234-4234-8234-123456789abc/old.512.jpg' } };
    await storage.putWork(createWork({ externalReferences: [{ provider: 'mangadex', externalId: mangadex.externalId }], id: workId('work_mangadex-cover'), mediaKind: 'manga', preferredTitle: 'Synthetic Series', hydration: { candidate: mangadex, favoriteAliasKeys: [], hydratedAt: now, matcherVersion: 'matcher-v1', providerTitleKeys: [] } }));
    const preferred = { ...mangadex, provider: 'mangaupdates' as const, externalId: '12345', cover: { attribution: 'MangaUpdates', url: 'https://cdn.mangaupdates.com/image/series.jpg' } };
    const hydration = hydrationPorts(unusedHydration);
    const candidates = candidatePorts(unusedSearch);
    const result = await repairMissingFavoriteCovers(storage, { ...hydration, mangadex: { hydrate: async () => mangadex }, mangaupdates: { hydrate: async () => preferred } }, () => now, undefined, { ...candidates, mangadex: { search: async () => createProviderCandidateEnvelope({ candidates: [mangadex], complete: true, digest: 'md', provider: 'mangadex', truncated: false }) }, mangaupdates: { search: async () => createProviderCandidateEnvelope({ candidates: [preferred], complete: true, digest: 'mu', provider: 'mangaupdates', truncated: false }) } });
    expect(result.repaired).toBe(1);
    await expect(storage.getWork(workId('work_mangadex-cover'))).resolves.toMatchObject({ hydration: { candidate: { provider: 'mangaupdates', externalId: '12345', cover: { attribution: 'MangaUpdates' } } }, externalReferences: expect.arrayContaining([{ provider: 'mangadex', externalId: mangadex.externalId }, { provider: 'mangaupdates', externalId: '12345' }]) });
  });

  it('advances by work id so later pages are eventually repaired', async () => {
    const storage = new MemoryStoragePort();
    for (let index = 0; index < 11; index += 1) {
      const workCandidate = { ...candidate, externalId: String(index) };
      await storage.putWork(createWork({
        externalReferences: [{ externalId: String(index), provider: 'anilist' }],
        id: workId(`work_cover_${String(index).padStart(2, '0')}`), mediaKind: 'anime', preferredTitle: `Work ${index}`,
        hydration: { candidate: workCandidate, favoriteAliasKeys: [], hydratedAt: now, matcherVersion: 'matcher-v1', providerTitleKeys: [] },
      }));
    }
    const calls: string[] = [];
    const hydration = hydrationPorts({ hydrate: async ({ externalId }: { externalId: string }) => { calls.push(externalId); return { ...candidate, externalId, cover: { attribution: 'AniList', url: `https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/${externalId}.jpg` } }; } });
    const first = await repairMissingFavoriteCovers(storage, hydration, () => now);
    expect(first.inspected).toBe(10);
    expect(first.nextAfterId).toBe(workId('work_cover_09'));
    const second = await repairMissingFavoriteCovers(storage, hydration, () => now, first.nextAfterId);
    expect(second.inspected).toBe(1);
    expect(second.repaired).toBe(1);
    expect(calls).toHaveLength(11);
    expect((await storage.getWork(workId('work_cover_10')))?.hydration?.candidate.cover?.url).toContain('/10.jpg');
  });
});
