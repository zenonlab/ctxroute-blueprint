import { describe, expect, it } from 'vitest';
import { createProviderCandidateEnvelope, libraryId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { claimTask, favoriteSourceIdentity, importFavoriteSources, isTaskAvailable, matchFavoriteTitles, normalizeFavoriteTitle, runFavoriteResolutionSlice } from '@tobirink/application';
import type { FavoriteResolutionOutboxPort, PublicDiscoveryKey } from '@tobirink/application';
import { runPublicDiscoveryBatch, publicDiscoveryKeyV3Schema } from '@tobirink/public-discovery';
import type { PublicDiscoveryClaimedRequest, PublicDiscoveryReadState } from '@tobirink/public-discovery';

function fixture(index: number) {
  const code = String.fromCharCode(97 + Math.floor(index / 676), 97 + Math.floor(index / 26) % 26, 97 + index % 26);
  const title = index % 7 === 6 ? `Synthetic Area 51 ${code}` : `Synthetic Harbor ${code}`;
  const slug = title.toLowerCase().replaceAll(' ', '-');
  const paths = [`manga/${slug}/42`, `anime/${slug}/vostfr`, `manga/${slug}/chapter-7`, `anime/${slug}/episode-8`, `library/${slug}/reader`, `library/zx${100000 + index}`, `manga/${slug}`];
  return { bookmarkId: `corpus-${index}`, folderPath: [], order: index, state: 'eligible' as const, title, url: `https://reader.invalid/${index < 1400 ? paths[index % 7] : `search/${slug}`}` };
}

describe('1532 raw favorite recovery corpus', () => {
  it('converges all 1400 media links through pending, simulated verified publication and restarted local slices', async () => {
    const favorites = Array.from({ length: 1532 }, (_, index) => fixture(index));
    const expected = new Map(favorites.slice(0, 1400).map((favorite, index) => [normalizeFavoriteTitle(favorite.title).normalized, { index, favorite }]));
    const storage = new MemoryStoragePort();
    let clock = '2026-09-18T12:00:00.000Z';
    await importFavoriteSources(favorites, storage, clock);
    expect(await storage.readFavoriteResolutionCounts()).toMatchObject({ observed: 1532, unsupported: 132, processing: 1400 });
    const taskIds = favorites.map(favorite => favoriteSourceIdentity(favorite.bookmarkId).replace(/^source_/u, 'favorite-resolution_'));
    const pending = new Map<string, PublicDiscoveryClaimedRequest>();
    const states = new Map<string, PublicDiscoveryReadState>();
    const id = (key: PublicDiscoveryKey) => JSON.stringify(publicDiscoveryKeyV3Schema.parse(key));
    const publicDiscovery = {
      resolveOrRequest: async (key: PublicDiscoveryKey, query: PublicDiscoveryClaimedRequest['query']): Promise<PublicDiscoveryReadState> => {
        const identity = id(key);
        const existing = states.get(identity);
        if (existing) return existing;
        pending.set(identity, { attempt: 1, key, query, requestDigest: key.fingerprint, schemaVersion: 3 });
        const state = { state: 'PENDING' as const, retryAt: '2026-09-18T12:01:00.000Z' };
        states.set(identity, state); return state;
      },
    };
    const unused = async (): Promise<never> => { throw new Error('Forbidden MV3 provider'); };
    const providers = { anilist: { search: unused, hydrate: unused }, mangaupdates: { search: unused, hydrate: unused }, mangadex: { search: unused, hydrate: unused }, 'kitsu-anime': { search: unused, hydrate: unused }, 'kitsu-manga': { search: unused, hydrate: unused } };
    const drain = async () => {
      let cursor = 0;
      const outbox: FavoriteResolutionOutboxPort = {
        claimNext: async input => {
          while (cursor < taskIds.length) {
            const task = await storage.getFavoriteResolutionTask(taskIds[cursor++]!);
            if (task && isTaskAvailable(task, input.claimedAt)) {
              const claimed = claimTask(task, input.claimToken, input.claimedAt, input.claimExpiresAt);
              await storage.putFavoriteResolutionTask(claimed); return claimed;
            }
          }
          return undefined;
        }, block: unused, retry: unused, nextAvailableAt: async () => undefined,
      };
      for (let slice = 0; slice < 16; slice += 1) {
        // Recreate the runner after each bounded slice; only persisted records survive.
        await runFavoriteResolutionSlice({ candidates: providers, hydration: providers, libraryId: libraryId('library_primary'), now: () => clock, outbox, publicDiscovery, storage, token: () => crypto.randomUUID() });
      }
    };
    await drain();
    expect(pending.size).toBe(1400);
    expect(await storage.readFavoriteResolutionCounts()).toMatchObject({ resolved: 0, publicDiscoveryPending: 1400 });
    let published = 0;
    while (pending.size > 0) {
      const requests = [...pending.values()].slice(0, 20);
      for (const request of requests) pending.delete(id(request.key));
      const report = await runPublicDiscoveryBatch({
        gateway: { claim: async () => ({ claimToken: 'c'.repeat(48), requests, schemaVersion: 3 }), publish: async batch => {
          for (const result of batch.results) {
            if (result.resolution.state !== 'VERIFIED') throw new Error('Unexpected synthetic resolution');
            states.set(id(result.key), { ...result.resolution, verifiedAt: batch.verifiedAt, nextRefreshAt: '2026-09-25T12:00:00.000Z' });
          }
          return { published: batch.results.length, replayed: 0 };
        } }, limit: 20, nonce: () => crypto.randomUUID(), now: () => clock,
        resolver: { resolve: async request => {
          const match = request.query.sourceTitles.map(title => expected.get(normalizeFavoriteTitle(title).normalized)).find(Boolean);
          if (!match) throw new Error('Synthetic identity mismatch');
          const anime = [1, 3].includes(match.index % 7);
          const candidate = { provider: anime ? 'anilist' as const : 'mangaupdates' as const, externalId: String(match.index + 1), mediaKind: anime ? 'ANIME' as const : 'MANGA' as const, titles: [match.favorite.title], preSerialization: false };
          const envelope = createProviderCandidateEnvelope({ candidates: [candidate], complete: true, truncated: false, digest: 'synthetic', provider: candidate.provider });
          expect(matchFavoriteTitles({ sourceTitles: request.query.sourceTitles }, [envelope]).kind).toBe('MATCH');
          return { state: 'VERIFIED', profile: { candidate, references: [{ provider: candidate.provider, externalId: candidate.externalId }], workId: `work_synthetic_${match.index}` } };
        } },
      });
      expect(report.failed).toBe(0); published += report.published;
    }
    expect(published).toBe(1400);
    clock = '2026-09-18T12:01:01.000Z';
    await drain();
    expect(await storage.readFavoriteResolutionCounts()).toMatchObject({ observed: 1532, resolved: 1400, unsupported: 132, processing: 0, retryable: 0, blocked: 0, review: 0 });
    for (const [index, favorite] of favorites.entries()) {
      const source = await storage.getFavoriteSource(favoriteSourceIdentity(favorite.bookmarkId));
      expect(source?.resolution?.kind).toBe(index < 1400 ? 'RESOLVED' : 'UNSUPPORTED');
      if (index < 1400) expect(source?.matchedWorkId).toBe(`work_synthetic_${index}`);
    }
  }, 30_000);
});
