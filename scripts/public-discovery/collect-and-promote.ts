import {
  AniListFavoriteProviderAdapter,
  KitsuFavoriteProviderAdapter,
  MangaDexFavoriteProviderAdapter,
  MangaUpdatesFavoriteProviderAdapter,
} from '@tobirink/adapters-browser';
import {
  resolveFavoriteProviderLanes,
  type FavoriteProviderCandidatePort,
  type FavoriteProviderHydrationPort,
  type FavoriteSearchCheckpoint,
  type FavoriteSearchCheckpointPort,
  type FavoriteTitleMatchQuery,
  type ResolutionProvider,
} from '@tobirink/application';
import {
  publicDiscoveryCandidateSchema,
  publicDiscoveryClaimBatchSchema,
  publicDiscoveryReceiptSchema,
  runPublicDiscoveryBatch,
  type PublicDiscoveryClaimedRequest,
  type PublicDiscoveryGatewayPort,
  type PublicDiscoveryReferenceV2,
  type PublicDiscoveryResultBatch,
  type PublicDiscoveryTerminalResolution,
} from '@tobirink/public-discovery';
import type { ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';

type MutableMatchQuery = { -readonly [Key in keyof FavoriteTitleMatchQuery]: FavoriteTitleMatchQuery[Key] };

const tokenSchema = z.string().min(32).max(8192);
function requiredEnvironment(name: 'DISCOVERY_CLAIM_OIDC_TOKEN' | 'DISCOVERY_RESULT_OIDC_TOKEN'): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing-${name.toLowerCase()}`);
  return tokenSchema.parse(value);
}

function providerAdapter(provider: ResolutionProvider): FavoriteProviderCandidatePort & FavoriteProviderHydrationPort {
  if (provider === 'anilist') return new AniListFavoriteProviderAdapter();
  if (provider === 'mangaupdates') return new MangaUpdatesFavoriteProviderAdapter();
  if (provider === 'mangadex') return new MangaDexFavoriteProviderAdapter();
  return new KitsuFavoriteProviderAdapter(provider);
}

const providers = Object.freeze({
  anilist: providerAdapter('anilist'),
  mangaupdates: providerAdapter('mangaupdates'),
  mangadex: providerAdapter('mangadex'),
  'kitsu-anime': providerAdapter('kitsu-anime'),
  'kitsu-manga': providerAdapter('kitsu-manga'),
});

function checkpoints(): FavoriteSearchCheckpointPort {
  const values = new Map<ResolutionProvider, FavoriteSearchCheckpoint>();
  return { now: Date.now, read: async (provider) => values.get(provider), save: async (value) => { values.set(value.provider, value); } };
}

async function workId(candidate: ProviderCandidate): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${candidate.provider}:${candidate.externalId}`)));
  return `work_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 48)}`;
}

function references(candidate: ProviderCandidate): PublicDiscoveryReferenceV2[] {
  const values = [{ provider: candidate.provider, externalId: candidate.externalId }, ...(candidate.linkedReferences ?? [])];
  return [...new Map(values.map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()].slice(0, 5);
}

async function resolve(request: PublicDiscoveryClaimedRequest): Promise<PublicDiscoveryTerminalResolution> {
  const query: MutableMatchQuery = {
    discoveryTitles: request.query.discoveryTitles.slice(0, 4),
    sourceTitles: request.query.sourceTitles,
  };
  if (request.query.explicitProviderReference !== undefined) query.explicitProviderReference = request.query.explicitProviderReference;
  if (request.query.season !== undefined) query.explicitSeason = request.query.season;
  if (request.query.mediaKind !== 'UNKNOWN') query.mediaKind = request.query.mediaKind;
  if (request.query.preSerialization !== undefined) query.preSerialization = request.query.preSerialization;
  if (request.query.sourceFormat !== undefined) query.sourceFormat = request.query.sourceFormat;
  const checkpoint = checkpoints();
  for (let step = 0; step < 8; step += 1) {
    const lane = await resolveFavoriteProviderLanes(providers, query, request.query.mediaKind, checkpoint);
    if (lane.kind === 'PAGE_PENDING') continue;
    if (lane.kind === 'RETRYABLE') throw new Error(lane.reason);
    if (lane.decision.kind === 'NO_MATCH') return { reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' };
    if (lane.decision.kind === 'AMBIGUOUS') {
      return { candidates: lane.decision.candidateReferences, reason: lane.decision.reasons.join(','), state: 'AMBIGUOUS' };
    }
    const reference = lane.decision.matchedReference;
    const searched = lane.envelopes.flatMap((envelope) => envelope.candidates)
      .find((candidate) => candidate.provider === reference.provider && candidate.externalId === reference.externalId);
    let candidate: ProviderCandidate | undefined;
    try { candidate = await providers[reference.provider].hydrate(reference); }
    catch (error) {
      if (reference.provider !== 'mangaupdates' || !(error instanceof Error) || !/HTTP 405\b/u.test(error.message)) throw error;
      candidate = searched;
    }
    if (!candidate) return { reason: 'matched-provider-identity-not-found', state: 'NOT_FOUND' };
    return {
      profile: {
        candidate: publicDiscoveryCandidateSchema.parse(candidate),
        references: references(candidate),
        workId: await workId(candidate),
      },
      state: 'VERIFIED',
    };
  }
  throw new Error('public-discovery-checkpoint-limit');
}

function gateway(claimToken: string, resultToken: string): PublicDiscoveryGatewayPort {
  return {
    async claim(limit) {
      const response = await fetch('https://tobirink.com/v3/catalogue/discoveries/collector/claims', {
        body: JSON.stringify({ limit }), headers: { Authorization: `Bearer ${claimToken}`, 'Content-Type': 'application/json' },
        method: 'POST', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`discovery-claim-${response.status}:${(await response.text()).slice(0, 256)}`);
      return publicDiscoveryClaimBatchSchema.parse(await response.json());
    },
    async publish(batch: PublicDiscoveryResultBatch) {
      const response = await fetch('https://tobirink.com/v3/catalogue/discoveries/results', {
        body: JSON.stringify(batch), headers: { Authorization: `Bearer ${resultToken}`, 'Content-Type': 'application/json' },
        method: 'POST', signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`discovery-result-${response.status}:${(await response.text()).slice(0, 256)}`);
      return publicDiscoveryReceiptSchema.parse(await response.json());
    },
  };
}

async function run(): Promise<void> {
  const report = await runPublicDiscoveryBatch({
    gateway: gateway(requiredEnvironment('DISCOVERY_CLAIM_OIDC_TOKEN'), requiredEnvironment('DISCOVERY_RESULT_OIDC_TOKEN')),
    limit: 20,
    nonce: crypto.randomUUID,
    now: () => new Date().toISOString(),
    resolver: { resolve },
  });
  process.stdout.write(`${JSON.stringify({ event: 'public_discovery_batch', ...report })}\n`);
}

await run();
