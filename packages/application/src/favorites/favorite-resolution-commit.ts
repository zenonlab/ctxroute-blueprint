import { addWork, createFavoriteSource, createLibrary, createProgress, createReview, createWork, progressId, reviewId, workId } from '@tobirink/domain';
import type { ExternalReference, FavoriteParseArtifact, FavoriteResolutionResult, LibraryId, Progress, ProviderCandidate, Work, WorkId } from '@tobirink/domain';
import type { FavoriteReviewCandidateSet, StoragePort } from '../ports/storage-port';
import { commitTask, parseFavoriteResolutionTaskPayload, recordTaskEffect } from '../tasks';
import type { DurableTask } from '../tasks';
import { favoriteResolutionResultSchema, favoriteResolutionVersions } from './resolution-result-schema';
import { favoriteArtifactAliasKeys } from './local-favorite-identity';
import { normalizeFavoriteTitle } from './title-normalization';
import { favoritePublicReferenceSchema } from './favorite-identity-lookup';

interface FavoriteResolutionCommitDependencies {
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly storage: StoragePort;
}

interface FavoriteResolvedIdentity {
  readonly workId?: WorkId | undefined;
  readonly hydratedAt?: string | undefined;
  readonly publicDiscovery?: NonNullable<NonNullable<Work['hydration']>['publicDiscovery']>;
  readonly references?: readonly ExternalReference[];
}

