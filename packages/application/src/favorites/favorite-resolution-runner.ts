import { createFavoriteSource, createWork } from '@tobirink/domain';
import type { FavoriteParseArtifact, LibraryId, ProviderCandidate, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { resolveFavoriteCollectiveIdentity } from '../collective-index/favorite-collective-lookup';
import type { FavoriteCollectiveLookupPort } from '../collective-index/favorite-collective-lookup';
import { blockTask, parseFavoriteResolutionTaskPayload, retryTask } from '../tasks';
import type { DurableTask, FavoriteResolutionOutboxPort } from '../tasks';
import { favoriteCandidateWorkId, persistFavoriteResolutionCompletion } from './favorite-resolution-commit';
import { readLocalFavoriteIdentity } from './local-favorite-identity';
import { favoriteResolutionVersions } from './resolution-result-schema';
import { hasExactBlockedProviderTaxonomy } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { favoriteProviderPolicy, FavoriteProviderRetryError } from './provider-ports';
import { resolveFavoriteProviderLanes } from './resolve-provider-lanes';
import { createFavoriteSearchCheckpointPort } from './provider-search-checkpoint';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPorts, ResolutionProvider } from './provider-ports';

// Cheap local/terminal tasks may drain in one wake; the time budget remains
// authoritative for provider I/O and MV3 suspension safety.
export const favoriteResolutionSliceLimit = 100;
export const favoriteResolutionWakeBudgetMs = 20_000;
export const favoriteResolutionClaimMs = 60_000;
export const favoriteResolutionAttemptLimit = 8;
export const favoriteResolutionMaximumBackoffMs = 6 * 60 * 60 * 1_000;
export const favoriteResolutionTaskRetentionMs = 30 * 24 * 60 * 60 * 1_000;

export async function repairMissingFavoriteCovers(storage: StoragePort, hydration: FavoriteProviderHydrationPorts, now: () => string, afterId?: Work['id']) {
  const works = await storage.listWorks(afterId === undefined ? { limit: 10 } : { afterId, limit: 10 });
  let repaired = 0;
  let skipped = 0;
  for (const work of works) {
    if (work.hydration?.candidate.cover !== undefined) { skipped += 1; continue; }
    const reference = work.externalReferences.find((item) => item.provider in hydration);
    const provider = reference === undefined ? undefined : (['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga'] as const).find((value) => value === reference.provider);
    const adapter = provider === undefined ? undefined : hydration[provider];
    if (reference === undefined || provider === undefined || adapter === undefined || work.hydration === undefined) { skipped += 1; continue; }
    try {
      const candidate = await adapter.hydrate({ externalId: reference.externalId, provider });
      if (candidate === undefined) { skipped += 1; continue; }
      if (candidate.cover === undefined) {
        await storage.putWork(createWork({ ...work, hydration: { ...work.hydration, candidate, hydratedAt: now() } }));
        skipped += 1;
        continue;
      }
      await storage.putWork(createWork({ ...work, hydration: { ...work.hydration, candidate, hydratedAt: now() } }));
      repaired += 1;
    } catch { skipped += 1; }
  }
  return Object.freeze({ inspected: works.length, repaired, skipped, nextAfterId: works.at(-1)?.id });
}

