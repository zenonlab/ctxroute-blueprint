import type { ReviewResolverProps } from '../../review/review-resolver';

export const memberNavigationVariants = ['responsive'] as const;
export const memberNavigationStates = ['default', 'reviews'] as const;

export type MemberNavigationVariant = (typeof memberNavigationVariants)[number];
export type MemberNavigationState = (typeof memberNavigationStates)[number];
export type MemberNavigationItemId = 'home' | 'library' | 'agenda';

export interface MemberReviewConfig {
  count: number;
  resolver: ReviewResolverProps;
}
