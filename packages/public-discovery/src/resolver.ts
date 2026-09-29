import { isPublicDiscoverySearchCursor, publicDiscoveryCandidateSchema } from './contracts';
import type { PublicDiscoveryClaimedRequest, PublicDiscoveryReferenceV3, PublicDiscoverySearchProgress, PublicDiscoveryTerminalResolution } from './contracts';
import { favoriteProviderInspectionLimit, FavoriteProviderRetryError, inspectFavoriteTitleCandidates, isPublicDiscoveryCandidateCompatible } from './provider-kit';
import type { FavoriteProviderPort, FavoriteTitleMatchQuery, ProviderCandidate, ResolutionProvider } from './provider-kit';
import { AniListFavoriteProviderAdapter } from './providers/anilist';
import { KitsuFavoriteProviderAdapter } from './providers/kitsu';
import { MangaDexFavoriteProviderAdapter } from './providers/mangadex';
import { MangaUpdatesFavoriteProviderAdapter } from './providers/mangaupdates';
import { FavoriteProviderHttpError, FavoriteProviderRateGate, isAutomaticProviderRetry } from './provider-http';
import type { FavoriteProviderFetch, FavoriteProviderRuntimeControlPort } from './provider-http';

export type PublicDiscoveryProviderPorts = Readonly<Record<ResolutionProvider, FavoriteProviderPort>>;

export function createPublicDiscoveryProviders(
  fetcher: FavoriteProviderFetch = fetch.bind(globalThis),
  controls?: FavoriteProviderRuntimeControlPort,
): PublicDiscoveryProviderPorts {
  return Object.freeze({
    anilist: new AniListFavoriteProviderAdapter(fetcher, new FavoriteProviderRateGate('anilist', controls)),
    mangaupdates: new MangaUpdatesFavoriteProviderAdapter(fetcher, new FavoriteProviderRateGate('mangaupdates', controls)),
    mangadex: new MangaDexFavoriteProviderAdapter(fetcher, new FavoriteProviderRateGate('mangadex', controls)),
    'kitsu-anime': new KitsuFavoriteProviderAdapter('kitsu-anime', fetcher, new FavoriteProviderRateGate('kitsu-anime', controls)),
    'kitsu-manga': new KitsuFavoriteProviderAdapter('kitsu-manga', fetcher, new FavoriteProviderRateGate('kitsu-manga', controls)),
  });
}

interface LaneDecision {
  readonly candidates: readonly ProviderCandidate[];
  readonly references: readonly PublicDiscoveryReferenceV3[];
  readonly state: 'MATCH' | 'AMBIGUOUS' | 'NOT_FOUND';
  readonly retainedFailure?: Error;
  readonly unavailable?: Error;
}
interface MutableTitleMatchQuery {
  explicitSeason?: number;
  mediaKind?: ProviderCandidate['mediaKind'];
  preSerialization?: boolean;
  sourceFormat?: string;
  sourceTitles: readonly string[];
}
const animeProviders = ['anilist', 'kitsu-anime'] as const;
const mangaProviders = ['mangaupdates', 'mangadex', 'kitsu-manga'] as const;
const mangaSearchProviders = ['mangadex', 'kitsu-manga', 'mangaupdates'] as const;
const searchPageLimit = 4;
const searchDurationMilliseconds = 90_000;

class IncompleteProviderSearchError extends Error {
  constructor(reason: string) { super(`incomplete-provider-search:${reason}`); }
}

export class PublicDiscoverySearchContinuationError extends FavoriteProviderRetryError {
  constructor(readonly searchProgress: PublicDiscoverySearchProgress, retryAt = Date.now() + 1_000) {
    super('public-discovery-search-continuation', retryAt);
    this.name = 'PublicDiscoverySearchContinuationError';
  }
}

