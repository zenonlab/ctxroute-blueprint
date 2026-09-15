import { extractFavoriteSourceEvidence, favoriteManualIdentityKey, favoritePublicReferenceSchema, providerCoverFallbackPath, readLocalReviewCandidates, recordReviewDecision, requestPublicFavoriteDiscovery } from '@tobirink/application';
import type { LocalReviewDecision, PublicDiscoveryRequestClientPort, StoragePort } from '@tobirink/application';
import { anilistSourceAdapter, mangaDexSourceAdapter, mangaUpdatesSourceAdapter } from '@tobirink/adapters-browser';
import { reviewId, workId } from '@tobirink/domain';
import type { LibraryId } from '@tobirink/domain';

export async function readLocalReviewCandidateSnapshot(storage: StoragePort, libraryId: LibraryId, rawReviewId: string) {
  const snapshot = await readLocalReviewCandidates(storage, { libraryId, reviewId: reviewId(rawReviewId) });
  return {
    ...snapshot,
    candidates: snapshot.candidates.map(({ candidate, sourceUrl, work }) => {
      const reference = work.externalReferences[0];
      const coverSrc = candidate?.cover?.url;
      const fallbackPath = candidate === undefined ? undefined : providerCoverFallbackPath(candidate);
      const coverFallbackSrc = fallbackPath === undefined ? undefined : new URL(fallbackPath, 'https://tobirink.com').href;
      return {
        candidateId: work.id,
        coverAlt: coverSrc === undefined ? undefined : `Couverture de ${work.preferredTitle} — ${candidate?.cover?.attribution ?? candidate?.provider ?? 'source'}`,
        coverFallbackSrc,
        coverSrc,
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
  publicDiscovery?: PublicDiscoveryRequestClientPort,
) {
  const decision: LocalReviewDecision = input.decision.kind === 'candidate'
    ? { kind: 'candidate', workId: workId(input.decision.workId) }
    : input.decision;
  const command = { decision, libraryId, reviewId: reviewId(input.reviewId), revision: input.revision };
  if (decision.kind !== 'manual') return recordReviewDecision(storage, command);
  if (publicDiscovery === undefined) throw new Error('Manual provider identity requires Public Discovery.');
  const value = decision.value.trim();
  const explicit = decision.source === 'url'
    ? extractFavoriteSourceEvidence({ sourceKey: input.reviewId, title: 'Manual identity', url: value }, [anilistSourceAdapter, mangaUpdatesSourceAdapter, mangaDexSourceAdapter]).explicitProviderReference
    : undefined;
  const separator = value.indexOf(':');
  const parsedReference = explicit === undefined && separator > 0 && decision.source === 'id'
    ? favoritePublicReferenceSchema.safeParse({ externalId: value.slice(separator + 1), provider: value.slice(0, separator) })
    : undefined;
  const reference = explicit ?? (parsedReference?.success === true ? parsedReference.data : undefined);
  if (reference === undefined) throw new Error('Manual provider identity is invalid.');
  const snapshot = await readLocalReviewCandidates(storage, command);
  if (snapshot.revision !== input.revision) throw new Error('Review decision revision conflict.');
  const source = await storage.findFavoriteSourceByReviewId(command.reviewId);
  const artifact = source === undefined ? undefined : await storage.getFavoriteParseArtifact(source.id);
  if (source === undefined || artifact === undefined) throw new Error('Manual Review artifact is unavailable.');
  const key = await favoriteManualIdentityKey(artifact.artifact, reference);
  const discovery = await requestPublicFavoriteDiscovery(publicDiscovery, key, artifact.artifact, { explicitProviderReference: reference });
  if (discovery.state === 'MISS' || discovery.state === 'PENDING') return { status: 'pending' as const };
  if (discovery.state !== 'VERIFIED'
    || discovery.profile.candidate.provider !== reference.provider
    || discovery.profile.candidate.externalId !== reference.externalId
    || !discovery.profile.references.some((value) => value.provider === reference.provider && value.externalId === reference.externalId)) {
    throw new Error('Manual provider identity is unavailable.');
  }
  return recordReviewDecision(storage, command, undefined, discovery.profile.candidate);
}
