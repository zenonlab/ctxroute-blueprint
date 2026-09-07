import { addWork, createLibrary, createReview, createWork, workId } from '@tobirink/domain';
import type { FavoriteParseArtifact, LibraryId, ProviderCandidate, ProviderCandidateEnvelope, Review } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { commitTask, parseFavoriteResolutionTaskPayload, recordTaskEffect } from '../tasks';
import type { DurableTask, FavoriteResolutionOutboxPort } from '../tasks';
import { hasExactBlockedProviderTaxonomy, isProviderCandidateCompatible, matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { favoriteProviderPolicy, routeFavoriteProviders } from './provider-ports';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, ResolutionProvider } from './provider-ports';

export const favoriteResolutionSliceLimit = 8;
export const favoriteResolutionWakeBudgetMs = 20_000;
export const favoriteResolutionClaimMs = 60_000;
export const favoriteResolutionAttemptLimit = 8;
export const favoriteResolutionMaximumBackoffMs = 6 * 60 * 60 * 1_000;

export interface FavoriteResolutionRunnerDependencies {
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly hydration: Readonly<Record<ResolutionProvider, FavoriteProviderHydrationPort>>;
  readonly libraryId: LibraryId;
  readonly now: () => string;
  readonly outbox: FavoriteResolutionOutboxPort;
  readonly storage: StoragePort;
  readonly token: () => string;
}

export interface FavoriteResolutionSliceResult {
  readonly blocked: number;
  readonly completed: number;
  readonly retried: number;
}

type MutableFavoriteTitleMatchQuery = { -readonly [Key in keyof FavoriteTitleMatchQuery]: FavoriteTitleMatchQuery[Key] };

function timestamp(value: string): number {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) throw new TypeError('Runner clock must return a canonical timestamp.');
  return parsed.valueOf();
}

function providerTitles(artifact: FavoriteParseArtifact): readonly string[] {
  const titles = [artifact.displayTitle, ...(artifact.aliases ?? []).map((alias) => alias.value)]
    .filter((title): title is string => title !== undefined);
  return Object.freeze([...new Set(titles)]);
}

function stableWorkId(candidate: ProviderCandidate) {
  const encoded = [...new TextEncoder().encode(`${candidate.provider}:${candidate.externalId}`)]
    .map((value) => value.toString(16).padStart(2, '0')).join('');
  return workId(`work_${encoded}`);
}

function mediaKind(candidate: ProviderCandidate): 'anime' | 'manga' {
  return candidate.mediaKind === 'ANIME' ? 'anime' : 'manga';
}

function preferredTitle(candidate: ProviderCandidate, fallback: string): string {
  return candidate.titles.find((title) => title.trim().length > 0) ?? fallback;
}

async function complete(
  dependencies: FavoriteResolutionRunnerDependencies,
  task: DurableTask,
  token: string,
  review: Review,
  effect: string,
  candidate?: ProviderCandidate,
): Promise<void> {
  const stores = candidate === undefined ? ['favoriteResolutionTasks', 'reviews'] as const : ['favoriteResolutionTasks', 'libraries', 'reviews', 'works'] as const;
  await dependencies.storage.transaction(stores, async (session) => {
    if (candidate !== undefined) {
      const work = createWork({
        externalReferences: [{ externalId: candidate.externalId, provider: candidate.provider }],
        id: review.matchedWorkId ?? stableWorkId(candidate),
        mediaKind: mediaKind(candidate),
        preferredTitle: preferredTitle(candidate, review.title),
      });
      await session.putWork(work);
      const library = await session.getLibrary(dependencies.libraryId) ?? createLibrary(dependencies.libraryId);
      if (!library.workIds.includes(work.id)) await session.putLibrary(addWork(library, work.id));
    }
    await session.putReview(review);
    await session.putFavoriteResolutionTask(commitTask(recordTaskEffect(task, token, effect), token));
  });
}

