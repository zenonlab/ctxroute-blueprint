import { extractFavoriteSourceEvidence, readLocalReviewCandidates, recordReviewDecision } from '@tobirink/application';
import type { FavoriteProviderHydrationPorts, LocalReviewDecision, StoragePort } from '@tobirink/application';
import { anilistSourceAdapter, mangaDexSourceAdapter, mangaUpdatesSourceAdapter } from '@tobirink/adapters-browser';
import { z } from 'zod';
import { reviewId, workId } from '@tobirink/domain';
import type { LibraryId } from '@tobirink/domain';

const manualReferenceSchema = z.strictObject({ externalId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/u), provider: z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']) });

export async function readLocalReviewCandidateSnapshot(storage: StoragePort, libraryId: LibraryId, rawReviewId: string) {
  const snapshot = await readLocalReviewCandidates(storage, { libraryId, reviewId: reviewId(rawReviewId) });
  return {
    ...snapshot,
    candidates: snapshot.candidates.map(({ sourceUrl, work }) => {
      const reference = work.externalReferences[0];
      return {
        candidateId: work.id,
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
  input: { decision: { kind: 'candidate'; workId: string } | { kind: 'manual'; source: 'id' | 'url'; value: string } | { kind: 'none' } | { kind: 'defer' }; reviewId: string; revision: string },
  hydration?: FavoriteProviderHydrationPorts,
) {
  const decision: LocalReviewDecision = input.decision.kind === 'candidate'
    ? { kind: 'candidate', workId: workId(input.decision.workId) }
    : input.decision;
  const command = { decision, libraryId, reviewId: reviewId(input.reviewId), revision: input.revision };
  if (decision.kind !== 'manual' || hydration === undefined) return recordReviewDecision(storage, command);
  const value = decision.value.trim();
  const explicit = decision.source === 'url'
    ? extractFavoriteSourceEvidence({ sourceKey: input.reviewId, title: 'Manual identity', url: value }, [anilistSourceAdapter, mangaUpdatesSourceAdapter, mangaDexSourceAdapter]).explicitProviderReference
    : undefined;
  const separator = value.indexOf(':');
  const reference = explicit ?? (separator > 0 && decision.source === 'id' ? manualReferenceSchema.parse({ externalId: value.slice(separator + 1), provider: value.slice(0, separator) }) : undefined);
  if (reference === undefined) return recordReviewDecision(storage, command);
  const snapshot = await readLocalReviewCandidates(storage, command);
  if (snapshot.revision !== input.revision) throw new Error('Review decision revision conflict.');
  const candidate = await hydration[reference.provider]?.hydrate(reference);
  if (!candidate || candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('Manual provider identity is unavailable.');
  return recordReviewDecision(storage, command, undefined, candidate);
}
