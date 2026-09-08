import { describe, expect, it } from 'vitest';
import { createProviderCandidateEnvelope, createSourceEvidence, libraryId } from '@tobirink/domain';
import type { DurableTask, FavoriteResolutionClaim, FavoriteResolutionOutboxPort } from '../tasks';
import { blockTask, claimTask, isTaskAvailable, retryTask } from '../tasks';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';
import { reconcileFavoriteSourcePresence } from '../use-cases/reconcile-favorite-source-presence';
import { runFavoriteResolutionSlice } from './favorite-resolution-runner';
import { persistFavoriteResolutionCompletion } from './favorite-resolution-commit';

const now = '2026-09-07T12:00:00.000Z';
const favorite = { bookmarkId: 'runner', folderPath: ['Anime'], order: 0, state: 'eligible' as const, title: 'Frieren', url: 'https://reader.example/anime/frieren' };
const candidate = { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };
const unusedSearch = { search: async () => { throw new Error('not routed'); } };
const unusedHydration = { hydrate: async () => undefined };
function candidatePorts(anilist: { search: () => Promise<ReturnType<typeof createProviderCandidateEnvelope>> }, kitsuAnime = unusedSearch) {
  return { anilist, 'kitsu-anime': kitsuAnime, 'kitsu-manga': unusedSearch, mangaupdates: unusedSearch } as const;
}
function hydrationPorts(anilist: { hydrate: () => Promise<typeof candidate | undefined> }, kitsuAnime = unusedHydration) {
  return { anilist, 'kitsu-anime': kitsuAnime, 'kitsu-manga': unusedHydration, mangaupdates: unusedHydration } as const;
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

  it('uses one complete Kitsu fallback tier when AniList is unavailable', async () => {
    const { outbox, storage, task } = await fixture();
    const kitsuCandidate = { ...candidate, externalId: '46474', provider: 'kitsu-anime' as const };
    const fallback = createProviderCandidateEnvelope({ candidates: [kitsuCandidate], complete: true, digest: 'kitsu-search', provider: 'kitsu-anime', truncated: false });
    const result = await runFavoriteResolutionSlice({
      candidates: {
        anilist: { search: async () => { throw new Error('AniList unavailable'); } },
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
    const explicitFavorite = { ...favorite, bookmarkId: 'explicit', url: 'https://anilist.co/anime/154587/frieren' };
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
    expect(source && await storage.getFavoriteReviewCandidateSet(source.reviewId)).toMatchObject({ candidates: [{ externalId: '154587' }, { externalId: '154588' }], digest: 'ambiguous' });
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
});
