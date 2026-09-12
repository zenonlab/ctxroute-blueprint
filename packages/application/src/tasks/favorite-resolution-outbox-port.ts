import type { DurableTask } from './task-state';

export interface FavoriteResolutionClaim {
  readonly claimedAt: string;
  readonly claimExpiresAt: string;
  readonly claimToken: string;
  readonly kind: 'favorite-resolution';
  readonly lane: string;
}

export interface FavoriteResolutionOutboxPort {
  block(id: string, token: string, reason: string): Promise<DurableTask>;
  claimNext(claim: FavoriteResolutionClaim): Promise<DurableTask | undefined>;
  compactCommitted?(input: { before: string; limit: number }): Promise<number>;
  nextAvailableAt?(query: Pick<FavoriteResolutionClaim, 'kind' | 'lane'>): Promise<string | undefined>;
  retry(id: string, token: string, retryAt: string): Promise<DurableTask>;
}
