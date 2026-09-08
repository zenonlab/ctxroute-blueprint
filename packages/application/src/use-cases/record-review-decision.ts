import { addWork, createFavoriteSource, createLibrary, createReview, createWork } from '@tobirink/domain';
import type { LibraryId, ProviderCandidate, Review, ReviewId, WorkId } from '@tobirink/domain';
import type { ReviewRevisionPort } from '../ports/review-candidate-port';
import type { StoragePort, StorageSession } from '../ports/storage-port';
import { localReviewRevisionPort } from './read-review-candidates';
import { normalizeLocalSearch } from './search-local-library';
import { favoriteCandidateWorkId } from '../favorites/favorite-resolution-commit';
import { favoriteArtifactAliasKeys } from '../favorites/local-favorite-identity';
import { favoriteResolutionVersions } from '../favorites/resolution-result-schema';
import { normalizeFavoriteTitle } from '../favorites/title-normalization';

export type LocalReviewDecision =
  | { kind: 'candidate'; workId: WorkId }
  | { kind: 'manual'; source: 'id' | 'url'; value: string }
  | { kind: 'defer' }
  | { kind: 'none' };

async function resolveManualWork(
  session: StorageSession,
  libraryId: LibraryId,
  decision: Extract<LocalReviewDecision, { kind: 'manual' }>,
): Promise<WorkId> {
  const library = await session.getLibrary(libraryId);
  if (!library) throw new Error('Review candidate is no longer available.');
  if (library.workIds.length > 500) throw new Error('Manual identity requires an explicit provider reference.');
  const allowed = new Set(library.workIds.slice(0, 500));
  const matches: WorkId[] = [];
  if (decision.source === 'id') {
    for (const id of allowed) {
      const work = await session.getWork(id);
      if (work?.externalReferences.some(({ externalId }) => externalId === decision.value.trim())) matches.push(id);
    }
  } else {
    const sources = await session.listFavoriteSources({ limit: 100 });
    if (sources.length === 100) throw new Error('Manual URL requires an exact provider reference.');
    for (const source of sources) {
      if (source.presence !== 'observed') continue;
      if (source.url !== decision.value.trim()) continue;
      const review = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
      const matchedWorkId = source.matchedWorkId ?? review?.matchedWorkId;
      if (matchedWorkId && allowed.has(matchedWorkId)) matches.push(matchedWorkId);
    }
  }
  const unique = [...new Set(matches)];
  if (unique.length !== 1 || !unique[0]) throw new Error('Manual Review candidate is unavailable or ambiguous.');
  return unique[0];
}

