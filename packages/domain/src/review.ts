import type { ReviewId, WorkId } from './identity';
import { canonicalDateTime, invariant, requiredText } from './invariant';

export type ReviewStatus = 'pending' | 'resolved' | 'no-match';

export interface Review {
  availableAt?: string;
  id: ReviewId;
  matchedWorkId?: WorkId;
  reason?: 'AMBIGUOUS' | 'NOT_FOUND' | 'UNCONFIRMED_SEASON';
  decisionOrigin?: 'human' | 'automatic';
  sourceLabel: string;
  status: ReviewStatus;
  title: string;
}

export function createReview(input: Review): Review {
  if (input.availableAt !== undefined) canonicalDateTime(input.availableAt, 'review.availableAt');
  invariant(input.reason === undefined || input.reason === 'AMBIGUOUS' || input.reason === 'NOT_FOUND' || input.reason === 'UNCONFIRMED_SEASON', 'invalid-review-resolution', 'Review reason must be actionable.');
  invariant(input.decisionOrigin === undefined || input.decisionOrigin === 'human' || input.decisionOrigin === 'automatic', 'invalid-review-resolution', 'Review decision origin must be human or automatic.');
  const resolved = input.status === 'resolved';
  invariant(resolved === (input.matchedWorkId !== undefined), 'invalid-review-resolution', 'Only a resolved Review has a matched work.');
  const review = {
    ...input,
    sourceLabel: requiredText(input.sourceLabel, 'sourceLabel'),
    title: requiredText(input.title, 'title'),
  };
  if (input.reason !== undefined && input.status === 'pending') review.availableAt = input.availableAt ?? '1970-01-01T00:00:00.000Z';
  return Object.freeze(review);
}