export function favoriteCandidateWorkId(candidate: Pick<ProviderCandidate, 'provider' | 'externalId'>) {
  const encoded = [...new TextEncoder().encode(`${candidate.provider}:${candidate.externalId}`)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  return workId(`work_${encoded}`);
}

function resolvedProgress(artifact: FavoriteParseArtifact, candidate: ProviderCandidate, id: WorkId, previous?: Progress): Progress | undefined {
  const observed = artifact.progress;
  if (observed === undefined || previous !== undefined && previous.kind !== observed.kind) return previous;
  const maximum = observed.kind === 'episode' ? candidate.episodeCount : observed.kind === 'chapter' ? candidate.chapterCount : candidate.volumeCount;
  const value = Math.max(previous?.value ?? 0, observed.value);
  const boundedMaximum = maximum !== undefined && maximum >= value ? maximum : previous?.maximum !== undefined && previous.maximum >= value ? previous.maximum : undefined;
  const base = { id: previous?.id ?? progressId(`progress_favorite_${id.slice('work_'.length)}`), kind: observed.kind, value, workId: id };
  return createProgress(boundedMaximum === undefined ? base : { ...base, maximum: boundedMaximum });
}

export async function persistFavoriteResolutionCompletion(
  dependencies: FavoriteResolutionCommitDependencies,
  task: DurableTask,
  token: string,
  result: FavoriteResolutionResult,
  effect: string,
  candidate?: ProviderCandidate,
  candidateSet?: Omit<FavoriteReviewCandidateSet, 'reviewId'>,
  identity?: FavoriteResolvedIdentity,
): Promise<void> {
  const resolution = favoriteResolutionResultSchema.parse(result);
  if (candidateSet?.references !== undefined && candidateSet.references.length > 10) throw new Error('REVIEW_REFERENCE_LIMIT');
  const references = candidateSet?.references?.map((reference) => favoritePublicReferenceSchema.parse(reference));
  const comparableReferences = references === undefined ? undefined
    : [...new Map(references.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
  const compared = candidateSet === undefined ? undefined
    : comparableReferences === undefined ? candidateSet : { ...candidateSet, references: comparableReferences };
  await dependencies.storage.transaction([
    'favoriteArtifacts', 'favoriteSources', 'favoriteResolutionReceipts',
    'favoriteResolutionTasks', 'favoriteReviewCandidateSets', 'libraries', 'progress', 'reviews', 'works',
  ], async (session) => {
    const payload = parseFavoriteResolutionTaskPayload(task.payload);
    const source = await session.getFavoriteSource(payload.sourceId);
    const record = await session.getFavoriteParseArtifact(payload.sourceId);
    const currentTask = await session.getFavoriteResolutionTask(task.id);
    if (!source || !record || record.artifact.semanticFingerprint !== payload.semanticFingerprint
      || currentTask?.claimToken !== token || currentTask.state !== 'CLAIMED'
      || currentTask.idempotencyKey !== task.idempotencyKey
      || currentTask.claimExpiresAt === undefined || currentTask.claimExpiresAt <= dependencies.now()) throw new Error('STALE_PRIVATE_REFERENCE');
    const existingReview = source.reviewId === undefined ? undefined : await session.getReview(source.reviewId);
    const protectedDecision = existingReview !== undefined && existingReview.status !== 'pending';
    const versions = favoriteResolutionVersions(record.artifact);
    if (!protectedDecision) {
      let updated = createFavoriteSource({ ...source, resolution, resolutionVersions: versions });
      if (resolution.kind === 'RESOLVED') {
        if (!candidate || source.presence !== 'observed') throw new Error('RESOLVED_REQUIRES_CURRENT_CANDIDATE');
        const id = identity?.workId ?? favoriteCandidateWorkId(candidate);
        const previous = await session.getWork(id);
        const identities = [{ provider: candidate.provider, externalId: candidate.externalId }, ...(candidate.linkedReferences ?? [])];
        if (identity?.workId !== undefined && previous !== undefined && !previous.externalReferences.some(reference => identities.some(value => value.provider === reference.provider && value.externalId === reference.externalId))) throw new Error('STALE_WORK_IDENTITY');
        const favoriteAliasKeys = [...new Set([...(previous?.hydration?.matcherVersion === versions.matcher ? previous.hydration.favoriteAliasKeys : []), ...favoriteArtifactAliasKeys(record.artifact, candidate)])].slice(0, 64);
        const publicDiscovery = identity?.publicDiscovery ?? previous?.hydration?.publicDiscovery;
        const hydration = publicDiscovery === undefined
          ? { candidate, favoriteAliasKeys, hydratedAt: identity?.hydratedAt ?? dependencies.now(), matcherVersion: versions.matcher, providerTitleKeys: [...new Set(candidate.titles.map((title) => normalizeFavoriteTitle(title).normalized))] }
          : { candidate, favoriteAliasKeys, hydratedAt: identity?.hydratedAt ?? dependencies.now(), matcherVersion: versions.matcher, providerTitleKeys: [...new Set(candidate.titles.map((title) => normalizeFavoriteTitle(title).normalized))], publicDiscovery };
        const work = createWork({
          externalReferences: [...new Map([...(previous?.externalReferences ?? []), ...(identity?.references ?? []), ...(candidate.linkedReferences ?? []), { externalId: candidate.externalId, provider: candidate.provider }].map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()],
          hydration,
          id,
          mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
          preferredTitle: candidate.displayTitle ?? candidate.titles.find((title) => title.trim().length > 0) ?? source.title,
        });
        await session.putWork(work);
        const progress = resolvedProgress(record.artifact, candidate, work.id, await session.findProgressByWorkId(work.id));
        if (progress !== undefined) await session.putProgress(progress);
        const library = await session.getLibrary(dependencies.libraryId) ?? createLibrary(dependencies.libraryId);
        if (!library.workIds.includes(work.id)) await session.putLibrary(addWork(library, work.id));
        updated = createFavoriteSource({ ...updated, matchedWorkId: work.id });
        if (existingReview) await session.putReview(createReview({ ...existingReview, decisionOrigin: 'automatic', matchedWorkId: work.id, status: 'resolved' }));
      } else if (resolution.kind === 'REVIEW_REQUIRED') {
        if (source.presence !== 'observed') throw new Error('STALE_PRIVATE_REFERENCE');
        const comparableIdentities = new Set([...(compared?.candidates ?? []), ...(compared?.references ?? [])].map((candidate) => `${candidate.provider}:${candidate.externalId}`));
        if (resolution.reason === 'AMBIGUOUS' && (compared === undefined || (compared.totalCandidates ?? comparableIdentities.size) < 2 || comparableIdentities.size < 2)) throw new Error('AMBIGUOUS_REVIEW_REQUIRES_COMPARABLE_IDENTITIES');
        if (resolution.reason === 'UNCONFIRMED_SEASON' && (record.artifact.mediaKind !== 'ANIME' || record.artifact.season === undefined || record.artifact.seasonEvidence?.conflict === true || comparableIdentities.size < 1)) throw new Error('UNCONFIRMED_SEASON_REQUIRES_CANDIDATE');
        const id = source.reviewId ?? reviewId(`review_${source.id.slice('source_'.length)}`);
        await session.putReview(createReview({ id, reason: resolution.reason, sourceLabel: source.url, status: 'pending', title: source.title }));
        const persisted = compared ?? { candidates: [], digest: `${record.artifact.semanticFingerprint}:${effect}`, provenance: effect, recordedAt: dependencies.now(), totalCandidates: 0 };
        await session.putFavoriteReviewCandidateSet({ ...persisted, reviewId: id });
        updated = createFavoriteSource({ ...updated, reviewId: id });
      }
      await session.putFavoriteSource(updated);
    }
    await session.putFavoriteResolutionTask(commitTask(recordTaskEffect(currentTask, token, effect), token));
    await session.putFavoriteResolutionReceipt({
      completedAt: dependencies.now(), effectDigest: protectedDecision ? 'decision:preserved' : effect,
      id: `${payload.sourceId}:favorite-resolution`, idempotencyKey: task.idempotencyKey,
      sourceId: payload.sourceId, versions,
    });
  });
}