export class PublicDiscoveryInvocationYieldError extends FavoriteProviderRetryError {
  constructor() {
    super('public-discovery-invocation-budget', Date.now() + 1_000);
    this.name = 'PublicDiscoveryInvocationYieldError';
  }
}

function candidateKey(candidate: ProviderCandidate): string { return `${candidate.provider}:${candidate.externalId}`; }

function matchQueryFor(request: PublicDiscoveryClaimedRequest, titles: readonly string[]): FavoriteTitleMatchQuery {
  const query: MutableTitleMatchQuery = { sourceTitles: request.query.sourceTitles.length > 0 ? request.query.sourceTitles : titles };
  if (request.query.mediaKind !== 'UNKNOWN') query.mediaKind = request.query.mediaKind;
  if (request.query.preSerialization !== undefined) query.preSerialization = request.query.preSerialization;
  if (request.query.season !== undefined) query.explicitSeason = request.query.season;
  if (request.query.sourceFormat !== undefined) query.sourceFormat = request.query.sourceFormat;
  return query;
}

function matchCandidates(candidates: readonly ProviderCandidate[], query: FavoriteTitleMatchQuery, aliasesExhausted: boolean): LaneDecision | undefined {
  const evidence = inspectFavoriteTitleCandidates(query, candidates);
  if (!aliasesExhausted) {
    if (evidence.candidateReferences.length === 1 && (evidence.level === 'source-id' || evidence.level === 'ordered-exact' || evidence.level === 'explicit-season')) {
      return { candidates, references: evidence.candidateReferences, state: 'MATCH' };
    }
    if (evidence.candidateReferences.length > 1 && (evidence.level === 'ordered-exact' || evidence.level === 'explicit-season')) {
      return { candidates, references: evidence.candidateReferences, state: 'AMBIGUOUS' };
    }
    return undefined;
  }
  if (evidence.candidateReferences.length === 0) return { candidates, references: [], state: 'NOT_FOUND' };
  return { candidates, references: evidence.candidateReferences, state: evidence.candidateReferences.length === 1 ? 'MATCH' : 'AMBIGUOUS' };
}

function matchesLinkedReference(candidate: ProviderCandidate, reference: PublicDiscoveryReferenceV3, query: FavoriteTitleMatchQuery): boolean {
  return candidate.linkedReferences?.some((item) => item.provider === reference.provider && item.externalId === reference.externalId) === true
    && matchCandidates([candidate], query, true)?.state === 'MATCH';
}

