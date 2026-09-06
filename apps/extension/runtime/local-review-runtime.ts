import { readLocalReviewCandidates, recordReviewDecision } from '@tobirink/application';
import type { LocalReviewDecision, StoragePort } from '@tobirink/application';
import { reviewId, workId } from '@tobirink/domain';
import type { LibraryId } from '@tobirink/domain';

export async function readLocalReviewCandidateSnapshot(storage: StoragePort, libraryId: LibraryId, rawReviewId: string) {
  const snapshot = await readLocalReviewCandidates(storage, { libraryId, reviewId: reviewId(rawReviewId) });
  return {
    ...snapshot,
    candidates: snapshot.candidates.map(({ sourceUrl, work }) => {
      const reference = work.externalReferences[0];
      return {
        candidateId: work.id,
        href: sourceUrl,
        mediaType: work.mediaKind,
        provider: reference?.provider ?? work.mediaKind,
        providerId: reference?.externalId ?? work.id,
        title: work.preferredTitle,
      };
    }),
  };
}

export async function writeLocalReviewDecision(
  storage: StoragePort,
  libraryId: LibraryId,
  input: { decision: { kind: 'candidate'; workId: string } | { kind: 'manual'; source: 'id' | 'url'; value: string } | { kind: 'none' }; reviewId: string; revision: string },
) {
  const decision: LocalReviewDecision = input.decision.kind === 'candidate'
    ? { kind: 'candidate', workId: workId(input.decision.workId) }
    : input.decision;
  return recordReviewDecision(storage, { decision, libraryId, reviewId: reviewId(input.reviewId), revision: input.revision });
}
