import { describe, expect, it, vi } from 'vitest';
import { createFavoriteSource, createLibrary, createReview, createWork, favoriteSourceId, libraryId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { readLocalReviewCandidates } from './read-local-review-candidates';

describe('readLocalReviewCandidates', () => {
  it('keeps a terminal not-found actionable without reading unrelated library entries', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_notfound'), reason: 'NOT_FOUND', sourceLabel: 'Source', status: 'pending', title: 'Synthetic missing title' });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'missing', folderPath: [], id: favoriteSourceId('source_notfound'), importedAt: '2026-09-08T00:00:00.000Z', order: 0, resolution: { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, reviewId: review.id, title: review.title, url: 'https://reader.example/missing' }));
    const libraryRead = vi.spyOn(storage, 'getLibrary').mockRejectedValue(new Error('Unrelated library unavailable'));

    await expect(readLocalReviewCandidates(storage, { libraryId: libraryId('library_unrelated'), reviewId: review.id })).resolves.toMatchObject({ candidates: [], reason: 'NOT_FOUND', state: 'ready' });
    expect(libraryRead).not.toHaveBeenCalled();
  });

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

  it('preserves a persisted provider cover for the Review projection', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_cover_candidate'), reason: 'AMBIGUOUS', sourceLabel: 'Source', status: 'pending', title: 'Synthetic cover' });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'cover', folderPath: [], id: favoriteSourceId('source_cover_candidate'), importedAt: '2026-09-08T00:00:00.000Z', order: 0, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, reviewId: review.id, title: review.title, url: 'https://reader.example/cover' }));
    const candidate = { canonicalUrl: 'https://anilist.co/anime/1', cover: { attribution: 'AniList', height: 600, url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/test.jpg', width: 400 }, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic cover'] };
    await storage.putFavoriteReviewCandidateSet({ candidates: [candidate, { ...candidate, canonicalUrl: 'https://kitsu.app/anime/2', externalId: '2', provider: 'kitsu-anime' }], digest: 'cover-set', recordedAt: '2026-09-08T00:00:00.000Z', reviewId: review.id });
    const snapshot = await readLocalReviewCandidates(storage, { libraryId: libraryId('library_cover_candidate'), reviewId: review.id });
    expect(snapshot.candidates[0]).toMatchObject({ candidate: { cover: { url: candidate.cover.url } } });
  });

  it('hides explicit adult candidates while retaining unknown classification', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_classification'), reason: 'AMBIGUOUS', sourceLabel: 'Source', status: 'pending', title: 'Classification' });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'classification', folderPath: [], id: favoriteSourceId('source_classification'), importedAt: '2026-09-08T00:00:00.000Z', order: 0, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, reviewId: review.id, title: review.title, url: 'https://reader.example/classification' }));
    const candidate = { canonicalUrl: 'https://anilist.co/anime/1', externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Classification'] };
    await storage.putFavoriteReviewCandidateSet({ candidates: [{ ...candidate, contentClassification: 'adult' }, { ...candidate, contentClassification: 'unknown', externalId: '2' }], digest: 'classification-set', recordedAt: '2026-09-08T00:00:00.000Z', reviewId: review.id });
    const snapshot = await readLocalReviewCandidates(storage, { libraryId: libraryId('library_classification'), reviewId: review.id, showAdultContent: false });
    expect(snapshot.candidates.map(({ candidate }) => candidate.contentClassification)).toEqual(['unknown']);
  });
});