async function searchProvider(
  provider: ResolutionProvider,
  port: FavoriteProviderPort,
  titles: readonly string[],
  matchQuery: FavoriteTitleMatchQuery,
  deadline: number,
  progress?: PublicDiscoverySearchProgress,
  allowBudgetContinuation = false,
  requiredLinkedReference?: PublicDiscoveryReferenceV3,
): Promise<LaneDecision> {
  if (progress !== undefined && progress.provider !== provider) throw new Error('provider-search-progress-provider-mismatch');
  const uniqueTitles = [...new Set(titles)].slice(0, 4);
  const candidates = new Map((progress?.candidates ?? []).map((candidate) => [candidateKey(candidate), candidate]));
  for (let titleIndex = progress?.titleIndex ?? 0; titleIndex < uniqueTitles.length; titleIndex += 1) {
    const title = uniqueTitles[titleIndex];
    if (title === undefined) throw new Error('provider-search-progress-title-missing');
    let cursor = progress?.titleIndex === titleIndex ? progress.cursor : '1';
    const seen = new Set(['1']);
    if (cursor !== '1') seen.add(cursor);
    for (let page = 0; page < searchPageLimit; page += 1) {
      let envelope;
      try { envelope = await searchBeforeDeadline(port, { cursor, limit: 20, provider, titles: [title] }, deadline); }
      catch (error) {
        if (allowBudgetContinuation && error instanceof PublicDiscoveryInvocationYieldError) {
          throw new PublicDiscoverySearchContinuationError({ candidates: [...candidates.values()], cursor, provider, titleIndex, version: 1 }, error.retryAt);
        }
        throw error;
      }
      if (envelope.provider !== provider) throw new Error('provider-envelope-mismatch');
      if (envelope.candidates.length > 20) throw new IncompleteProviderSearchError('candidate-page-limit');
      // An exact identity may be accepted without exhausting every fuzzy result.
      // Inspect each page before retaining candidates, so a later exact match is not sliced away.
      const early = matchCandidates(envelope.candidates, matchQuery, false);
      if (early && (requiredLinkedReference === undefined || early.candidates.some((candidate) =>
        matchesLinkedReference(candidate, requiredLinkedReference, matchQuery)))) return early;
      for (const candidate of envelope.candidates) {
        if (inspectFavoriteTitleCandidates(matchQuery, [candidate]).candidateReferences.length === 0) continue;
        candidates.set(candidateKey(candidate), candidate);
        if (candidates.size > favoriteProviderInspectionLimit) throw new IncompleteProviderSearchError('candidate-limit');
      }
      if (envelope.complete && !envelope.truncated && envelope.nextCursor === undefined) break;
      const next = envelope.nextCursor;
      if (envelope.complete || next === undefined || !isPublicDiscoverySearchCursor(provider, next) || seen.has(next)) {
        throw new IncompleteProviderSearchError('cursor');
      }
      if (page + 1 === searchPageLimit) {
        throw new PublicDiscoverySearchContinuationError({
          candidates: [...candidates.values()], cursor: next, provider, titleIndex, version: 1,
        });
      }
      seen.add(next);
      cursor = next;
    }
  }
  const bounded = [...candidates.values()];
  const final = matchCandidates(bounded, matchQuery, true);
  if (!final) throw new Error('provider-matching-decision-missing');
  return final;
}

async function searchBeforeDeadline(
  port: FavoriteProviderPort,
  query: Parameters<FavoriteProviderPort['search']>[0],
  deadline: number,
): ReturnType<FavoriteProviderPort['search']> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new IncompleteProviderSearchError('deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new IncompleteProviderSearchError('deadline')), remaining);
  });
  try { return await Promise.race([port.search(query), timeout]); }
  finally { clearTimeout(timer); }
}

function isTransientProviderError(error: Error): boolean {
  if (error instanceof FavoriteProviderRetryError) return true;
  if (error instanceof FavoriteProviderHttpError) return [401, 403, 404, 405, 408, 425, 429, 500, 502, 503, 504].includes(error.status);
  if (!(error instanceof Error)) return false;
  return /(?:abort|fetch failed|incomplete provider page|network|tim(?:e|d out)|HTTP (?:401|403|404|405|408|425|429|500|502|503|504)\b)/iu.test(`${error.name}: ${error.message}`);
}

function retainProviderFailure(current: Error | undefined, incoming: Error): Error {
  if (current instanceof IncompleteProviderSearchError) return current;
  if (incoming instanceof IncompleteProviderSearchError) return incoming;
  if (current !== undefined && !(current instanceof FavoriteProviderRetryError)
    && !isAutomaticProviderRetry(current) && isAutomaticProviderRetry(incoming)) return current;
  if (incoming instanceof FavoriteProviderRetryError) {
    if (current !== undefined && !(current instanceof FavoriteProviderRetryError)) return current;
    if (current instanceof FavoriteProviderRetryError && current.retryAt > incoming.retryAt) return current;
  }
  return incoming;
}

function isProviderInvariantError(error: Error): boolean {
  return /(?:provider-envelope-mismatch|provider-matching-decision-missing|hydrated-identity-mismatch|hydrated-candidate-incompatible)/u.test(error.message);
}

