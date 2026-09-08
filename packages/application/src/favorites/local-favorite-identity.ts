import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { FavoriteParseArtifact, ProviderCandidate, Work } from '@tobirink/domain';
import type { StorageReadPort } from '../ports/storage-port';
import { favoriteMatcherVersion, inspectFavoriteTitleCandidates, isProviderCandidateCompatible, matchFavoriteTitles } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { normalizeFavoriteTitle } from './title-normalization';

export function favoriteArtifactAliasKeys(artifact: FavoriteParseArtifact, candidate?: ProviderCandidate): readonly string[] {
  const titles = [artifact.displayTitle, ...(artifact.aliases ?? []).map((alias) => alias.value)].filter((value) => value !== undefined);
  const proven = candidate === undefined ? titles : titles.filter((title) => inspectFavoriteTitleCandidates({ sourceTitles: [title] }, [candidate]).candidateReferences.length === 1);
  return [...new Set(proven.map((title) => JSON.stringify([artifact.mediaKind, artifact.season ?? null, normalizeFavoriteTitle(title).normalized])))];
}

export type LocalFavoriteIdentity =
  | { readonly kind: 'MISS' }
  | { readonly kind: 'MATCH'; readonly candidate: ProviderCandidate; readonly work: Work; readonly provenance: 'local-alias' | 'hydrated-title' }
  | { readonly kind: 'AMBIGUOUS'; readonly candidates: readonly ProviderCandidate[]; readonly provenance: 'local-alias' | 'hydrated-title' };

function identityKey(candidate: ProviderCandidate): string { return `${candidate.provider}:${candidate.externalId}`; }

export async function readLocalFavoriteIdentity(storage: StorageReadPort, artifact: FavoriteParseArtifact, query: FavoriteTitleMatchQuery): Promise<LocalFavoriteIdentity> {
  const stages = [
    { keys: favoriteArtifactAliasKeys(artifact), kind: 'favorite-alias' as const, provenance: 'local-alias' as const },
    { keys: [...new Set(query.sourceTitles.map((title) => normalizeFavoriteTitle(title).normalized))], kind: 'provider-title' as const, provenance: 'hydrated-title' as const },
  ];
  for (const stage of stages) {
    const works = new Map<string, Work & { hydration: NonNullable<Work['hydration']> }>();
    for (const key of stage.keys) {
      const page = await storage.listWorksByIdentityKey({ key, kind: stage.kind, limit: 21 });
      if (page.length > 20) return { kind: 'MISS' };
      for (const work of page) {
        const hydration = work.hydration;
        if (hydration === undefined || !isProviderCandidateCompatible(query, hydration.candidate)) continue;
        if (stage.kind === 'favorite-alias' && hydration.matcherVersion !== favoriteMatcherVersion) continue;
        works.set(identityKey(hydration.candidate), { ...work, hydration });
      }
    }
    if (works.size === 0) continue;
    if (works.size > 20) return { kind: 'MISS' };
    let candidates = [...works.values()].map((work) => work.hydration.candidate);
    if (stage.kind === 'provider-title') {
      const providers = [...new Set(candidates.map((candidate) => candidate.provider))];
      const envelopes = providers.map((provider) => createProviderCandidateEnvelope({ candidates: candidates.filter((candidate) => candidate.provider === provider), complete: true, digest: 'local-hydration', provider, truncated: false }));
      const decision = matchFavoriteTitles(query, envelopes);
      if (decision.kind === 'NO_MATCH' || decision.kind === 'INCOMPLETE_CANDIDATE_SET') continue;
      const matched = new Set(decision.candidateReferences.map((reference) => `${reference.provider}:${reference.externalId}`));
      candidates = candidates.filter((candidate) => matched.has(identityKey(candidate)));
    }
    if (candidates.length > 1) return { kind: 'AMBIGUOUS', candidates, provenance: stage.provenance };
    const candidate = candidates[0];
    const work = candidate === undefined ? undefined : works.get(identityKey(candidate));
    if (candidate !== undefined && work !== undefined) return { kind: 'MATCH', candidate, work, provenance: stage.provenance };
  }
  return { kind: 'MISS' };
}
