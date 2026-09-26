import { publicDiscoveryCandidateSchema } from './contracts.js';
import type { PublicDiscoveryClaimedRequest, PublicDiscoveryReferenceV3, PublicDiscoveryTerminalResolution } from './contracts.js';
import { favoriteProviderInspectionLimit, FavoriteProviderRetryError, inspectFavoriteTitleCandidates } from './provider-kit.js';
import type { FavoriteProviderPort, FavoriteTitleMatchQuery, ProviderCandidate, ResolutionProvider } from './provider-kit.js';
import { AniListFavoriteProviderAdapter } from './providers/anilist.js';
import { KitsuFavoriteProviderAdapter } from './providers/kitsu.js';
import { MangaDexFavoriteProviderAdapter } from './providers/mangadex.js';
import { MangaUpdatesFavoriteProviderAdapter } from './providers/mangaupdates.js';
import { FavoriteProviderHttpError, FavoriteProviderRateGate } from './provider-http.js';
import type { FavoriteProviderFetch, FavoriteProviderRuntimeControlPort } from './provider-http.js';

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
  mediaKind?: ProviderCandidate['mediaKind'];
  preSerialization?: boolean;
  sourceTitles: readonly string[];
}
const animeProviders = ['anilist', 'kitsu-anime'] as const;
const mangaProviders = ['mangaupdates', 'mangadex', 'kitsu-manga'] as const;
const searchPageLimit = 4;
const searchDurationMilliseconds = 20_000;

class IncompleteProviderSearchError extends Error {
  constructor(reason: string) { super(`incomplete-provider-search:${reason}`); }
}

function candidateKey(candidate: ProviderCandidate): string { return `${candidate.provider}:${candidate.externalId}`; }

function matchQueryFor(request: PublicDiscoveryClaimedRequest, titles: readonly string[]): FavoriteTitleMatchQuery {
  const query: MutableTitleMatchQuery = { sourceTitles: request.query.sourceTitles.length > 0 ? request.query.sourceTitles : titles };
  if (request.query.mediaKind !== 'UNKNOWN') query.mediaKind = request.query.mediaKind;
  if (request.query.preSerialization !== undefined) query.preSerialization = request.query.preSerialization;
  return query;
}

function matchCandidates(candidates: readonly ProviderCandidate[], query: FavoriteTitleMatchQuery, aliasesExhausted: boolean): LaneDecision | undefined {
  const evidence = inspectFavoriteTitleCandidates(query, candidates);
  if (!aliasesExhausted) {
    if (evidence.candidateReferences.length === 1 && (evidence.level === 'source-id' || evidence.level === 'ordered-exact')) {
      return { candidates, references: evidence.candidateReferences, state: 'MATCH' };
    }
    if (evidence.candidateReferences.length > 1 && evidence.level === 'ordered-exact') {
      return { candidates, references: evidence.candidateReferences, state: 'AMBIGUOUS' };
    }
    return undefined;
  }
  if (evidence.candidateReferences.length === 0) return { candidates, references: [], state: 'NOT_FOUND' };
  return { candidates, references: evidence.candidateReferences, state: evidence.candidateReferences.length === 1 ? 'MATCH' : 'AMBIGUOUS' };
}

