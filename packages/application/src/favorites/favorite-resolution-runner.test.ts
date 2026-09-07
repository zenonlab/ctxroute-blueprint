import { describe, expect, it } from 'vitest';
import { createProviderCandidateEnvelope, createSourceEvidence, libraryId } from '@tobirink/domain';
import type { DurableTask, FavoriteResolutionClaim, FavoriteResolutionOutboxPort } from '../tasks';
import { blockTask, claimTask, isTaskAvailable, retryTask } from '../tasks';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';
import { reconcileFavoriteSourcePresence } from '../use-cases/reconcile-favorite-source-presence';
import { runFavoriteResolutionSlice } from './favorite-resolution-runner';

const now = '2026-09-07T12:00:00.000Z';
const favorite = { bookmarkId: 'runner', folderPath: ['Anime'], order: 0, state: 'eligible' as const, title: 'Frieren', url: 'https://reader.example/anime/frieren' };
const candidate = { externalId: '154587', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Frieren'] };

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
  it('persists a hydrated Work, Review and committed effect atomically', async () => {
    const { outbox, storage, task } = await fixture();
    const envelope = createProviderCandidateEnvelope({ candidates: [candidate], complete: true, digest: 'search-1', provider: 'anilist', truncated: false });
    const result = await runFavoriteResolutionSlice({
      candidates: { anilist: { search: async () => envelope }, mangaupdates: { search: async () => { throw new Error('not routed'); } } },
      hydration: { anilist: { hydrate: async () => candidate }, mangaupdates: { hydrate: async () => undefined } },
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 1, retried: 0 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ effectRecord: 'resolved:anilist:154587', state: 'COMMITTED' });
    const [source] = await storage.listFavoriteSources({ limit: 1 });
    const review = source && await storage.getReview(source.reviewId);
    expect(review).toMatchObject({ status: 'resolved' });
    expect(review?.matchedWorkId && await storage.getWork(review.matchedWorkId)).toMatchObject({ preferredTitle: 'Frieren' });
    await expect(storage.getLibrary(libraryId('library_primary'))).resolves.toMatchObject({ workIds: [review?.matchedWorkId] });
  });

  it('persists a retry after a recoverable provider failure', async () => {
    const { outbox, storage, task } = await fixture();
    const result = await runFavoriteResolutionSlice({
      candidates: { anilist: { search: async () => { throw new Error('offline'); } }, mangaupdates: { search: async () => { throw new Error('not routed'); } } },
      hydration: { anilist: { hydrate: async () => undefined }, mangaupdates: { hydrate: async () => undefined } },
      libraryId: libraryId('library_primary'),
      now: () => now,
      outbox,
      storage,
      token: () => 'claim-token',
    });
    expect(result).toEqual({ blocked: 0, completed: 0, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
  });

  it('commits a detached source without contacting a provider', async () => {
    const { outbox, storage, task } = await fixture();
    await reconcileFavoriteSourcePresence([], storage);
    let providerCalls = 0;
    const result = await runFavoriteResolutionSlice({
      candidates: { anilist: { search: async () => { providerCalls += 1; throw new Error('must not run'); } }, mangaupdates: { search: async () => { providerCalls += 1; throw new Error('must not run'); } } },
      hydration: { anilist: { hydrate: async () => undefined }, mangaupdates: { hydrate: async () => undefined } },
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

  it('hydrates an explicit provider reference without title search', async () => {
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
      candidates: { anilist: { search: async () => { searches += 1; throw new Error('must not search'); } }, mangaupdates: { search: async () => { searches += 1; throw new Error('must not search'); } } },
      hydration: { anilist: { hydrate: async () => candidate }, mangaupdates: { hydrate: async () => undefined } },
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
      candidates: { anilist: { search: async () => { throw new Error('must not search'); } }, mangaupdates: { search: async () => { throw new Error('must not search'); } } },
      hydration: { anilist: { hydrate: async () => blockedCandidate }, mangaupdates: { hydrate: async () => undefined } },
      libraryId: libraryId('library_primary'), now: () => now, outbox: new MemoryOutbox(storage, task.id), storage, token: () => 'claim-token',
    });

    const [source] = await storage.listFavoriteSources({ limit: 1 });
    expect(source && await storage.getReview(source.reviewId)).toMatchObject({ status: 'no-match' });
    await expect(storage.getLibrary(libraryId('library_primary'))).resolves.toBeUndefined();
  });

  it('retries an incomplete candidate envelope instead of selecting a visible result', async () => {
    const { outbox, storage, task } = await fixture();
    const incomplete = createProviderCandidateEnvelope({ candidates: [candidate], complete: false, digest: 'partial', provider: 'anilist', truncated: true });
    const result = await runFavoriteResolutionSlice({
      candidates: { anilist: { search: async () => incomplete }, mangaupdates: { search: async () => { throw new Error('not routed'); } } },
      hydration: { anilist: { hydrate: async () => candidate }, mangaupdates: { hydrate: async () => undefined } },
      libraryId: libraryId('library_primary'), now: () => now, outbox, storage, token: () => 'claim-token',
    });

    expect(result).toEqual({ blocked: 0, completed: 0, retried: 1 });
    expect(await storage.getFavoriteResolutionTask(task.id)).toMatchObject({ state: 'RETRY_AT' });
  });
});