async function searchLane(
  providers: PublicDiscoveryProviderPorts,
  order: readonly ResolutionProvider[],
  titles: readonly string[],
  query: FavoriteTitleMatchQuery,
  deadline: number,
  progress?: PublicDiscoverySearchProgress,
  allowBudgetContinuation = false,
): Promise<LaneDecision> {
  const inspected: ProviderCandidate[] = [];
  let unavailable: Error | undefined;
  const startIndex = progress === undefined ? 0 : order.indexOf(progress.provider);
  if (startIndex < 0) throw new Error('provider-search-progress-lane-mismatch');
  const retryProviders = progress?.retryProviders ?? [];
  if (new Set(retryProviders).size !== retryProviders.length || retryProviders.some((provider) => order.indexOf(provider) < 0 || order.indexOf(provider) >= startIndex)) {
    throw new Error('provider-search-progress-lane-mismatch');
  }
  const failedProviders: ResolutionProvider[] = [];
  for (const provider of order.filter((provider, index) => index >= startIndex || retryProviders.includes(provider))) {
    let result: LaneDecision;
    try {
      result = await searchProvider(provider, providers[provider], titles, query, deadline, provider === progress?.provider ? progress : undefined, allowBudgetContinuation);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (isProviderInvariantError(error)) throw error;
      if (error instanceof PublicDiscoverySearchContinuationError) {
        if (unavailable !== undefined) {
          const prior = provider === progress?.provider ? progress : undefined;
          const advanced = error.searchProgress.cursor !== (prior?.cursor ?? '1') || error.searchProgress.titleIndex !== (prior?.titleIndex ?? 0);
          if (!advanced) throw unavailable;
          throw new PublicDiscoverySearchContinuationError({ ...error.searchProgress, retryProviders: failedProviders }, error.retryAt);
        }
        throw error;
      }
      // Bounded incomplete searches consume an attempt; do not turn them into
      // cadence-only deferrals that could restart page one without limit.
      unavailable = retainProviderFailure(unavailable, error);
      failedProviders.push(provider);
      continue;
    }
    inspected.push(...result.candidates);
    if (result.state !== 'NOT_FOUND') {
      const matched = { ...result, candidates: inspected };
      return unavailable === undefined ? matched : { ...matched, retainedFailure: unavailable };
    }
  }
  const result: LaneDecision = { candidates: inspected, references: [], state: 'NOT_FOUND' };
  return unavailable === undefined ? result : { ...result, unavailable };
}

