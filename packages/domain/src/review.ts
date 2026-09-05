import type { ReviewId, WorkId } from './identity';
import { invariant, requiredText } from './invariant';

export type ReviewStatus = 'pending' | 'resolved' | 'no-match';

export interface Review {
  id: ReviewId;
  matchedWorkId?: WorkId;
  sourceLabel: string;
  status: ReviewStatus;
  title: string;
}

export function createReview(input: Review): Review {
  const resolved = input.status === 'resolved';
  invariant(resolved === (input.matchedWorkId !== undefined), 'invalid-review-resolution', 'Only a resolved Review has a matched work.');
  return Object.freeze({
    ...input,
    sourceLabel: requiredText(input.sourceLabel, 'sourceLabel'),
    title: requiredText(input.title, 'title'),
  });
}
