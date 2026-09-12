import { z } from 'zod';
import type { FavoriteParseArtifact, FavoriteResolutionVersions } from '@tobirink/domain';
import { favoriteMatcherVersion } from './provider-matcher';

export const favoriteResolutionResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('RESOLVED') }),
  z.strictObject({ kind: z.literal('REVIEW_REQUIRED'), reason: z.enum(['AMBIGUOUS', 'NOT_FOUND']) }),
  z.strictObject({ kind: z.literal('UNSUPPORTED'), reason: z.enum(['IDENTITY_MISSING', 'DETACHED', 'BLOCKED_CONTENT_TAXONOMY']) }),
  z.strictObject({ kind: z.literal('RETRYABLE'), reason: z.enum(['PROVIDER_UNAVAILABLE', 'INCOMPLETE_CANDIDATE_SET', 'AUTOMATIC_ATTEMPT_LIMIT', 'INTERNAL_FAILURE', 'COLLECTIVE_UNAVAILABLE']) }),
]);

export const favoriteResolutionVersionsSchema = z.strictObject({
  decision: z.literal(1),
  matcher: z.string().min(1).max(100),
  parser: z.string().min(1).max(100),
  receipt: z.literal(1),
  schema: z.literal(1),
  siteRules: z.string().min(1).max(100),
});

export function favoriteResolutionVersions(artifact: FavoriteParseArtifact): FavoriteResolutionVersions {
  return favoriteResolutionVersionsSchema.parse({
    decision: 1, matcher: favoriteMatcherVersion, parser: artifact.parserVersion,
    receipt: 1, schema: 1, siteRules: artifact.sourceAdapterVersion,
  });
}
