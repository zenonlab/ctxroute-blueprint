import { createFavoriteSource, createProviderCandidate, createWork } from '@tobirink/domain';
import type { FavoriteParseArtifact, LibraryId, ProviderCandidate, Work } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { resolveFavoriteCollectiveIdentity } from '../collective-index/favorite-collective-lookup';
import type { FavoriteCollectiveLookupPort } from '../collective-index/favorite-collective-lookup';
import { parseFavoriteResolutionTaskPayload, retryTask } from '../tasks';
import type { DurableTask, FavoriteResolutionOutboxPort } from '../tasks';
import { favoriteCandidateWorkId, persistFavoriteResolutionCompletion } from './favorite-resolution-commit';
import { readLocalFavoriteIdentity } from './local-favorite-identity';
import { favoriteResolutionVersions } from './resolution-result-schema';
import { hasExactBlockedProviderTaxonomy, matchFavoriteTitles } from './provider-matcher';
import { normalizeFavoriteTitle } from './title-normalization';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { favoriteProviderPolicy, FavoriteProviderRetryError } from './provider-ports';
import { resolveFavoriteProviderLanes } from './resolve-provider-lanes';
import { createFavoriteSearchCheckpointPort, searchFavoriteProviderPage } from './provider-search-checkpoint';
import type { FavoriteSearchCheckpointPort } from './provider-search-checkpoint';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPorts, ResolutionProvider } from './provider-ports';

// Cheap local/terminal tasks may drain in one wake; the time budget remains
// authoritative for provider I/O and MV3 suspension safety.
export const favoriteResolutionSliceLimit = 100;
export const favoriteResolutionWakeBudgetMs = 20_000;
export const favoriteResolutionClaimMs = 60_000;
export const favoriteResolutionAttemptLimit = 8;
export const favoriteResolutionMaximumBackoffMs = 6 * 60 * 60 * 1_000;
export const favoriteResolutionTaskRetentionMs = 30 * 24 * 60 * 60 * 1_000;

