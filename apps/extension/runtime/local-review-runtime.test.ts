import { describe, expect, it, vi } from 'vitest';
import { importFavoriteSources, readLocalReviewCandidates } from '@tobirink/application';
import type { FavoriteProviderHydrationPorts } from '@tobirink/application';
import { MemoryStoragePort } from '@tobirink/contracts';
import { createReview, libraryId, reviewId } from '@tobirink/domain';
import { writeLocalReviewDecision } from './local-review-runtime';

async function fixture() {
  const storage = new MemoryStoragePort();
  const library = libraryId('library_manual');
  await importFavoriteSources([{ bookmarkId: '42', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic voyager', url: 'https://reader.example/manga/voyager' }], storage, '2026-09-08T00:00:00.000Z');
  const [source] = await storage.listFavoriteSources({ limit: 1 });
  if (!source) throw new Error('Expected source.');
  const review = createReview({ id: reviewId('review_manual'), reason: 'NOT_FOUND', sourceLabel: source.url, status: 'pending', title: source.title });
  const terminalSource = { ...source, resolution: { kind: 'REVIEW_REQUIRED' as const, reason: 'NOT_FOUND' as const }, reviewId: review.id };
  await storage.putReview(review);
  await storage.putFavoriteSource(terminalSource);
  const snapshot = await readLocalReviewCandidates(storage, { libraryId: library, reviewId: review.id });
  const hydrate = vi.fn(async () => ({ canonicalUrl: 'https://anilist.co/anime/123', externalId: '123', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic different title'] }));
  const ports: FavoriteProviderHydrationPorts = { anilist: { hydrate }, 'kitsu-anime': { hydrate }, 'kitsu-manga': { hydrate }, mangadex: { hydrate }, mangaupdates: { hydrate } };
  return { hydrate, library, ports, review, snapshot, source: terminalSource, storage };
}

describe('Manual Review provider hydration', () => {
  it.each([{ source: 'id' as const, value: 'anilist:123' }, { source: 'url' as const, value: 'https://anilist.co/anime/123' }])('hydrates an explicit $source without title matching or a pre-existing library', async (manual) => {
    const { hydrate, library, ports, review, snapshot, source, storage } = await fixture();
    const result = await writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', ...manual }, reviewId: review.id, revision: snapshot.revision }, ports);
    expect(hydrate).toHaveBeenCalledExactlyOnceWith({ externalId: '123', provider: 'anilist' });
    expect(result).toMatchObject({ decisionOrigin: 'human', status: 'resolved' });
    expect(await storage.getFavoriteSource(source.id)).toMatchObject({ matchedWorkId: result.matchedWorkId, resolution: { kind: 'RESOLVED' } });
  });

  it('rechecks the private revision after hydration and publishes no partial work', async () => {
    const { hydrate, library, ports, review, snapshot, source, storage } = await fixture();
    hydrate.mockImplementationOnce(async () => {
      await storage.putFavoriteSource({ ...source, title: 'Changed while hydrating' });
      return { canonicalUrl: 'https://anilist.co/anime/123', externalId: '123', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Synthetic different title'] };
    });
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, ports)).rejects.toThrow(/conflict/u);
    expect(await storage.getReview(review.id)).toEqual(review);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('leaves NOT_FOUND actionable during a provider outage', async () => {
    const { hydrate, library, ports, review, snapshot, storage } = await fixture();
    hydrate.mockRejectedValueOnce(new Error('provider timeout'));
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, ports)).rejects.toThrow('provider timeout');
    expect(await storage.getReview(review.id)).toEqual(review);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });
});