async function searchProvider(
  provider: ResolutionProvider,
  port: FavoriteProviderPort,
  titles: readonly string[],
  matchQuery: FavoriteTitleMatchQuery,
  deadline: number,
): Promise<LaneDecision> {
  const candidates = new Map<string, ProviderCandidate>();
  for (const title of [...new Set(titles)].slice(0, 4)) {
    let cursor = '1';
    const seen = new Set(['1']);
    for (let page = 0; page < searchPageLimit; page += 1) {
      const envelope = await searchBeforeDeadline(port, { cursor, limit: 20, provider, titles: [title] }, deadline);
      if (envelope.provider !== provider) throw new Error('provider-envelope-mismatch');
      if (envelope.candidates.length > 20) throw new IncompleteProviderSearchError('candidate-page-limit');
      // An exact identity may be accepted without exhausting every fuzzy result.
      // Inspect each page before retaining candidates, so a later exact match is not sliced away.
      const early = matchCandidates(envelope.candidates, matchQuery, false);
      if (early) return early;
      for (const candidate of envelope.candidates) {
        if (inspectFavoriteTitleCandidates(matchQuery, [candidate]).candidateReferences.length === 0) continue;
        candidates.set(candidateKey(candidate), candidate);
        if (candidates.size > favoriteProviderInspectionLimit) throw new IncompleteProviderSearchError('candidate-limit');
      }
      if (envelope.complete && !envelope.truncated && envelope.nextCursor === undefined) break;
      const next = envelope.nextCursor;
      if (envelope.complete || next === undefined || !/^[1-9]\d{0,4}$/u.test(next) || seen.has(next)) {
        throw new IncompleteProviderSearchError('cursor');
      }
      if (page + 1 === searchPageLimit) throw new IncompleteProviderSearchError('page-limit');
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
  if (incoming instanceof FavoriteProviderRetryError) {
    if (current !== undefined && !(current instanceof FavoriteProviderRetryError)) return current;
    if (current instanceof FavoriteProviderRetryError && current.retryAt > incoming.retryAt) return current;
  }
  return incoming;
}

function isProviderInvariantError(error: Error): boolean {
  return /(?:provider-envelope-mismatch|provider-matching-decision-missing|hydrated-identity-mismatch)/u.test(error.message);
}

async function searchLane(
  providers: PublicDiscoveryProviderPorts,
  order: readonly ResolutionProvider[],
  titles: readonly string[],
  query: FavoriteTitleMatchQuery,
  deadline: number,
): Promise<LaneDecision> {
  const inspected: ProviderCandidate[] = [];
  let unavailable: Error | undefined;
  for (const provider of order) {
    let result: LaneDecision;
    try {
      result = await searchProvider(provider, providers[provider], titles, query, deadline);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (isProviderInvariantError(error)) throw error;
      // Bounded incomplete searches consume an attempt; do not turn them into
      // cadence-only deferrals that could restart page one without limit.
      unavailable = retainProviderFailure(unavailable, error);
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
  const lanes = request.query.mediaKind === 'ANIME'
    ? [await searchLane(providers, animeProviders, titles, query, deadline)]
    : request.query.mediaKind !== 'UNKNOWN'
      ? [await searchLane(providers, mangaProviders, titles, query, deadline)]
      : [
          await searchLane(providers, animeProviders, titles, { ...query, mediaKind: 'ANIME' }, deadline),
          await searchLane(providers, mangaProviders, titles, { ...query, mediaKind: 'MANGA' }, deadline),
        ];
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
  if (request.query.mediaKind === 'MANGA' || request.query.mediaKind === 'MANHWA' || request.query.mediaKind === 'MANHUA') return mangaProviders;
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
): Promise<PublicDiscoveryTerminalResolution> {
  let candidate: ProviderCandidate | undefined;
  try { candidate = await providers[reference.provider].hydrate(reference); }
  catch (error) {
    if (reference.provider !== 'mangaupdates' || searched === undefined || !(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error;
    candidate = searched;
  }
  if (candidate === undefined) return { reason: notFoundReason, state: 'NOT_FOUND' };
  if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('hydrated-identity-mismatch');
  return verified(candidate);
}

async function hydrateWithTransientFallback(
  providers: PublicDiscoveryProviderPorts,
  request: PublicDiscoveryClaimedRequest,
  reference: PublicDiscoveryReferenceV3,
  searched: ProviderCandidate | undefined,
  deadline: number,
  retainedFailure: Error | undefined,
): Promise<PublicDiscoveryTerminalResolution> {
  try {
    const resolution = await hydrateReference(providers, reference, 'matched-provider-identity-not-found', searched);
    if (resolution.state === 'NOT_FOUND' && retainedFailure !== undefined) throw retainedFailure;
    return resolution;
  } catch (error) {
    if (!(error instanceof Error) || isProviderInvariantError(error)) throw error;
    const order = providerOrderFor(request);
    const start = Math.max(0, order.indexOf(reference.provider) + 1);
    let lastUnavailable = retainProviderFailure(retainedFailure, error);
    const titles = request.query.discoveryTitles.slice(0, 4);
    const query = matchQueryFor(request, titles);
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
        const resolution = await hydrateReference(providers, fallbackReference, 'matched-provider-identity-not-found', fallbackCandidate);
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
      if (explicit !== undefined) return hydrateReference(providers, explicit, 'exact-provider-identity-not-found');
      const deadline = Date.now() + searchDurationMilliseconds;
      const selected = selectMatch(await searchApplicableLanes(providers, request, deadline));
      return selected.kind === 'terminal'
        ? selected.resolution
        : hydrateWithTransientFallback(providers, request, selected.reference, selected.searched, deadline, selected.retainedFailure);
    },
  };
}
