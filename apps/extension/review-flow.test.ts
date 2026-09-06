import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createLibrary, createReview, createWork, favoriteSourceId, libraryId, reviewId, workId } from '../../packages/domain/src';
import { MemoryStoragePort } from '../../packages/contracts/src/memory-storage-port';
import { applyReviewDecision, resolveFavorite } from '../../packages/application/src/resolution';
import { readLocalReviewCandidates, readReviewQueue, recordReviewDecision, searchLocalLibrary } from '../../packages/application/src';
import { normalizeBookmarks } from '../../packages/adapters-browser/src';

describe('review-flow', () => {
  it('persists every import state and enriches only resolved decisions', async () => {
    const storage = new MemoryStoragePort();
    const enriched: string[] = [];
    const enrichment = { enrich: async (work: { id: string }) => { enriched.push(work.id); } };
    const favorites = normalizeBookmarks([
      { bookmarkId: 'certain-1', folderPath: ['Anime'], order: 0, title: 'Certain', url: 'https://example.test/certain' },
      { bookmarkId: 'ambiguous-1', folderPath: ['Manga'], order: 1, title: 'Ambiguous', url: 'https://example.test/ambiguous' },
      { bookmarkId: 'offline-1', folderPath: ['Manga'], order: 2, title: 'Offline', url: 'https://example.test/offline' },
      { bookmarkId: 'ignored-1', folderPath: [], order: 3, title: 'Folder', url: 'chrome://bookmarks' },
    ]);
    const certainWork = createWork({ externalReferences: [], id: workId('work_certain1'), mediaKind: 'anime', preferredTitle: 'Certain' });
    const resolver = { resolve: async (favorite: { title: string }) => favorite.title === 'Certain' ? { kind: 'certain' as const, work: certainWork } : favorite.title === 'Ambiguous' ? { kind: 'ambiguous' as const } : { kind: 'unavailable' as const } };
    const results = [];
    for (const favorite of favorites) results.push(await resolveFavorite(favorite, storage, resolver, enrichment));
    expect(results.map((result) => result.state)).toEqual(['resolved', 'review-required', 'unavailable', 'ignored']);
    const pending = results[1]?.review;
    expect(pending && await storage.getReview(pending.id)).toEqual(pending);
    expect(enriched).toEqual([certainWork.id]);
    const selected = createWork({ externalReferences: [], id: workId('work_selected1'), mediaKind: 'manga', preferredTitle: 'Selected' });
    if (!pending) throw new Error('Expected a persistent Review.');
    await applyReviewDecision(pending, selected, storage, enrichment);
    expect((await storage.getReview(pending.id))?.status).toBe('resolved');
    expect(enriched).toEqual([certainWork.id, selected.id]);
  });

  it('searches locally, presents a verifiable candidate and advances after one atomic decision', async () => {
    const storage = new MemoryStoragePort();
    const library = libraryId('library_primary');
    const work = createWork({ externalReferences: [{ externalId: '154587', provider: 'anilist' }], id: workId('work_review-flow'), mediaKind: 'anime', preferredTitle: 'Frieren' });
    const pending = createReview({ id: reviewId('review_pending-flow'), sourceLabel: 'Source', status: 'pending', title: 'Frieren' });
    const pendingSource = createFavoriteSource({ bookmarkId: 'pending', folderPath: [], id: favoriteSourceId('source_pending-flow'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: pending.id, title: pending.title, url: 'https://reader.example/pending' });
    const verified = createReview({ id: reviewId('review_verified-flow'), matchedWorkId: work.id, sourceLabel: 'Source', status: 'resolved', title: work.preferredTitle });
    const verifiedSource = createFavoriteSource({ bookmarkId: 'verified', folderPath: [], id: favoriteSourceId('source_verified-flow'), importedAt: '2026-09-06T00:00:00.000Z', order: 1, reviewId: verified.id, title: verified.title, url: 'https://reader.example/frieren' });
    await storage.transaction(['favoriteSources', 'libraries', 'reviews', 'works'], async (session) => {
      await session.putLibrary(createLibrary(library, [work.id]));
      await session.putWork(work);
      await session.putReview(pending);
      await session.putReview(verified);
      await session.putFavoriteSource(pendingSource);
      await session.putFavoriteSource(verifiedSource);
    });

    await expect(searchLocalLibrary(storage, { libraryId: library, query: 'frieren' })).resolves.toMatchObject({ items: [{ id: work.id }] });
    const candidates = await readLocalReviewCandidates(storage, { libraryId: library, reviewId: pending.id });
    expect(candidates).toMatchObject({ candidates: [{ sourceUrl: verifiedSource.url, work: { id: work.id } }], state: 'ready' });
    await recordReviewDecision(storage, { decision: { kind: 'candidate', workId: work.id }, libraryId: library, reviewId: pending.id, revision: candidates.revision });
    await expect(readReviewQueue(storage)).resolves.toEqual({ items: [], status: 'pending' });
  });
});
