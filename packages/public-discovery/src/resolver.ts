import { publicDiscoveryCandidateSchema } from './contracts.js';
import type { PublicDiscoveryClaimedRequest, PublicDiscoveryReferenceV2, PublicDiscoveryTerminalResolution } from './contracts.js';
import { inspectFavoriteTitleCandidates } from './provider-kit.js';
import type { FavoriteProviderPort, FavoriteTitleMatchQuery, ProviderCandidate, ResolutionProvider } from './provider-kit.js';
import { AniListFavoriteProviderAdapter } from './providers/anilist.js';
import { KitsuFavoriteProviderAdapter } from './providers/kitsu.js';
import { MangaDexFavoriteProviderAdapter } from './providers/mangadex.js';
import { MangaUpdatesFavoriteProviderAdapter } from './providers/mangaupdates.js';

export type PublicDiscoveryProviderPorts = Readonly<Record<ResolutionProvider, FavoriteProviderPort>>;

export function createPublicDiscoveryProviders(): PublicDiscoveryProviderPorts {
  return Object.freeze({
    anilist: new AniListFavoriteProviderAdapter(),
    mangaupdates: new MangaUpdatesFavoriteProviderAdapter(),
    mangadex: new MangaDexFavoriteProviderAdapter(),
    'kitsu-anime': new KitsuFavoriteProviderAdapter('kitsu-anime'),
    'kitsu-manga': new KitsuFavoriteProviderAdapter('kitsu-manga'),
  });
}

interface LaneDecision {
  readonly candidates: readonly ProviderCandidate[];
  readonly references: readonly PublicDiscoveryReferenceV2[];
  readonly state: 'MATCH' | 'AMBIGUOUS' | 'NOT_FOUND';
}
interface MutableTitleMatchQuery {
  mediaKind?: ProviderCandidate['mediaKind'];
  preSerialization?: boolean;
  sourceTitles: readonly string[];
}

function candidateKey(candidate: ProviderCandidate): string { return `${candidate.provider}:${candidate.externalId}`; }

function matchQueryFor(request: PublicDiscoveryClaimedRequest, titles: readonly string[]): FavoriteTitleMatchQuery {
  const query: MutableTitleMatchQuery = { sourceTitles: request.query.sourceTitles.length > 0 ? request.query.sourceTitles : titles };
  if (request.query.mediaKind !== 'UNKNOWN') query.mediaKind = request.query.mediaKind;
  if (request.query.preSerialization !== undefined) query.preSerialization = request.query.preSerialization;
  return query;
}

async function searchProvider(
  provider: ResolutionProvider,
  port: FavoriteProviderPort,
  titles: readonly string[],
  matchQuery: FavoriteTitleMatchQuery,
): Promise<LaneDecision> {
  const candidates = new Map<string, ProviderCandidate>();
  for (const title of titles.slice(0, 4)) {
    const envelope = await port.search({ limit: 20, provider, titles: [title] });
    if (envelope.provider !== provider) throw new Error('provider-envelope-mismatch');
    for (const candidate of envelope.candidates) candidates.set(candidateKey(candidate), candidate);
    const bounded = [...candidates.values()].slice(0, 25);
    const evidence = inspectFavoriteTitleCandidates(matchQuery, bounded);
    if (evidence.candidateReferences.length === 1 && (evidence.level === 'source-id' || evidence.level === 'ordered-exact')) {
      return { candidates: bounded, references: evidence.candidateReferences, state: 'MATCH' };
    }
    if (evidence.candidateReferences.length > 1 && evidence.level === 'ordered-exact') {
      return { candidates: bounded, references: evidence.candidateReferences, state: 'AMBIGUOUS' };
    }
  }
  const bounded = [...candidates.values()].slice(0, 25);
  const evidence = inspectFavoriteTitleCandidates(matchQuery, bounded);
  if (evidence.candidateReferences.length === 0) return { candidates: bounded, references: [], state: 'NOT_FOUND' };
  return { candidates: bounded, references: evidence.candidateReferences, state: evidence.candidateReferences.length === 1 ? 'MATCH' : 'AMBIGUOUS' };
}

async function searchLane(
  providers: PublicDiscoveryProviderPorts,
  order: readonly ResolutionProvider[],
  titles: readonly string[],
  query: FavoriteTitleMatchQuery,
): Promise<LaneDecision> {
  const inspected: ProviderCandidate[] = [];
  for (const provider of order) {
    const result = await searchProvider(provider, providers[provider], titles, query);
    inspected.push(...result.candidates);
    if (result.state !== 'NOT_FOUND') return { ...result, candidates: inspected };
  }
  return { candidates: inspected, references: [], state: 'NOT_FOUND' };
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function references(candidate: ProviderCandidate): PublicDiscoveryReferenceV2[] {
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

export function createPublicDiscoveryResolver(providers: PublicDiscoveryProviderPorts = createPublicDiscoveryProviders()) {
  return {
    async resolve(request: PublicDiscoveryClaimedRequest): Promise<PublicDiscoveryTerminalResolution> {
      const explicit = request.query.explicitProviderReference;
      if (explicit !== undefined) {
        const candidate = await providers[explicit.provider].hydrate(explicit);
        return candidate === undefined ? { reason: 'exact-provider-identity-not-found', state: 'NOT_FOUND' } : verified(candidate);
      }

      const titles = request.query.discoveryTitles.slice(0, 4);
      const query = matchQueryFor(request, titles);
      const lanes = request.query.mediaKind === 'ANIME'
        ? [await searchLane(providers, ['anilist', 'kitsu-anime'], titles, query)]
        : request.query.mediaKind === 'UNKNOWN'
          ? [
              await searchLane(providers, ['anilist', 'kitsu-anime'], titles, { ...query, mediaKind: 'ANIME' }),
              await searchLane(providers, ['mangaupdates', 'mangadex', 'kitsu-manga'], titles, { ...query, mediaKind: 'MANGA' }),
            ]
          : [await searchLane(providers, ['mangaupdates', 'mangadex', 'kitsu-manga'], titles, query)];
      const credible = lanes.filter((lane) => lane.state !== 'NOT_FOUND');
      if (credible.length === 0) return { reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' };
      if (credible.length > 1 || credible[0]?.state === 'AMBIGUOUS') {
        const values = credible.flatMap((lane) => lane.references);
        return { candidates: values.slice(0, 10), reason: 'multiple-credible-provider-identities', state: 'AMBIGUOUS' };
      }
      const lane = credible[0];
      const reference = lane?.references[0];
      if (lane === undefined || reference === undefined) throw new Error('matched-reference-missing');
      const searched = lane.candidates.find((candidate) => candidate.provider === reference.provider && candidate.externalId === reference.externalId);
      let candidate: ProviderCandidate | undefined;
      try { candidate = await providers[reference.provider].hydrate(reference); }
      catch (error) {
        if (reference.provider !== 'mangaupdates' || !(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error;
        candidate = searched;
      }
      return candidate === undefined ? { reason: 'matched-provider-identity-not-found', state: 'NOT_FOUND' } : verified(candidate);
    },
  };
}
