import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createLibrary, createReview, createWork, favoriteSourceId, libraryId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { readLocalReviewCandidates } from './read-local-review-candidates';

describe('readLocalReviewCandidates', () => {
  it('returns only title matches backed by a resolved local HTTP source', async () => {
    const storage = new MemoryStoragePort();
    const library = libraryId('library_candidates');
    const pending = createReview({ id: reviewId('review_pending-candidate'), sourceLabel: 'Source', status: 'pending', title: 'Frieren' });
    const pendingSource = createFavoriteSource({ bookmarkId: 'pending', folderPath: [], id: favoriteSourceId('source_pending-candidate'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: pending.id, title: pending.title, url: 'https://reader.example/pending' });
    const work = createWork({ externalReferences: [{ externalId: '154587', provider: 'anilist' }], id: workId('work_frieren-candidate'), mediaKind: 'anime', preferredTitle: 'Frieren' });
    const resolved = createReview({ id: reviewId('review_resolved-candidate'), matchedWorkId: work.id, sourceLabel: 'Source', status: 'resolved', title: work.preferredTitle });
    const resolvedSource = createFavoriteSource({ bookmarkId: 'resolved', folderPath: [], id: favoriteSourceId('source_resolved-candidate'), importedAt: '2026-09-06T00:00:00.000Z', order: 1, reviewId: resolved.id, title: resolved.title, url: 'https://reader.example/frieren' });
    await storage.transaction(['favoriteSources', 'libraries', 'reviews', 'works'], async (session) => {
      await session.putLibrary(createLibrary(library, [work.id]));
      await session.putWork(work);
      await session.putReview(pending);
      await session.putReview(resolved);
      await session.putFavoriteSource(pendingSource);
      await session.putFavoriteSource(resolvedSource);
    });

    await expect(readLocalReviewCandidates(storage, { libraryId: library, reviewId: pending.id })).resolves.toMatchObject({
      candidates: [{ sourceUrl: resolvedSource.url, work: { id: work.id } }],
      reviewId: pending.id,
      state: 'ready',
    });
  });
});