function unresolvedReview(review: Review, status: 'no-match' | 'pending'): Review {
  return createReview({ id: review.id, sourceLabel: review.sourceLabel, status, title: review.title });
}

async function retryClaim(
  dependencies: FavoriteResolutionRunnerDependencies,
  task: DurableTask,
  token: string,
  retryAt: string,
): Promise<'blocked' | 'retried'> {
  if (task.attempt >= favoriteResolutionAttemptLimit) {
    await dependencies.outbox.block(task.id, token, 'AUTOMATIC_ATTEMPT_LIMIT');
    return 'blocked';
  }
  await dependencies.outbox.retry(task.id, token, retryAt);
  return 'retried';
}

async function processClaimedTask(dependencies: FavoriteResolutionRunnerDependencies, task: DurableTask, token: string): Promise<'blocked' | 'completed' | 'retried'> {
  const payload = parseFavoriteResolutionTaskPayload(task.payload);
  const [source, record, review] = await Promise.all([
    dependencies.storage.getFavoriteSource(payload.sourceId),
    dependencies.storage.getFavoriteParseArtifact(payload.sourceId),
    dependencies.storage.getReview(payload.reviewId),
  ]);
  if (source === undefined || record === undefined || review === undefined || record.reviewId !== payload.reviewId || record.artifact.semanticFingerprint !== payload.semanticFingerprint) throw new Error('STALE_PRIVATE_REFERENCE');
  if (source.presence === 'detached') {
    await complete(dependencies, task, token, review, 'source:detached');
    return 'completed';
  }
  const artifact = record.artifact;
  if (artifact.status !== 'parsed') {
    await complete(dependencies, task, token, unresolvedReview(review, 'pending'), 'review:identity-missing');
    return 'completed';
  }
  const explicit = artifact.sourceEvidence.explicitProviderReference;
  if (explicit !== undefined && (explicit.provider === 'anilist' || explicit.provider === 'mangaupdates')) {
    const reference = { externalId: explicit.externalId, provider: explicit.provider } as const;
    let candidate: ProviderCandidate | undefined;
    try { candidate = await dependencies.hydration[reference.provider].hydrate(reference); } catch { candidate = undefined; }
    if (candidate === undefined) {
      const retryAt = new Date(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs).toISOString();
      return retryClaim(dependencies, task, token, retryAt);
    }
    if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
    const compatibility = artifact.mediaKind === 'UNKNOWN' ? {} : { mediaKind: artifact.mediaKind };
    if (!isProviderCandidateCompatible({ ...compatibility, sourceTitles: providerTitles(artifact) }, candidate)) {
      await complete(dependencies, task, token, unresolvedReview(review, 'pending'), 'review:explicit-reference-incompatible');
      return 'completed';
    }
    if (hasExactBlockedProviderTaxonomy(candidate)) {
      await complete(dependencies, task, token, unresolvedReview(review, 'no-match'), 'review:blocked-content-taxonomy');
      return 'completed';
    }
    const resolved = createReview({ ...review, matchedWorkId: stableWorkId(candidate), status: 'resolved' });
    await complete(dependencies, task, token, resolved, `resolved:${reference.provider}:${reference.externalId}`, candidate);
    return 'completed';
  }
  const titles = providerTitles(artifact);
  if (titles.length === 0) {
    await complete(dependencies, task, token, unresolvedReview(review, 'pending'), 'review:identity-missing');
    return 'completed';
  }
  const providers = routeFavoriteProviders(artifact.mediaKind);
  const perProviderLimit = Math.floor(20 / providers.length);
  let envelopes: readonly ProviderCandidateEnvelope[];
  try {
    envelopes = await Promise.all(providers.map((provider) => dependencies.candidates[provider].search({ limit: perProviderLimit, provider, titles })));
  } catch {
    const exponent = Math.max(0, task.attempt - 1);
    const retryAt = new Date(timestamp(dependencies.now()) + Math.min(favoriteResolutionMaximumBackoffMs, 30_000 * (2 ** exponent))).toISOString();
    return retryClaim(dependencies, task, token, retryAt);
  }
  const matchQuery: MutableFavoriteTitleMatchQuery = { sourceTitles: titles };
  if (artifact.sourceEvidence.explicitProviderReference !== undefined) matchQuery.explicitProviderReference = artifact.sourceEvidence.explicitProviderReference;
  if (artifact.season !== undefined) matchQuery.explicitSeason = artifact.season;
  if (artifact.mediaKind !== 'UNKNOWN') matchQuery.mediaKind = artifact.mediaKind;
  if (artifact.sourceEvidence.canonicalUrl !== undefined) matchQuery.sourceCanonicalUrl = artifact.sourceEvidence.canonicalUrl;
  const outcome = matchFavoriteTitles(matchQuery, envelopes);
  if (outcome.kind === 'INCOMPLETE_CANDIDATE_SET') {
    const retryAt = new Date(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs).toISOString();
    return retryClaim(dependencies, task, token, retryAt);
  }
  if (outcome.kind === 'AMBIGUOUS') {
    await complete(dependencies, task, token, unresolvedReview(review, 'pending'), `review:${outcome.kind.toLowerCase()}`);
    return 'completed';
  }
  if (outcome.kind === 'NO_MATCH') {
    await complete(dependencies, task, token, unresolvedReview(review, 'no-match'), 'review:no-match');
    return 'completed';
  }
  const provider = outcome.matchedReference.provider;
  if (provider !== 'anilist' && provider !== 'mangaupdates') throw new Error('UNROUTABLE_PROVIDER_REFERENCE');
  let candidate: ProviderCandidate | undefined;
  try { candidate = await dependencies.hydration[provider].hydrate({ externalId: outcome.matchedReference.externalId, provider }); } catch { candidate = undefined; }
  if (candidate === undefined) {
    const retryAt = new Date(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs).toISOString();
    return retryClaim(dependencies, task, token, retryAt);
  }
  if (candidate.provider !== provider || candidate.externalId !== outcome.matchedReference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
  if (hasExactBlockedProviderTaxonomy(candidate)) {
    await complete(dependencies, task, token, unresolvedReview(review, 'no-match'), 'review:blocked-content-taxonomy');
    return 'completed';
  }
  const resolved = createReview({ ...review, matchedWorkId: stableWorkId(candidate), status: 'resolved' });
  await complete(dependencies, task, token, resolved, `resolved:${provider}:${candidate.externalId}`, candidate);
  return 'completed';
}

export async function runFavoriteResolutionSlice(dependencies: FavoriteResolutionRunnerDependencies): Promise<FavoriteResolutionSliceResult> {
  const startedAt = timestamp(dependencies.now());
  let blocked = 0; let completed = 0; let retried = 0;
  for (let index = 0; index < favoriteResolutionSliceLimit; index += 1) {
    const claimedAt = dependencies.now();
    if (timestamp(claimedAt) - startedAt >= favoriteResolutionWakeBudgetMs) break;
    const token = dependencies.token();
    const task = await dependencies.outbox.claimNext({
      claimedAt,
      claimExpiresAt: new Date(timestamp(claimedAt) + favoriteResolutionClaimMs).toISOString(),
      claimToken: token,
      kind: 'favorite-resolution',
      lane: 'routing',
    });
    if (task === undefined) break;
    try {
      const result = await processClaimedTask(dependencies, task, token);
      if (result === 'completed') completed += 1;
      else if (result === 'retried') retried += 1;
      else blocked += 1;
    } catch (error) {
      await dependencies.outbox.block(task.id, token, error instanceof Error ? error.message : 'UNKNOWN_RESOLUTION_FAILURE');
      blocked += 1;
    }
  }
  return Object.freeze({ blocked, completed, retried });
}