export interface FavoriteResolutionRunnerDependencies {
  readonly collective?: FavoriteCollectiveLookupPort;
  readonly candidates: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>;
  readonly hydration: FavoriteProviderHydrationPorts;
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

function freshHydration(hydratedAt: string | undefined, now: string): boolean {
  if (hydratedAt === undefined) return false;
  const age = timestamp(now) - timestamp(hydratedAt);
  return age >= 0 && age < favoriteProviderPolicy.positiveTtlMs;
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
      || current?.idempotencyKey !== task.idempotencyKey || current.claimToken !== token || current.state !== 'CLAIMED'
      || current.claimExpiresAt === undefined || current.claimExpiresAt <= dependencies.now()) throw new Error('STALE_PRIVATE_REFERENCE');
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
  if (artifact.status !== 'parsed' && artifact.sourceEvidence.explicitProviderReference === undefined) {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' }, 'unsupported:identity-missing');
    return 'completed';
  }
  const explicit = artifact.sourceEvidence.explicitProviderReference;
  if (explicit !== undefined) {
    const reference = { externalId: explicit.externalId, provider: explicit.provider } as const;
    const hydration = dependencies.hydration[reference.provider];
    if (hydration === undefined) throw new Error('UNROUTABLE_PROVIDER_REFERENCE');
    const cached = await dependencies.storage.getWork(favoriteCandidateWorkId(reference));
    const fresh = freshHydration(cached?.hydration?.hydratedAt, dependencies.now());
    let candidate: ProviderCandidate | undefined;
    try { candidate = fresh ? cached?.hydration?.candidate : await hydration.hydrate(reference); } catch (error) {
      const retryAt = Math.max(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs, error instanceof FavoriteProviderRetryError ? error.retryAt : 0);
      return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
    }
    if (candidate !== undefined) {
      if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
      if (hasExactBlockedProviderTaxonomy(candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
        return 'completed';
      }
      await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${reference.provider}:${reference.externalId}`, candidate, undefined, { workId: cached?.id, hydratedAt: fresh ? cached?.hydration?.hydratedAt : undefined });
      return 'completed';
    }
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, 'review:explicit-id-not-found');
    return 'completed';
  }
  const titles = providerTitles(artifact);
  if (titles.length === 0) {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'IDENTITY_MISSING' }, 'unsupported:identity-missing');
    return 'completed';
  }
  const matchQuery: MutableFavoriteTitleMatchQuery = { sourceTitles: titles };
  if (artifact.sourceEvidence.explicitProviderReference !== undefined) matchQuery.explicitProviderReference = artifact.sourceEvidence.explicitProviderReference;
  if (artifact.season !== undefined && artifact.seasonEvidence?.conflict !== true) matchQuery.explicitSeason = artifact.season;
  if (artifact.mediaKind !== 'UNKNOWN') matchQuery.mediaKind = artifact.mediaKind;
  if (artifact.sourceEvidence.canonicalUrl !== undefined) matchQuery.sourceCanonicalUrl = artifact.sourceEvidence.canonicalUrl;
  const local = await readLocalFavoriteIdentity(dependencies.storage, artifact, matchQuery);
  if (local.kind === 'MATCH') {
    const cachedAt = local.work.hydration?.hydratedAt;
    const fresh = freshHydration(cachedAt, dependencies.now());
    const hydration = dependencies.hydration[local.candidate.provider];
    let candidate = fresh ? local.candidate : undefined;
    if (!fresh) {
      if (hydration === undefined) throw new Error('UNROUTABLE_PROVIDER_REFERENCE');
      try { candidate = await hydration.hydrate(local.candidate); } catch (error) {
        const retryAt = Math.max(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs, error instanceof FavoriteProviderRetryError ? error.retryAt : 0);
        return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
      }
    }
    if (candidate === undefined) {
      await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, 'review:cached-id-not-found');
    } else {
      if (candidate.provider !== local.candidate.provider || candidate.externalId !== local.candidate.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
      if (hasExactBlockedProviderTaxonomy(candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
      } else {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${local.provenance}`, candidate, undefined, { workId: local.work.id, hydratedAt: fresh ? cachedAt : undefined });
      }
    }
    return 'completed';
  }
  const collective = await resolveFavoriteCollectiveIdentity(dependencies.collective, artifact, dependencies.hydration, local.kind === 'AMBIGUOUS');
  if (collective.kind === 'RETRYABLE') return retryClaim(dependencies, task, token, new Date(Math.max(collective.retryAt ?? 0, timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs)).toISOString());
  if (collective.kind === 'REVIEW_REQUIRED') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, collective, `review:collective-${collective.reason.toLowerCase()}`);
    return 'completed';
  }
  if (collective.kind === 'RESOLVED') {
    if (hasExactBlockedProviderTaxonomy(collective.candidate)) await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
    else await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:collective-${collective.scope}`, collective.candidate, undefined, { references: collective.references });
    return 'completed';
  }
  if (local.kind === 'AMBIGUOUS') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, `review:${local.provenance}`, undefined, {
      candidates: local.candidates.slice(0, 6), digest: `${local.provenance}:${artifact.semanticFingerprint}`, provenance: local.provenance, totalCandidates: local.candidates.length, recordedAt: dependencies.now(),
    });
    return 'completed';
  }
  const checkpoints = createFavoriteSearchCheckpointPort(dependencies.storage, task, token, dependencies.now);
  const lanes = await resolveFavoriteProviderLanes(dependencies.candidates, matchQuery, artifact.mediaKind, checkpoints);
  if (lanes.kind === 'PAGE_PENDING') {
    await dependencies.storage.transaction(['favoriteResolutionTasks'], async (session) => {
      const current = await session.getFavoriteResolutionTask(task.id);
      if (current?.idempotencyKey !== task.idempotencyKey) throw new Error('STALE_PRIVATE_REFERENCE');
      await session.putFavoriteResolutionTask(retryTask({ ...current, attempt: 0 }, token, new Date(timestamp(dependencies.now()) + 1_000).toISOString()));
    });
    return 'retried';
  }
  if (lanes.kind === 'RETRYABLE') {
    const exponent = Math.max(0, task.attempt - 1);
    const retryAt = new Date(Math.max(lanes.retryAt ?? 0, timestamp(dependencies.now()) + Math.min(favoriteResolutionMaximumBackoffMs, 30_000 * (2 ** exponent)))).toISOString();
    return retryClaim(dependencies, task, token, retryAt, lanes.reason);
  }
  const { decision: outcome, envelopes } = lanes;
  if (outcome.kind === 'AMBIGUOUS') {
    const references = new Set(outcome.candidateReferences.map((reference) => `${reference.provider}:${reference.externalId}`));
    const candidates = envelopes.flatMap((envelope) => envelope.candidates).filter((candidate) => references.has(`${candidate.provider}:${candidate.externalId}`)).slice(0, 6);
    const candidateSet = Object.freeze({ candidates: Object.freeze(candidates), digest: envelopes.map((envelope) => envelope.digest).join('|'), matchLevel: outcome.level, provenance: 'provider-search', totalCandidates: references.size, recordedAt: dependencies.now() });
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, `review:${outcome.kind.toLowerCase()}`, undefined, candidateSet);
    return 'completed';
  }
  if (outcome.kind === 'NO_MATCH') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, 'review:not-found');
    return 'completed';
  }
  const provider = outcome.matchedReference.provider;
  let candidate: ProviderCandidate | undefined;
  try { candidate = await dependencies.hydration[provider].hydrate({ externalId: outcome.matchedReference.externalId, provider }); } catch (error) {
    const retryAt = Math.max(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs, error instanceof FavoriteProviderRetryError ? error.retryAt : 0);
    return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
  }
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
      const changed = await dependencies.storage.transaction(['favoriteResolutionTasks'], async (session) => {
        const current = await session.getFavoriteResolutionTask(task.id);
        if (current?.state !== 'CLAIMED' || current.claimToken !== token || current.idempotencyKey !== task.idempotencyKey
          || current.claimExpiresAt === undefined || current.claimExpiresAt <= dependencies.now()) return false;
        await session.putFavoriteResolutionTask(blockTask(current, token, error instanceof Error ? error.message : 'UNKNOWN_RESOLUTION_FAILURE'));
        return true;
      });
      if (changed) blocked += 1;
      else break;
    }
  }
  await dependencies.outbox.compactCommitted?.({ before: new Date(startedAt - favoriteResolutionTaskRetentionMs).toISOString(), limit: favoriteResolutionSliceLimit });
  return Object.freeze({ blocked, completed, retried });
}
