import { describe, expect, it } from 'vitest';
import { createProviderCandidateEnvelope, createSourceEvidence, createWork, libraryId, workId } from '@tobirink/domain';
import type { DurableTask, FavoriteResolutionClaim, FavoriteResolutionOutboxPort } from '../tasks';
import { blockTask, claimTask, isTaskAvailable, retryTask } from '../tasks';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';
import { reconcileFavoriteSourcePresence } from '../use-cases/reconcile-favorite-source-presence';
import { repairMissingFavoriteCovers, runFavoriteResolutionSlice } from './favorite-resolution-runner';
import { persistFavoriteResolutionCompletion } from './favorite-resolution-commit';
import { FavoriteProviderRetryError } from './provider-ports';
import type { FavoriteProviderSearchQuery } from './provider-ports';
import type { FavoriteCollectiveKey } from '../collective-index/favorite-collective-lookup';

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
  retry(id: string, token: string, retryAt: string) { return this.change(id, (task) => retryTask(task, token, retryAt)); }
}

async function fixture() {
  const storage = new MemoryStoragePort();
  await importFavoriteSources([favorite], storage, now);
  const task = (await storage.getFavoriteResolutionTask('favorite-resolution_c_72756e6e6572'));
  if (task === undefined) throw new Error('Expected resolution task.');
  return { outbox: new MemoryOutbox(storage, task.id), storage, task };
}

