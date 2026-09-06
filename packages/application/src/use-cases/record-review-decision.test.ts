import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createLibrary, createReview, createWork, favoriteSourceId, libraryId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { localReviewRevisionPort } from './read-review-candidates';
import { recordReviewDecision } from './record-review-decision';

async function fixture() {
  const storage = new MemoryStoragePort();
  const review = createReview({ id: reviewId('review_decision'), sourceLabel: 'Source', status: 'pending', title: 'Frieren' });
  const source = createFavoriteSource({ bookmarkId: 'bookmark-1', folderPath: [], id: favoriteSourceId('source_decision'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: review.title, url: 'https://reader.example/frieren' });
  const work = createWork({ externalReferences: [], id: workId('work_decision'), mediaKind: 'anime', preferredTitle: review.title });
  const library = createLibrary(libraryId('library_decision'), [work.id]);
  const verifiedReview = createReview({ id: reviewId('review_verified-decision'), matchedWorkId: work.id, sourceLabel: 'Source', status: 'resolved', title: work.preferredTitle });
  const verifiedSource = createFavoriteSource({ bookmarkId: 'bookmark-verified', folderPath: [], id: favoriteSourceId('source_verified-decision'), importedAt: '2026-09-06T00:00:00.000Z', order: 1, reviewId: verifiedReview.id, title: verifiedReview.title, url: 'https://reader.example/verified' });
  await storage.transaction(['favoriteSources', 'libraries', 'reviews', 'works'], async (session) => {
    await session.putReview(review);
    await session.putReview(verifiedReview);
    await session.putFavoriteSource(source);
    await session.putFavoriteSource(verifiedSource);
    await session.putWork(work);
    await session.putLibrary(library);
  });
  const revision = await localReviewRevisionPort.createRevision({ review, source });
  return { library, review, revision, storage, work };
}

describe('recordReviewDecision', () => {
  it('atomically resolves a fresh local candidate', async () => {
    const { library, review, revision, storage, work } = await fixture();
    await expect(recordReviewDecision(storage, { decision: { kind: 'candidate', workId: work.id }, libraryId: library.id, reviewId: review.id, revision })).resolves.toMatchObject({ matchedWorkId: work.id, status: 'resolved' });
  });

  it('rejects stale decisions without modifying the Review', async () => {
    const { library, review, storage, work } = await fixture();
    await expect(recordReviewDecision(storage, { decision: { kind: 'candidate', workId: work.id }, libraryId: library.id, reviewId: review.id, revision: 'stale' })).rejects.toThrow(/conflict/u);
    await expect(storage.getReview(review.id)).resolves.toEqual(review);
  });

  it('records an explicit no-match decision', async () => {
    const { library, review, revision, storage } = await fixture();
    await expect(recordReviewDecision(storage, { decision: { kind: 'none' }, libraryId: library.id, reviewId: review.id, revision })).resolves.toMatchObject({ status: 'no-match' });
  });

  it('resolves a unique local provider identifier entered manually', async () => {
    const { library, review, revision, storage, work } = await fixture();
    await storage.putWork(createWork({ ...work, externalReferences: [{ externalId: '154587', provider: 'anilist' }] }));
    await expect(recordReviewDecision(storage, { decision: { kind: 'manual', source: 'id', value: '154587' }, libraryId: library.id, reviewId: review.id, revision })).resolves.toMatchObject({ matchedWorkId: work.id, status: 'resolved' });
  });
});