export async function repairMissingFavoriteCovers(storage: StoragePort, hydration: FavoriteProviderHydrationPorts, now: () => string, afterId?: Work['id'], candidates?: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>) {
  const works = await storage.listWorks(afterId === undefined ? { limit: 10 } : { afterId, limit: 10 });
  let repaired = 0;
  let skipped = 0;
  for (const work of works) {
    const currentCandidate = work.hydration?.candidate;
    if (currentCandidate?.provider === 'mangadex' && candidates?.mangaupdates !== undefined && currentCandidate.titles.length > 0) {
      try {
        const preferred = await preferMangaUpdatesHydration({ candidates, hydration }, currentCandidate);
        if (preferred.provider === 'mangaupdates' && preferred.cover !== undefined && work.hydration !== undefined) {
          const references = [...new Map([...work.externalReferences, { provider: preferred.provider, externalId: preferred.externalId }].map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
          await storage.putWork(createWork({ ...work, externalReferences: references, hydration: { ...work.hydration, candidate: preferred, hydratedAt: now(), providerTitleKeys: [...new Set(preferred.titles.map((title) => normalizeFavoriteTitle(title).normalized))] } }));
          repaired += 1;
          continue;
        }
      } catch { /* keep the current provider cover when the preference lookup is unavailable */ }
    }
    if (currentCandidate?.cover !== undefined) { skipped += 1; continue; }
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

function hydrationRetryAt(retryAt: number | undefined, now: string): number {
  return retryAt !== undefined
    ? Math.max(timestamp(now) + 1_000, retryAt)
    : timestamp(now) + favoriteProviderPolicy.negativeTtlMs;
}

async function retryClaim(
  dependencies: FavoriteResolutionRunnerDependencies,
  task: DurableTask,
  token: string,
  retryAt: string,
  reason: 'PROVIDER_UNAVAILABLE' | 'INCOMPLETE_CANDIDATE_SET' | 'COLLECTIVE_UNAVAILABLE' = 'PROVIDER_UNAVAILABLE',
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
    const scheduledAt = exhausted ? new Date(Math.max(timestamp(retryAt), timestamp(dependencies.now()) + favoriteResolutionMaximumBackoffMs)).toISOString() : retryAt;
    await session.putFavoriteResolutionTask(retryTask(current, token, scheduledAt));
    await session.putFavoriteSource(createFavoriteSource({
      ...source, resolution: { kind: 'RETRYABLE', reason },
      resolutionVersions: favoriteResolutionVersions(record.artifact),
    }));
  });
  return 'retried';
}

async function preferMangaUpdatesHydration(
  dependencies: Pick<FavoriteResolutionRunnerDependencies, 'candidates' | 'hydration'>,
  candidate: ProviderCandidate,
  checkpoints?: FavoriteSearchCheckpointPort,
): Promise<ProviderCandidate> {
  if (candidate.provider !== 'mangadex') return candidate;
  const mangaUpdates = dependencies.candidates.mangaupdates;
  if (!mangaUpdates) return candidate;
  const reference = candidate.linkedReferences?.find(value => value.provider === 'mangaupdates');
  let preferred: ProviderCandidate | undefined;
  if (reference !== undefined) {
    try { preferred = await dependencies.hydration.mangaupdates.hydrate(reference); }
    catch (error) { if (!(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error; }
  }
  if (preferred === undefined) {
    const query: MutableFavoriteTitleMatchQuery = { sourceTitles: candidate.titles, mediaKind: candidate.mediaKind, preSerialization: false };
    if (reference !== undefined) query.explicitProviderReference = reference;
    const result = await searchFavoriteProviderPage(mangaUpdates, query, 'mangaupdates', 20, checkpoints);
    if (result.kind === 'PAGE_PENDING') throw new FavoriteProviderRetryError('Primary metadata search has another page.', (checkpoints?.now() ?? Date.now()) + 1_000);
    const decision = matchFavoriteTitles(query, [result.envelope]);
    if (decision.kind !== 'MATCH') return candidate;
    preferred = result.envelope.candidates.find(value => value.externalId === decision.matchedReference.externalId);
  }
  if (preferred === undefined) return candidate;
  if (preferred.provider !== 'mangaupdates' || (reference !== undefined && preferred.externalId !== reference.externalId)) throw new Error('HYDRATION_REFERENCE_MISMATCH');
  return createProviderCandidate({ ...preferred, linkedReferences: [{ provider: 'mangadex', externalId: candidate.externalId }] }, 'mangaupdates');
}

async function hydrateExplicitReference(
  dependencies: FavoriteResolutionRunnerDependencies,
  reference: { readonly provider: ResolutionProvider; readonly externalId: string },
  artifact: FavoriteParseArtifact,
  checkpoints?: FavoriteSearchCheckpointPort,
): Promise<ProviderCandidate | undefined> {
  const hydration = dependencies.hydration[reference.provider];
  if (hydration === undefined) throw new Error('UNROUTABLE_PROVIDER_REFERENCE');
  try {
    return await hydration.hydrate(reference);
  } catch (error) {
    // MangaUpdates currently exposes the public series record through its
    // bounded search endpoint; a direct GET may answer 405. Preserve the
    // exact public ID and use search only as a hydration transport fallback.
    if (reference.provider !== 'mangaupdates' || !(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error;
    const search = dependencies.candidates.mangaupdates;
    if (search === undefined) throw error;
    const result = await searchFavoriteProviderPage(search, { sourceTitles: providerTitles(artifact), explicitProviderReference: reference }, 'mangaupdates', 20, checkpoints);
    if (result.kind === 'PAGE_PENDING') throw new FavoriteProviderRetryError('Exact identity hydration has another page.', timestamp(dependencies.now()) + 1_000);
    const envelope = result.envelope;
    const exact = envelope.candidates.find((candidate) => candidate.provider === reference.provider && candidate.externalId === reference.externalId);
    if (exact === undefined && (!envelope.complete || envelope.truncated)) throw new Error('INCOMPLETE_HYDRATION_SEARCH');
    return exact;
  }
}

async function processClaimedTask(dependencies: FavoriteResolutionRunnerDependencies, task: DurableTask, token: string): Promise<'blocked' | 'completed' | 'retried'> {
  const payload = parseFavoriteResolutionTaskPayload(task.payload);
  const checkpoints = createFavoriteSearchCheckpointPort(dependencies.storage, task, token, dependencies.now);
  const metadataCheckpoints = createFavoriteSearchCheckpointPort(dependencies.storage, task, token, dependencies.now, 'metadata');
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
    try { candidate = fresh ? cached?.hydration?.candidate : await hydrateExplicitReference(dependencies, reference, artifact, checkpoints); } catch (error) {
      const retryAt = hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now());
      return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
    }
    if (candidate !== undefined) {
      const cachedCrossReference = fresh && candidate.linkedReferences?.some(value => value.provider === reference.provider && value.externalId === reference.externalId);
      if ((candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) && !cachedCrossReference) throw new Error('HYDRATION_REFERENCE_MISMATCH');
      try { candidate = await preferMangaUpdatesHydration(dependencies, candidate, metadataCheckpoints); } catch (error) {
        return retryClaim(dependencies, task, token, new Date(hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now())).toISOString());
      }
      if (hasExactBlockedProviderTaxonomy(candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
        return 'completed';
      }
      const identity = cached?.id !== undefined
        ? { workId: cached.id, references: [reference] }
        : { references: [reference] };
      await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${reference.provider}:${reference.externalId}`, candidate, undefined, identity);
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
      try { candidate = await hydrateExplicitReference(dependencies, local.candidate, artifact, checkpoints); } catch (error) {
        const retryAt = hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now());
        return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
      }
    }
    if (candidate === undefined) {
      await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' }, 'review:cached-id-not-found');
    } else {
      if (candidate.provider !== local.candidate.provider || candidate.externalId !== local.candidate.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
      try { candidate = await preferMangaUpdatesHydration(dependencies, candidate, metadataCheckpoints); } catch (error) {
        return retryClaim(dependencies, task, token, new Date(hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now())).toISOString());
      }
      if (hasExactBlockedProviderTaxonomy(candidate)) {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
      } else {
        await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:${local.provenance}`, candidate, undefined, { workId: local.work.id, hydratedAt: fresh ? cachedAt : undefined });
      }
    }
    return 'completed';
  }
  const collective = await resolveFavoriteCollectiveIdentity(dependencies.collective, artifact, dependencies.hydration, local.kind === 'AMBIGUOUS', (reference) => hydrateExplicitReference(dependencies, reference, artifact, checkpoints));
  const collectiveRetryAt = collective.kind === 'RETRYABLE'
    ? new Date(collective.retryAt === undefined ? timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs : Math.max(timestamp(dependencies.now()) + 1_000, collective.retryAt)).toISOString()
    : undefined;
  if (collective.kind === 'RETRYABLE' && collective.stage === 'HYDRATION' && collectiveRetryAt !== undefined) return retryClaim(dependencies, task, token, collectiveRetryAt);
  if (collective.kind === 'REVIEW_REQUIRED') {
    await persistFavoriteResolutionCompletion(dependencies, task, token, collective, `review:collective-${collective.reason.toLowerCase()}`);
    return 'completed';
  }
  if (collective.kind === 'RESOLVED') {
    let candidate = collective.candidate;
    try { candidate = await preferMangaUpdatesHydration(dependencies, candidate, metadataCheckpoints); } catch (error) {
      return retryClaim(dependencies, task, token, new Date(hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now())).toISOString());
    }
    if (hasExactBlockedProviderTaxonomy(candidate)) await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'UNSUPPORTED', reason: 'BLOCKED_CONTENT_TAXONOMY' }, 'unsupported:blocked-content-taxonomy');
    else await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'RESOLVED' }, `resolved:collective-${collective.scope}`, candidate, undefined, { references: collective.references });
    return 'completed';
  }
  if (local.kind === 'AMBIGUOUS') {
    if (collectiveRetryAt !== undefined) return retryClaim(dependencies, task, token, collectiveRetryAt, 'COLLECTIVE_UNAVAILABLE');
    await persistFavoriteResolutionCompletion(dependencies, task, token, { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, `review:${local.provenance}`, undefined, {
      candidates: local.candidates.slice(0, 6), digest: `${local.provenance}:${artifact.semanticFingerprint}`, provenance: local.provenance, totalCandidates: local.candidates.length, recordedAt: dependencies.now(),
    });
    return 'completed';
  }
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
  // Save provider evidence while the collective is unavailable, but do not
  // replace a personal decision that could not be consulted.
  if (collectiveRetryAt !== undefined) return retryClaim(dependencies, task, token, collectiveRetryAt, 'COLLECTIVE_UNAVAILABLE');
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
  try { candidate = await hydrateExplicitReference(dependencies, { externalId: outcome.matchedReference.externalId, provider }, artifact, checkpoints); } catch (error) {
    const retryAt = hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now());
    return retryClaim(dependencies, task, token, new Date(retryAt).toISOString());
  }
  if (candidate === undefined) {
    const retryAt = new Date(timestamp(dependencies.now()) + favoriteProviderPolicy.negativeTtlMs).toISOString();
    return retryClaim(dependencies, task, token, retryAt);
  }
  if (candidate.provider !== provider || candidate.externalId !== outcome.matchedReference.externalId) throw new Error('HYDRATION_REFERENCE_MISMATCH');
  try { candidate = await preferMangaUpdatesHydration(dependencies, candidate, metadataCheckpoints); } catch (error) {
    return retryClaim(dependencies, task, token, new Date(hydrationRetryAt(error instanceof FavoriteProviderRetryError ? error.retryAt : undefined, dependencies.now())).toISOString());
  }
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
    } catch {
      const changed = await dependencies.storage.transaction(['favoriteArtifacts', 'favoriteResolutionTasks', 'favoriteSources'], async (session) => {
        const current = await session.getFavoriteResolutionTask(task.id);
        if (current?.state !== 'CLAIMED' || current.claimToken !== token || current.idempotencyKey !== task.idempotencyKey
          || current.claimExpiresAt === undefined || current.claimExpiresAt <= dependencies.now()) return false;
        const payload = parseFavoriteResolutionTaskPayload(task.payload);
        const source = await session.getFavoriteSource(payload.sourceId);
        const record = await session.getFavoriteParseArtifact(payload.sourceId);
        if (source === undefined || record === undefined || record.artifact.semanticFingerprint !== payload.semanticFingerprint) return false;
        const retryAt = new Date(timestamp(dependencies.now()) + Math.min(favoriteResolutionMaximumBackoffMs, 30_000 * (2 ** Math.min(10, Math.max(0, current.attempt - 1))))).toISOString();
        await session.putFavoriteResolutionTask({ ...retryTask(current, token, retryAt), blockedReason: 'INTERNAL_RESOLUTION_FAILURE' });
        await session.putFavoriteSource(createFavoriteSource({
          ...source,
          resolution: { kind: 'RETRYABLE', reason: 'INTERNAL_FAILURE' },
          resolutionVersions: favoriteResolutionVersions(record.artifact),
        }));
        return true;
      });
      if (changed) retried += 1;
      else break;
    }
  }
  await dependencies.outbox.compactCommitted?.({ before: new Date(startedAt - favoriteResolutionTaskRetentionMs).toISOString(), limit: favoriteResolutionSliceLimit });
  return Object.freeze({ blocked, completed, retried });
}
