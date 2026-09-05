import { describe, expect, it, vi } from 'vitest';
import {
  createFavoriteSource,
  createReview,
  createWork,
  favoriteSourceId,
  reviewId,
  workId,
} from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { ReviewCandidatePort, ReviewRevisionPort, ReviewSourceReferenceParserPort } from '../ports/review-candidate-port';
import { readReviewCandidates, reviewCandidateLimit } from './read-review-candidates';

const pendingId = reviewId('review_candidates');
const source = createFavoriteSource({
  bookmarkId: 'bookmark-candidates',
  folderPath: ['Manga'],
  id: favoriteSourceId('source_candidates'),
  importedAt: '2026-09-06T10:00:00.000Z',
  order: 1,
  reviewId: pendingId,
  title: 'Frieren chapitre 140',
  url: 'https://reader.example/frieren/140',
});
const work = createWork({ externalReferences: [], id: workId('work_candidate'), mediaKind: 'manga', preferredTitle: 'Frieren' });
const revisions: ReviewRevisionPort = { createRevision: async () => 'revision-candidates-v1' };

async function seededStorage() {
  const storage = new MemoryStoragePort();
  await storage.transaction(['reviews', 'favoriteSources'], async (session) => {
    await session.putReview(createReview({ id: pendingId, sourceLabel: source.url, status: 'pending', title: source.title }));
    await session.putFavoriteSource(source);
  });
  return storage;
}

describe('readReviewCandidates', () => {
  it('joins local context and sends no raw URL to the bounded candidate port', async () => {
    const storage = await seededStorage();
    const sourceParser: ReviewSourceReferenceParserPort = {
      parse: vi.fn(() => ({ externalId: 'frieren-140', provider: 'reader' })),
    };
    const candidatePort: ReviewCandidatePort = { findCandidates: vi.fn(async () => [work]) };

    const snapshot = await readReviewCandidates(pendingId, storage, sourceParser, candidatePort, revisions);

    expect(sourceParser.parse).toHaveBeenCalledWith(source.url);
    expect(candidatePort.findCandidates).toHaveBeenCalledWith({
      kind: 'reference',
      limit: reviewCandidateLimit,
      reference: { externalId: 'frieren-140', provider: 'reader' },
    });
    expect(JSON.stringify(vi.mocked(candidatePort.findCandidates).mock.calls[0]?.[0])).not.toContain(source.url);
    expect(snapshot).toMatchObject({ candidates: [work], reviewId: pendingId, state: 'ready', title: source.title });
    expect(snapshot.revision).toBe('revision-candidates-v1');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.candidates)).toBe(true);
  });

  it('returns a stable partial snapshot when no candidate is available', async () => {
    const storage = await seededStorage();
    const parser: ReviewSourceReferenceParserPort = { parse: () => undefined };
    const findCandidates = vi.fn(async () => []);
    const candidates: ReviewCandidatePort = { findCandidates };

    const first = await readReviewCandidates(pendingId, storage, parser, candidates);
    const second = await readReviewCandidates(pendingId, storage, parser, candidates);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ candidates: [], state: 'partial' });
    expect(first.revision).toMatch(/^review-v1-[a-f0-9]{16}$/u);
    expect(findCandidates).toHaveBeenCalledWith({ kind: 'title', limit: reviewCandidateLimit, title: source.title });

    await storage.putFavoriteSource(createFavoriteSource({ ...source, title: 'Frieren' }));
    const changed = await readReviewCandidates(pendingId, storage, parser, candidates);
    expect(changed.revision).not.toBe(first.revision);
  });

  it('rejects stale, missing, duplicate and over-limit candidate context', async () => {
    const storage = await seededStorage();
    const parser: ReviewSourceReferenceParserPort = { parse: () => undefined };
    const duplicates: ReviewCandidatePort = { findCandidates: async () => [work, work] };
    await expect(readReviewCandidates(pendingId, storage, parser, duplicates, revisions)).rejects.toThrow(/unique work identities/u);

    const tooMany: ReviewCandidatePort = {
      findCandidates: async () => Array.from({ length: reviewCandidateLimit + 1 }, (_, index) => createWork({
        externalReferences: [],
        id: workId(`work_candidate_${index}`),
        mediaKind: 'manga',
        preferredTitle: `Candidate ${index}`,
      })),
    };
    await expect(readReviewCandidates(pendingId, storage, parser, tooMany, revisions)).rejects.toThrow(/exceeds its limit/u);

    await storage.putReview(createReview({ id: pendingId, matchedWorkId: work.id, sourceLabel: source.url, status: 'resolved', title: source.title }));
    await expect(readReviewCandidates(pendingId, storage, parser, { findCandidates: async () => [] }, revisions)).rejects.toThrow(/stale/u);
    await expect(readReviewCandidates(reviewId('review_missing'), storage, parser, { findCandidates: async () => [] }, revisions)).rejects.toThrow(/unavailable/u);
  });
});
