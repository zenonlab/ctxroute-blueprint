import { favoriteSourceId, reviewId } from '@tobirink/domain';
import type { FavoriteSourceId, ReviewId } from '@tobirink/domain';
import { z } from 'zod';

const favoriteResolutionTaskPayloadSchema = z.strictObject({
  reviewId: z.string().min(1),
  semanticFingerprint: z.string().min(1),
  sourceId: z.string().min(1),
});

export interface FavoriteResolutionTaskPayload {
  readonly reviewId: ReviewId;
  readonly semanticFingerprint: string;
  readonly sourceId: FavoriteSourceId;
}

export function encodeFavoriteResolutionTaskPayload(input: FavoriteResolutionTaskPayload): string {
  const parsed = favoriteResolutionTaskPayloadSchema.parse(input);
  return JSON.stringify(parsed);
}

export function parseFavoriteResolutionTaskPayload(value: string): FavoriteResolutionTaskPayload {
  const parsed = favoriteResolutionTaskPayloadSchema.parse(JSON.parse(value));
  return Object.freeze({ reviewId: reviewId(parsed.reviewId), semanticFingerprint: parsed.semanticFingerprint, sourceId: favoriteSourceId(parsed.sourceId) });
}
