import type { ReviewCandidate, ReviewDecision, ReviewItem } from '@tobirink/ui';

export const reviewVariants = ['resolution'] as const;
export const reviewStates = ['ready', 'loading', 'empty', 'partial', 'offline', 'error', 'conflict'] as const;

export type ReviewVariant = (typeof reviewVariants)[number];
export type ReviewState = (typeof reviewStates)[number];

export type ReviewQueueItem = Pick<ReviewItem, 'id' | 'sourceLabel' | 'title'>;
export type ReviewWorkItem = ReviewItem;
export type { ReviewCandidate, ReviewDecision };
