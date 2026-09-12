import { favoritePublicReferenceSchema } from '../collective-index/favorite-collective-lookup';
import type { ProviderCandidate } from '@tobirink/domain';

export function providerCoverFallbackPath(candidate: Pick<ProviderCandidate, 'provider' | 'externalId'>): string | undefined {
  const reference = favoritePublicReferenceSchema.safeParse({ provider: candidate.provider, externalId: candidate.externalId });
  return reference.success ? `/v1/media/provider-covers/${reference.data.provider}/${reference.data.externalId}/cover-md` : undefined;
}