async function hasResolvedHttpSource(session: StorageSession, workId: WorkId): Promise<boolean> {
  const sources = await session.listFavoriteSourcesByWorkId({ limit: 100, workId });
  if (sources.some((source) => source.presence === 'observed' && /^https?:\/\//iu.test(source.url))) return true;
  const reviews = await session.listReviewsByWorkId({ limit: 100, workId });
  for (const review of reviews) {
    const source = await session.findFavoriteSourceByReviewId(review.id);
    if (!source || source.presence !== 'observed') continue;
    try {
      const url = new URL(source.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function recordReviewDecision(
  storage: StoragePort,
  input: { decision: LocalReviewDecision; libraryId: LibraryId; reviewId: ReviewId; revision: string },
  revisionPort: ReviewRevisionPort = localReviewRevisionPort,
  preparedCandidate?: ProviderCandidate,
): Promise<Review> {
  return storage.transaction(['favoriteArtifacts', 'favoriteResolutionReceipts', 'favoriteReviewCandidateSets', 'favoriteSources', 'libraries', 'reviews', 'works'], async (session) => {
    const review = await session.getReview(input.reviewId);
    const source = await session.findFavoriteSourceByReviewId(input.reviewId);
    if (!review || !source || source.presence !== 'observed' || review.status !== 'pending') throw new Error('Review decision context is stale.');
    if (review.reason !== undefined && source.resolution?.kind !== 'REVIEW_REQUIRED') throw new Error('Review decision context is stale.');
    const compared = await session.getFavoriteReviewCandidateSet(review.id);
    const artifact = await session.getFavoriteParseArtifact(source.id);
    const currentRevision = await revisionPort.createRevision({ candidateDigest: compared?.digest, review, source });
    if (currentRevision !== input.revision) throw new Error('Review decision revision conflict.');

    let resolved: Review;
    if (input.decision.kind === 'defer') {
      resolved = createReview({ ...review, availableAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() });
    } else if (input.decision.kind !== 'none') {
      const selectedWorkId = input.decision.kind === 'manual' && preparedCandidate !== undefined ? favoriteCandidateWorkId(preparedCandidate) : input.decision.kind === 'candidate'
        ? input.decision.workId
        : await resolveManualWork(session, input.libraryId, input.decision);
      const selected = input.decision.kind === 'manual' ? preparedCandidate : compared?.candidates.find((candidate) => favoriteCandidateWorkId(candidate) === selectedWorkId);
      let work = await session.getWork(selectedWorkId);
      const library = await session.getLibrary(input.libraryId) ?? createLibrary(input.libraryId);
      if (selected) {
        if (!artifact) throw new Error('Review artifact is no longer available.');
        const versions = favoriteResolutionVersions(artifact.artifact);
        work = createWork({
          externalReferences: [...new Map([...(work?.externalReferences ?? []), { externalId: selected.externalId, provider: selected.provider }].map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()],
          hydration: { candidate: selected, favoriteAliasKeys: [...new Set([...(work?.hydration?.matcherVersion === versions.matcher ? work.hydration.favoriteAliasKeys : []), ...favoriteArtifactAliasKeys(artifact.artifact)])].slice(0, 64), hydratedAt: preparedCandidate === undefined ? compared?.recordedAt ?? source.importedAt : new Date().toISOString(), matcherVersion: versions.matcher, providerTitleKeys: [...new Set(selected.titles.map((title) => normalizeFavoriteTitle(title).normalized))].slice(0, 16) },
          id: selectedWorkId,
          mediaKind: selected.mediaKind === 'ANIME' ? 'anime' : 'manga',
          preferredTitle: selected.titles[0] ?? selected.externalId,
        });
      }
      const title = normalizeLocalSearch(review.title);
      const candidateTitle = work ? normalizeLocalSearch(work.preferredTitle) : '';
      const titleMatches = candidateTitle.includes(title) || title.includes(candidateTitle);
      const candidateVerified = selected !== undefined || input.decision.kind === 'manual' || await hasResolvedHttpSource(session, selectedWorkId);
      if (!work || (!selected && (!library.workIds.includes(work.id) || (input.decision.kind === 'candidate' && !titleMatches))) || !candidateVerified) throw new Error('Review candidate is no longer available.');
      if (compared && input.decision.kind === 'candidate' && !selected) throw new Error('Review candidate was not in the compared set.');
      await session.putWork(work);
      if (!library.workIds.includes(work.id)) await session.putLibrary(addWork(library, work.id));
      await session.putFavoriteSource(createFavoriteSource({ ...source, matchedWorkId: work.id, resolution: { kind: 'RESOLVED' } }));
      resolved = createReview({ ...review, decisionOrigin: 'human', matchedWorkId: work.id, status: 'resolved' });
    } else {
      resolved = createReview({ ...review, decisionOrigin: 'human', status: 'no-match' });
      const { matchedWorkId: _work, ...unmatched } = source;
      await session.putFavoriteSource(createFavoriteSource(unmatched));
    }
    await session.putReview(resolved);
    const receipt = { completedAt: new Date().toISOString(), effectDigest: `human:${resolved.status}`, id: `${source.id}:human:${input.revision}`, idempotencyKey: `${source.id}:human:${input.revision}`, sourceId: source.id };
    await session.putFavoriteResolutionReceipt(artifact === undefined ? receipt : { ...receipt, versions: favoriteResolutionVersions(artifact.artifact) });
    return resolved;
  });
}
