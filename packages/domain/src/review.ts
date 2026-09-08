import type { ReviewId, WorkId } from './identity';
import { invariant, requiredText } from './invariant';

export type ReviewStatus = 'pending' | 'resolved' | 'no-match';

export interface Review {
  id: ReviewId;
  matchedWorkId?: WorkId;
  reason?: 'AMBIGUOUS' | 'NOT_FOUND';
  decisionOrigin?: 'human' | 'automatic';
  sourceLabel: string;
  status: ReviewStatus;
  title: string;
}

export function createReview(input: Review): Review {
  invariant(input.reason === undefined || input.reason === 'AMBIGUOUS' || input.reason === 'NOT_FOUND', 'invalid-review-resolution', 'Review reason must be actionable.');
  invariant(input.decisionOrigin === undefined || input.decisionOrigin === 'human' || input.decisionOrigin === 'automatic', 'invalid-review-resolution', 'Review decision origin must be human or automatic.');
  const resolved = input.status === 'resolved';
  invariant(resolved === (input.matchedWorkId !== undefined), 'invalid-review-resolution', 'Only a resolved Review has a matched work.');
  return Object.freeze({
    ...input,
    sourceLabel: requiredText(input.sourceLabel, 'sourceLabel'),
    title: requiredText(input.title, 'title'),
  });
}
