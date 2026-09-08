import { createWork } from '@tobirink/domain';
import type { ReviewId, Work } from '@tobirink/domain';
import type {
  ReviewCandidatePort,
  ReviewRevisionInput,
  ReviewRevisionPort,
  ReviewSourceReferenceParserPort,
} from '../ports/review-candidate-port';
import type { StoragePort } from '../ports/storage-port';

export const reviewCandidateLimit = 6;

export interface ReviewCandidateSnapshot {
  candidates: readonly Work[];
  reviewId: ReviewId;
  revision: string;
  state: 'partial' | 'ready';
  title: string;
}

function hashRevision(value: string, seed: number, backwards = false): string {
  let hash = seed;
  for (let offset = 0; offset < value.length; offset += 1) {
    const index = backwards ? value.length - offset - 1 : offset;
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export const localReviewRevisionPort: ReviewRevisionPort = Object.freeze({
  async createRevision({ candidateDigest, review, source }: ReviewRevisionInput) {
    const payload = JSON.stringify([
      review.id,
      review.status,
      review.availableAt ?? null,
      review.matchedWorkId ?? null,
      review.sourceLabel,
      review.title,
      source.id,
      source.bookmarkId,
      source.folderPath,
      source.importedAt,
      source.order,
      source.presence,
      source.title,
      source.url,
      source.resolution ?? null,
      source.resolutionVersions ?? null,
      candidateDigest ?? null,
    ]);
    return `review-v1-${hashRevision(payload, 0x811c9dc5)}${hashRevision(payload, 0x9e3779b9, true)}`;
  },
});

export async function readReviewCandidates(
  reviewId: ReviewId,
  storage: StoragePort,
  sourceParser: ReviewSourceReferenceParserPort,
  candidatePort: ReviewCandidatePort,
  revisionPort: ReviewRevisionPort = localReviewRevisionPort,
): Promise<ReviewCandidateSnapshot> {
  const context = await storage.transaction(['reviews', 'favoriteSources'], async (session) => ({
    review: await session.getReview(reviewId),
    source: await session.findFavoriteSourceByReviewId(reviewId),
  }));

  if (!context.review || !context.source || context.source.presence !== 'observed') throw new Error('Review candidate context is unavailable.');
  if (context.review.status !== 'pending') throw new Error('Review candidate context is stale.');

  const reference = sourceParser.parse(context.source.url);
  const query = reference
    ? { kind: 'reference' as const, limit: reviewCandidateLimit, reference }
    : { kind: 'title' as const, limit: reviewCandidateLimit, title: context.review.title };
  const candidates = await candidatePort.findCandidates(query);
  if (candidates.length > reviewCandidateLimit) throw new RangeError('Review candidate result exceeds its limit.');

  const validated = candidates.map(createWork);
  if (new Set(validated.map(({ id }) => id)).size !== validated.length) throw new Error('Review candidates must have unique work identities.');
  const frozen = Object.freeze(validated);
  const revision = (await revisionPort.createRevision(Object.freeze({ review: context.review, source: context.source }))).trim();
  if (!revision) throw new Error('Review revision must not be empty.');

  return Object.freeze({
    candidates: frozen,
    reviewId,
    revision,
    state: frozen.length === 0 ? 'partial' : 'ready',
    title: context.review.title,
  });
}