async function searchApplicableLanes(providers: PublicDiscoveryProviderPorts, request: PublicDiscoveryClaimedRequest, deadline: number): Promise<readonly LaneDecision[]> {
  const titles = request.query.discoveryTitles.slice(0, 4);
  const query = matchQueryFor(request, titles);
  const progress = request.searchProgress;
  if (progress?.animeLane !== undefined && request.query.mediaKind !== 'UNKNOWN') throw new Error('provider-search-progress-lane-mismatch');
  if (request.query.mediaKind === 'UNKNOWN') {
    const mangaProgress = progress !== undefined && mangaProviders.some((provider) => provider === progress.provider) ? progress : undefined;
    if (mangaProgress !== undefined && progress?.animeLane === undefined) throw new Error('provider-search-progress-lane-mismatch');
    if (progress?.animeLane !== undefined && mangaProgress === undefined) throw new Error('provider-search-progress-lane-mismatch');
    const animeLane: LaneDecision = progress?.animeLane === undefined
      ? await searchLane(providers, animeProviders, titles, { ...query, mediaKind: 'ANIME' }, deadline, progress, true)
      : progress.animeLane;
    const matchedAnimeCandidates = new Map(animeLane.candidates
      .filter((candidate) => animeLane.references.some((reference) => reference.provider === candidate.provider && reference.externalId === candidate.externalId))
      .map((candidate) => [candidateKey(candidate), candidate]));
    const animeCheckpoint: PublicDiscoverySearchProgress['animeLane'] = animeLane.unavailable === undefined && animeLane.retainedFailure === undefined
      ? { candidates: [...matchedAnimeCandidates.values()].slice(0, 10),
        references: animeLane.references.slice(0, 10), state: animeLane.state }
      : undefined;
    if (progress?.animeLane !== undefined && (animeCheckpoint === undefined
      || (animeLane.state === 'MATCH' && (animeLane.references.length !== 1 || animeCheckpoint.candidates.length !== 1))
      || (animeLane.state === 'AMBIGUOUS' && animeLane.references.length < 2)
      || (animeLane.state === 'NOT_FOUND' && animeLane.references.length !== 0))) throw new Error('provider-search-progress-lane-mismatch');
    let mangaLane: LaneDecision;
    try { mangaLane = await searchLane(providers, mangaProviders, titles, { ...query, mediaKind: 'MANGA' }, deadline, mangaProgress, animeCheckpoint !== undefined); }
    catch (error) {
      if (error instanceof PublicDiscoverySearchContinuationError && animeCheckpoint !== undefined) {
        throw new PublicDiscoverySearchContinuationError({ ...error.searchProgress, animeLane: animeCheckpoint }, error.retryAt);
      }
      if (error instanceof PublicDiscoverySearchContinuationError) throw animeLane.unavailable ?? animeLane.retainedFailure ?? new IncompleteProviderSearchError('unknown-anime-lane-unavailable');
      throw error;
    }
    const lanes = [animeLane, mangaLane];
    const unavailable = lanes.reduce<Error | undefined>((retained, lane) => lane.unavailable === undefined
      ? retained : retainProviderFailure(retained, lane.unavailable), undefined);
    if (unavailable !== undefined) throw lanes.reduce((failure, lane) => lane.retainedFailure === undefined
      ? failure : retainProviderFailure(failure, lane.retainedFailure), unavailable);
    return lanes;
  }
  const lanes = request.query.mediaKind === 'ANIME'
    ? [await searchLane(providers, animeProviders, titles, query, deadline, request.searchProgress, true)]
    : [await searchLane(providers, mangaSearchProviders, titles, query, deadline, request.searchProgress, true)];
  const unavailable = lanes.reduce<Error | undefined>((retained, lane) => lane.unavailable === undefined
    ? retained : retainProviderFailure(retained, lane.unavailable), undefined);
  if (unavailable !== undefined) {
    throw lanes.reduce((failure, lane) => lane.retainedFailure === undefined
      ? failure : retainProviderFailure(failure, lane.retainedFailure), unavailable);
  }
  return lanes;
}

function providerOrderFor(request: PublicDiscoveryClaimedRequest): readonly ResolutionProvider[] {
  if (request.query.mediaKind === 'ANIME') return animeProviders;
  if (request.query.mediaKind === 'MANHWA' || request.query.mediaKind === 'MANHUA') return mangaSearchProviders;
  if (request.query.mediaKind === 'MANGA') return mangaSearchProviders;
  return [];
}

type SelectedMatch =
  | { readonly kind: 'terminal'; readonly resolution: PublicDiscoveryTerminalResolution }
  | { readonly kind: 'matched'; readonly reference: PublicDiscoveryReferenceV3; readonly searched: ProviderCandidate | undefined; readonly retainedFailure?: Error };