describe('runFavoriteResolutionSlice', () => {
  it('hydrates the linked primary ID from an exact MangaDex source and preserves both references', async () => {
    const { storage, outbox } = await fixture();
    const mdId = '12345678-1234-4234-8234-123456789abc';
    const primary = { ...candidate, provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const, externalId: '12345' };
    const md = { ...primary, provider: 'mangadex' as const, externalId: mdId, linkedReferences: [{ provider: 'mangaupdates' as const, externalId: '12345' }] };
    const sourceAdapter = { id: 'fixture-md', origins: ['https://mangadex.org'], analyze: () => createSourceEvidence({ aliases: [], canonicalUrl: `https://mangadex.org/title/${mdId}`, diagnostics: [], explicitProviderReference: { provider: 'mangadex', externalId: mdId }, key: 'fixture', mediaKind: 'MANGA', origin: 'https://mangadex.org', path: `/title/${mdId}`, proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-md', strategy: 'exact-origin' }) };
    await importFavoriteSources([{ ...favorite, url: `https://mangadex.org/title/${mdId}` }], storage, now, [sourceAdapter]);
    const hydratedIds: string[] = [];
    const result = await runFavoriteResolutionSlice({ candidates: candidatePorts(unusedSearch), hydration: { ...hydrationPorts(unusedHydration), mangadex: { hydrate: async () => md }, mangaupdates: { hydrate: async (reference) => { hydratedIds.push(reference.externalId); return primary; } } }, libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'cross-reference' });
    expect(result.completed).toBe(1);
    expect(hydratedIds).toEqual(['12345']);
    const works = await storage.listWorks({ limit: 10 });
    expect(works).toHaveLength(1);
    expect(works[0]).toMatchObject({ hydration: { candidate: { provider: 'mangaupdates' } }, externalReferences: expect.arrayContaining([{ provider: 'mangadex', externalId: mdId }, { provider: 'mangaupdates', externalId: '12345' }]) });
  });
  it('resumes the exact MangaUpdates identity from D1 after a paginated 405 recovery', async () => {
    const { storage, task, outbox } = await fixture();
    await importFavoriteSources([{ ...favorite, url: 'https://reader.example/manga/frieren' }], storage, now);
    const manga = { ...candidate, provider: 'mangaupdates' as const, mediaKind: 'MANGA' as const };
    const pages: (string | undefined)[] = [];
    let clock = now;
    const dependencies = {
      collective: { lookup: async (keys: readonly FavoriteCollectiveKey[]) => keys.map(key => ({ fingerprint: key.fingerprint, kind: 'FOUND' as const, mediaKind: 'MANGA' as const, references: [{ provider: manga.provider, externalId: manga.externalId }], scope: 'owner' as const })) },
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
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT', availableAt: '2026-09-07T12:00:01.000Z' });
    clock = '2026-09-07T12:00:02.000Z';
    await runFavoriteResolutionSlice(dependencies);
    expect(pages).toEqual([undefined, '2']);
    expect((await storage.listFavoriteSources({ limit: 1 }))[0]?.resolution).toEqual({ kind: 'RESOLVED' });
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toHaveLength(1);
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it('checkpoints provider evidence during a D1 outage and consults the owner before committing', async () => {
    const { outbox, storage } = await fixture();
    let clock = now;
    let offline = true;
    let searches = 0;
    const dependencies = {
      collective: { lookup: async (keys: readonly FavoriteCollectiveKey[]) => {
        if (offline) throw new Error('D1 unavailable');
        return keys.map(key => ({ fingerprint: key.fingerprint, kind: 'MISS' as const }));
      } },
      candidates: candidatePorts({ search: async () => { searches += 1; return createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'saved-evidence', provider: 'anilist', truncated: false }); } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }), libraryId: libraryId('library_primary'), now: () => clock, outbox, storage, token: () => 'd1-outage',
    };
    await runFavoriteResolutionSlice(dependencies);
    expect(searches).toBe(1);
    expect(await storage.getLibrary(libraryId('library_primary'))).toBeUndefined();
    offline = false;
    clock = '2026-09-07T12:16:00.000Z';
    await runFavoriteResolutionSlice(dependencies);
    expect(searches).toBe(1);
    expect((await storage.getLibrary(libraryId('library_primary')))?.workIds).toHaveLength(1);
  });

  it('keeps a provider outage scheduled after eight attempts', async () => {
    const { storage, task, outbox } = await fixture();
    await storage.putFavoriteResolutionTask({ ...task, attempt: 7 });
    await runFavoriteResolutionSlice({ candidates: candidatePorts(unusedSearch), hydration: hydrationPorts(unusedHydration), libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'eighth' });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT', availableAt: '2026-09-07T18:00:00.000Z' });
    expect(await storage.readFavoriteResolutionCounts()).toEqual({ processing: 0, retryable: 1, unsupported: 0 });
  });
  it('uses the owner-scoped lookup before title search and preserves its public references', async () => {
    const { outbox, storage } = await fixture();
    let searches = 0;
    const references = [{ provider: 'kitsu-anime' as const, externalId: '46474' }, { provider: 'anilist' as const, externalId: candidate.externalId }];
    await runFavoriteResolutionSlice({
      collective: { lookup: async (keys) => keys.map((key) => ({ fingerprint: key.fingerprint, kind: 'FOUND', mediaKind: 'ANIME', references, scope: 'owner' })) },
      candidates: candidatePorts({ search: async () => { searches += 1; throw new Error('unexpected search'); } }),
      hydration: hydrationPorts({ hydrate: async () => candidate }), libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'owner-token',
    });
    expect(searches).toBe(0);
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RESOLVED' });
    expect(source?.matchedWorkId && await storage.getWork(source.matchedWorkId)).toMatchObject({ externalReferences: references });
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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
    expect(result).toEqual({ blocked: 0, completed: 0, retried: 1 });
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
    expect(result).toEqual({ blocked: 0, completed: 0, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source?.resolution).toEqual({ kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' });
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
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

    expect(result).toEqual({ blocked: 0, completed: 0, retried: 1 });
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

  it('leaves an expired request reclaimable instead of blocking a newer task', async () => {
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
    expect(result).toEqual({ blocked: 0, completed: 0, retried: 0 });
    const current = await storage.getFavoriteResolutionTask(task.id);
    expect(current?.state).toBe('CLAIMED');
    expect(current && isTaskAvailable(current, clock)).toBe(true);
    expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
  });

  it('resumes more than eight normal pages across rescans without exhausting the failure counter', async () => {
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
    for (let page = 1; page <= 10; page += 1) {
      await importFavoriteSources([favorite], storage, dependencies.now());
      const result = await runFavoriteResolutionSlice(dependencies);
      expect(result.blocked).toBe(0);
      if (page < 10) {
        expect(result.completed).toBe(0);
        expect(await storage.listReviews({ limit: 100, status: 'pending' })).toEqual([]);
      }
      clock += 1_001;
    }
    expect(requestedPages).toEqual(Array.from({ length: 10 }, (_, index) => String(index + 1)));
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'COMMITTED' });
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
