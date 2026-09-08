import { createFavoriteSource } from '@tobirink/domain';
import type { FavoriteParseArtifact, LibraryId, ProviderCandidate, ProviderCandidateEnvelope } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { blockTask, parseFavoriteResolutionTaskPayload, retryTask } from '../tasks';
import type { DurableTask, FavoriteResolutionOutboxPort } from '../tasks';
import { persistFavoriteResolutionCompletion } from './favorite-resolution-commit';
import { favoriteResolutionVersions } from './resolution-result-schema';
import { hasExactBlockedProviderTaxonomy, isProviderCandidateCompatible, matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { favoriteProviderPolicy, routeFavoriteProviderTiers } from './provider-ports';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, ResolutionProvider } from './provider-ports';

export const favoriteResolutionSliceLimit = 8;
export const favoriteResolutionWakeBudgetMs = 20_000;
export const favoriteResolutionClaimMs = 60_000;
export const favoriteResolutionAttemptLimit = 8;
export const favoriteResolutionMaximumBackoffMs = 6 * 60 * 60 * 1_000;
export const favoriteResolutionTaskRetentionMs = 30 * 24 * 60 * 60 * 1_000;

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

async function retryClaim(
  dependencies: FavoriteResolutionRunnerDependencies,
  task: DurableTask,
  token: string,
  retryAt: string,
  reason: 'PROVIDER_UNAVAILABLE' | 'INCOMPLETE_CANDIDATE_SET' = 'PROVIDER_UNAVAILABLE',
): Promise<'blocked' | 'retried'> {
  const exhausted = task.attempt >= favoriteResolutionAttemptLimit;
  await dependencies.storage.transaction(['favoriteSources', 'favoriteArtifacts', 'favoriteResolutionTasks'], async (session) => {
    const payload = parseFavoriteResolutionTaskPayload(task.payload);
    const source = await session.getFavoriteSource(payload.sourceId);
    const record = await session.getFavoriteParseArtifact(payload.sourceId);
    const current = await session.getFavoriteResolutionTask(task.id);
    if (!source || !record || record.artifact.semanticFingerprint !== payload.semanticFingerprint
      || current?.idempotencyKey !== task.idempotencyKey || current.claimToken !== token) throw new Error('STALE_PRIVATE_REFERENCE');
    await session.putFavoriteResolutionTask(exhausted ? blockTask(current, token, 'AUTOMATIC_ATTEMPT_LIMIT') : retryTask(current, token, retryAt));
    await session.putFavoriteSource(createFavoriteSource({
      ...source, resolution: { kind: 'RETRYABLE', reason: exhausted ? 'AUTOMATIC_ATTEMPT_LIMIT' : reason },
      resolutionVersions: favoriteResolutionVersions(record.artifact),
    }));
  });
  return exhausted ? 'blocked' : 'retried';
}

async function processClaimedTask(dependencies: FavoriteResolutionRunnerDependencies, task: DurableTask, token: string): Promise<'blocked' | 'completed' | 'retried'> {
  const payload = parseFavoriteResolutionTaskPayload(task.payload);
  const [source, record] = await Promise.all([
    dependencies.storage.getFavoriteSource(payload.sourceId),
    dependencies.storage.getFavoriteParseArtifact(payload.sourceId),
  ]);
  if (source === undefined || record === undefined || record.artifact.semanticFingerprint !== payload.semanticFingerprint) throw new Error('STALE_PRIVATE_REFERENCE');
  const previousReview = source.reviewId === undefined ? undefined : await dependencies.storage.getReview(source.reviewId);
  if (previousReview !== undefined && previousReview.status !== 'pending') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, 'decision:preserved');
    return 'completed';
  }
  if (source.presence === 'detached') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'DETACHED' }, 'source:detached');
    return 'completed';
  }
  const artifact = record.artifact;
  if (artifact.status !== 'parsed') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' }, 'unsupported:identity-missing');
    return 'completed';
  }
  const explicit = artifact.sourceEvidence.explicitProviderReference;
  if (explicit !== undefined && (explicit.provider === 'anilist' || explicit.provider === 'mangaupdates')) {
    const reference = { externalId: explicit.externalId, provider: explicit.provider } as const;
    let candidate: ProviderCandidate | undefined;
    try { candidate = await dependencies.hydration[reference.provider].hydrate(reference); } catch { candidate = undefined; }
    if (candidate !== undefined) {
      if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
      const compatibility = artifact.mediaKind === 'UNKNOWN' ? {} : { mediaKind: artifact.mediaKind };
      if (!isProviderCandidateCompatible({ ...compatibility, sourceTitles: providerTitles(artifact) }, candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, 'review:explicit-reference-incompatible');
        return 'completed';
      }
      if (hasExactBlockedProviderTaxonomy(candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
        return 'completed';
      }
      await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${reference.provider}:${reference.externalId}`, candidate);
      return 'completed';
    }
  }
  const titles = providerTitles(artifact);
  if (titles.length === 0) {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' }, 'unsupported:identity-missing');
    return 'completed';
  }
  let envelopes: readonly ProviderCandidateEnvelope[] | undefined;
  for (const providers of routeFavoriteProviderTiers(artifact.mediaKind)) {
    const perProviderLimit = Math.floor(20 / providers.length);
    try {
      const tier = await Promise.all(providers.map((provider) => dependencies.candidates[provider].search({ limit: perProviderLimit, provider, titles })));
      if (tier.every((envelope) => envelope.complete && !envelope.truncated)) {
        envelopes = tier;
        break;
      }
    } catch {
      // A provider outage invalidates this complete tier; the next tier may proceed.
    }
  }
  if (envelopes === undefined) {
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
    return retryClaim(dependencies, task, token, retryAt, 'INCOMPLETE_CANDIDATE_SET');
  }
  if (outcome.kind === 'AMBIGUOUS') {
    const references = new Set(outcome.candidateReferences.map((reference) => `${reference.provider}:${reference.externalId}`));
    const candidates = envelopes.flatMap((envelope) => envelope.candidates).filter((candidate) => references.has(`${candidate.provider}:${candidate.externalId}`)).slice(0, 6);
    const candidateSet = Object.freeze({ candidates: Object.freeze(candidates), digest: envelopes.map((envelope) => envelope.digest).join('|'), recordedAt: dependencies.now() });
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, `review:${outcome.kind.toLowerCase()}`, undefined, candidateSet);
    return 'completed';
  }
  if (outcome.kind === 'NO_MATCH') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, 'review:not-found');
    return 'completed';
  }
  const provider = outcome.matchedReference.provider;
  if (provider === 'mangadex') throw new Error('UNROUTABLE_PROVIDER_REFERENCE');
  let candidate: ProviderCandidate | undefined;
  try { candidate = await dependencies.hydration[provider].hydrate({ externalId: outcome.matchedReference.externalId, provider }); } catch { candidate = undefined; }
  if (candidate === undefined) {
    const retryAt = new Date(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs).toISOString();
    return retryClaim(dependencies, task, token, retryAt);
  }
  if (candidate.provider !== provider || candidate.externalId !== outcome.matchedReference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
  if (hasExactBlockedProviderTaxonomy(candidate)) {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
    return 'completed';
  }
  await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${provider}:${candidate.externalId}`, candidate);
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
  await dependencies.outbox.compactCommitted?.({ before: new Date(startedAt - favoriteResolutionTaskRetentionMs).toISOString(), limit: favoriteResolutionSliceLimit });
  return Object.freeze({ blocked, completed, retried });
}
