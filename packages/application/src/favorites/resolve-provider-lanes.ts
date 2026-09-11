import { createResolutionDecision } from '@tobirink/domain';
import type { FavoriteMediaKind, ProviderCandidateEnvelope, ResolutionDecision } from '@tobirink/domain';
import { matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import type { FavoriteProviderCandidatePort, ResolutionProvider } from './provider-ports';
import { FavoriteProviderRetryError } from './provider-ports';
import { searchFavoriteProviderPage } from './provider-search-checkpoint';
import type { FavoriteSearchCheckpointPort } from './provider-search-checkpoint';

export type ProviderLaneResult =
  | { readonly kind: 'PAGE_PENDING' }
  | { readonly kind: 'RETRYABLE'; readonly reason: 'PROVIDER_UNAVAILABLE' | 'INCOMPLETE_CANDIDATE_SET'; readonly retryAt?: number }
  | { readonly kind: 'COMPLETE'; readonly decision: ResolutionDecision; readonly envelopes: readonly ProviderCandidateEnvelope[] };

async function resolveLane(
  ports: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>,
  query: FavoriteTitleMatchQuery,
  providers: readonly ResolutionProvider[],
  limit: number,
  checkpoints?: FavoriteSearchCheckpointPort,
): Promise<ProviderLaneResult> {
  for (const provider of providers) {
    let envelope: ProviderCandidateEnvelope;
    try {
      const result = await searchFavoriteProviderPage(ports[provider], query, provider, limit, checkpoints);
      if (result.kind === 'PAGE_PENDING') return result;
      envelope = result.envelope;
    } catch (error) {
      // A terminal provider refusal (for example a documented temporary API
      // shutdown returned as 403) permits the controlled fallback lane. Rate
      // limits, timeouts and transport failures remain retryable and never
      // become an implicit NO_MATCH.
      const terminalRefusal = error instanceof Error && /HTTP 403\b/u.test(error.message);
      if (terminalRefusal && provider === providers[0] && providers.length > 1) continue;
      if (error instanceof FavoriteProviderRetryError) return { kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE', retryAt: error.retryAt };
      return { kind: 'RETRYABLE', reason: 'PROVIDER_UNAVAILABLE' };
    }
    if (envelope.provider !== provider) throw new Error('SEARCH_PROVIDER_MISMATCH');
    const decision = matchFavoriteTitles(query, [envelope]);
    if (decision.kind === 'INCOMPLETE_CANDIDATE_SET') return { kind: 'RETRYABLE', reason: decision.kind };
    if (decision.kind !== 'NO_MATCH' || provider === providers.at(-1)) return { kind: 'COMPLETE', decision, envelopes: [envelope] };
  }
  throw new Error('PROVIDER_LANE_REQUIRES_PROVIDERS');
}

export async function resolveFavoriteProviderLanes(
  ports: Readonly<Record<ResolutionProvider, FavoriteProviderCandidatePort>>,
  query: FavoriteTitleMatchQuery,
  mediaKind: FavoriteMediaKind,
  checkpoints?: FavoriteSearchCheckpointPort,
): Promise<ProviderLaneResult> {
  if (mediaKind === 'ANIME') return resolveLane(ports, query, ['anilist', 'kitsu-anime'], 20, checkpoints);
  if (mediaKind !== 'UNKNOWN') return resolveLane(ports, query, ['mangaupdates', 'mangadex', 'kitsu-manga'], 20, checkpoints);
  const lanes = await Promise.all([
    resolveLane(ports, { ...query, mediaKind: 'ANIME' }, ['anilist', 'kitsu-anime'], 10, checkpoints),
    resolveLane(ports, { ...query, mediaKind: 'MANGA' }, ['mangaupdates', 'mangadex', 'kitsu-manga'], 10, checkpoints),
  ]);
  const retry = lanes.find((lane) => lane.kind === 'RETRYABLE');
  if (retry?.kind === 'RETRYABLE') return retry;
  if (lanes.some((lane) => lane.kind === 'PAGE_PENDING')) return { kind: 'PAGE_PENDING' };
  const complete = lanes.filter((lane) => lane.kind === 'COMPLETE');
  const credible = complete.filter((lane) => lane.decision.kind !== 'NO_MATCH');
  const single = credible[0];
  if (credible.length === 1 && single) return single;
  const envelopes = complete.flatMap((lane) => lane.envelopes);
  if (credible.length === 0) {
    return { kind: 'COMPLETE', envelopes, decision: createResolutionDecision({ candidateReferences: [], kind: 'NO_MATCH', level: 'bounded-edit-distance', reasons: ['both-media-lanes-exhausted'] }, envelopes) };
  }
  return {
    kind: 'COMPLETE', envelopes,
    decision: createResolutionDecision({ candidateReferences: credible.flatMap((lane) => lane.decision.candidateReferences), kind: 'AMBIGUOUS', level: single?.decision.level ?? 'ordered-exact', reasons: ['credible-identities-in-both-media-lanes'] }, envelopes),
  };
}