function selectMatch(lanes: readonly LaneDecision[]): SelectedMatch {
  const credible = lanes.filter((lane) => lane.state !== 'NOT_FOUND');
  if (credible.length === 0) return { kind: 'terminal', resolution: { reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' } };
  if (credible.length > 1 || credible[0]?.state === 'AMBIGUOUS') {
    const values = credible.flatMap((lane) => lane.references);
    return { kind: 'terminal', resolution: { candidates: values.slice(0, 10), reason: 'multiple-credible-provider-identities', state: 'AMBIGUOUS' } };
  }
  const lane = credible[0];
  const reference = lane?.references[0];
  if (lane === undefined || reference === undefined) throw new Error('matched-reference-missing');
  const searched = lane.candidates.find((candidate) => candidate.provider === reference.provider && candidate.externalId === reference.externalId);
  return lane.retainedFailure === undefined ? { kind: 'matched', reference, searched }
    : { kind: 'matched', reference, searched, retainedFailure: lane.retainedFailure };
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function references(candidate: ProviderCandidate): PublicDiscoveryReferenceV3[] {
  const values = [{ provider: candidate.provider, externalId: candidate.externalId }, ...(candidate.linkedReferences ?? [])];
  return [...new Map(values.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()].slice(0, 5);
}

async function verified(candidate: ProviderCandidate): Promise<PublicDiscoveryTerminalResolution> {
  const parsed = publicDiscoveryCandidateSchema.parse(candidate);
  return {
    profile: {
      candidate: parsed,
      references: references(parsed),
      workId: `work_${(await sha256(`${parsed.provider}:${parsed.externalId}`)).slice(0, 48)}`,
    },
    state: 'VERIFIED',
  };
}

async function hydrateReference(
  providers: PublicDiscoveryProviderPorts,
  reference: PublicDiscoveryReferenceV3,
  notFoundReason: 'exact-provider-identity-not-found' | 'matched-provider-identity-not-found',
  searched?: ProviderCandidate,
  matchQuery?: FavoriteTitleMatchQuery,
): Promise<PublicDiscoveryTerminalResolution> {
  let candidate: ProviderCandidate | undefined;
  try { candidate = await providers[reference.provider].hydrate(reference); }
  catch (error) {
    if (reference.provider !== 'mangaupdates' || searched === undefined || !(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error;
    candidate = searched;
  }
  if (candidate === undefined) return { reason: notFoundReason, state: 'NOT_FOUND' };
  if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('hydrated-identity-mismatch');
  if (matchQuery !== undefined && !isPublicDiscoveryCandidateCompatible(matchQuery, candidate, searched)) throw new Error('hydrated-candidate-incompatible');
  return verified(candidate);
}

async function hydrateExplicitWithLinkedFallback(
  providers: PublicDiscoveryProviderPorts,
  request: PublicDiscoveryClaimedRequest,
  reference: PublicDiscoveryReferenceV3,
): Promise<PublicDiscoveryTerminalResolution> {
  const deadline = Date.now() + searchDurationMilliseconds;
  let primaryFailure: Error;
  try { return await hydrateReference(providers, reference, 'exact-provider-identity-not-found'); }
  catch (error) {
    if (!(error instanceof Error) || reference.provider !== 'mangaupdates'
      || error instanceof FavoriteProviderRetryError || !isTransientProviderError(error)
      || isProviderInvariantError(error)) throw error;
    primaryFailure = error;
  }
  const titles = request.query.discoveryTitles.slice(0, 4);
  const query = matchQueryFor(request, titles);
  for (const provider of ['mangadex'] as const) {
    let lane: LaneDecision;
    try { lane = await searchProvider(provider, providers[provider], titles, query, deadline, undefined, false, reference); }
    catch (error) {
      if (!(error instanceof Error) || isProviderInvariantError(error)) throw error;
      continue;
    }
    const linked = lane.candidates.filter((candidate) => matchesLinkedReference(candidate, reference, query));
    if (linked.length !== 1) continue;
    const candidate = linked[0];
    if (candidate === undefined) continue;
    try {
      const resolution = await hydrateReference(providers, { provider: candidate.provider, externalId: candidate.externalId },
        'matched-provider-identity-not-found', candidate, query);
      if (resolution.state !== 'VERIFIED' || !resolution.profile.candidate.linkedReferences?.some((item) =>
        item.provider === reference.provider && item.externalId === reference.externalId)) continue;
      if (matchCandidates([resolution.profile.candidate], query, true)?.state === 'MATCH') return resolution;
    } catch (error) {
      if (!(error instanceof Error) || isProviderInvariantError(error)) throw error;
    }
  }
  throw primaryFailure;
}

async function hydrateWithTransientFallback(
  providers: PublicDiscoveryProviderPorts,
  request: PublicDiscoveryClaimedRequest,
  reference: PublicDiscoveryReferenceV3,
  searched: ProviderCandidate | undefined,
  deadline: number,
  retainedFailure: Error | undefined,
): Promise<PublicDiscoveryTerminalResolution> {
  const titles = request.query.discoveryTitles.slice(0, 4);
  const query = matchQueryFor(request, titles);
  try {
    const resolution = await hydrateReference(providers, reference, 'matched-provider-identity-not-found', searched, query);
    if (resolution.state === 'NOT_FOUND' && retainedFailure !== undefined) throw retainedFailure;
    return resolution;
  } catch (error) {
    if (!(error instanceof Error) || isProviderInvariantError(error)) throw error;
    const order = providerOrderFor(request);
    const start = Math.max(0, order.indexOf(reference.provider) + 1);
    let lastUnavailable = retainProviderFailure(retainedFailure, error);
    for (const linked of searched?.linkedReferences ?? []) {
      if (!order.slice(start).includes(linked.provider)) continue;
      try {
        const resolution = await hydrateReference(providers, linked, 'matched-provider-identity-not-found');
        if (resolution.state === 'VERIFIED' && isPublicDiscoveryCandidateCompatible(query, resolution.profile.candidate)
          && matchCandidates([resolution.profile.candidate], query, true)?.state === 'MATCH') return resolution;
      } catch (linkedError) {
        if (!(linkedError instanceof Error) || isProviderInvariantError(linkedError)) throw linkedError;
        lastUnavailable = retainProviderFailure(lastUnavailable, linkedError);
      }
    }
    for (const provider of order.slice(start)) {
      let lane: LaneDecision;
      try {
        lane = await searchLane(providers, [provider], titles, query, deadline);
      } catch (fallbackError) {
        if (!(fallbackError instanceof Error) || !isTransientProviderError(fallbackError)) throw fallbackError;
        lastUnavailable = retainProviderFailure(lastUnavailable, fallbackError);
        continue;
      }
      if (lane.state !== 'MATCH' || lane.references.length !== 1) {
        if (lane.unavailable !== undefined) lastUnavailable = retainProviderFailure(lastUnavailable, lane.unavailable);
        continue;
      }
      const fallbackReference = lane.references[0];
      if (fallbackReference === undefined) continue;
      const fallbackCandidate = lane.candidates.find((candidate) => candidate.provider === fallbackReference.provider && candidate.externalId === fallbackReference.externalId);
      try {
        const resolution = await hydrateReference(providers, fallbackReference, 'matched-provider-identity-not-found', fallbackCandidate, query);
        if (resolution.state !== 'NOT_FOUND') return resolution;
      } catch (fallbackError) {
        if (!(fallbackError instanceof Error) || isProviderInvariantError(fallbackError)) throw fallbackError;
        lastUnavailable = retainProviderFailure(lastUnavailable, fallbackError);
      }
    }
    throw lastUnavailable;
  }
}

export function createPublicDiscoveryResolver(providers: PublicDiscoveryProviderPorts = createPublicDiscoveryProviders()) {
  return {
    async resolve(request: PublicDiscoveryClaimedRequest): Promise<PublicDiscoveryTerminalResolution> {
      const explicit = request.query.explicitProviderReference;
      if (explicit !== undefined) return hydrateExplicitWithLinkedFallback(providers, request, explicit);
      const deadline = Date.now() + searchDurationMilliseconds;
      const selected = selectMatch(await searchApplicableLanes(providers, request, deadline));
      return selected.kind === 'terminal'
        ? selected.resolution
        : hydrateWithTransientFallback(providers, request, selected.reference, selected.searched, deadline, selected.retainedFailure);
    },
  };
}
