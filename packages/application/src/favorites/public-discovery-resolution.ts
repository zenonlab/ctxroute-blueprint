import type { FavoriteParseArtifact } from '@tobirink/domain';
import type { PublicDiscoveryKey } from '../public-discovery';
import type { PublicDiscoveryRequestClientPort } from '../public-discovery';
import type { PublicDiscoveryQuery, PublicDiscoveryReadState } from '@tobirink/public-discovery';
import type { FavoritePublicReference } from './favorite-identity-lookup';
import { favoriteProviderDiscoveryTitles, hasFavoriteOvaMarker, hasFavoritePreSerializationMarker, normalizeFavoriteTitle } from './title-normalization';

function cleanedTitles(artifact: FavoriteParseArtifact): readonly string[] {
  const titles = [artifact.displayTitle, ...(artifact.aliases ?? []).map((alias) => alias.value)]
    .filter((title): title is string => title !== undefined);
  const unique = new Map<string, string>();
  for (const title of titles) {
    if (/^https?:\/\//iu.test(title.trim())) continue;
    const normalized = normalizeFavoriteTitle(title).normalized;
    if (normalized.length > 0 && !unique.has(normalized)) unique.set(normalized, title);
  }
  return [...unique.values()];
}

export async function requestPublicFavoriteDiscovery(
  port: PublicDiscoveryRequestClientPort,
  key: PublicDiscoveryKey,
  artifact: FavoriteParseArtifact,
  options?: { readonly explicitProviderReference?: FavoritePublicReference },
): Promise<PublicDiscoveryReadState> {
  const explicit = options?.explicitProviderReference ?? artifact.sourceEvidence.explicitProviderReference;
  const sourceTitles = [...cleanedTitles(artifact)].slice(0, 4);
  if (sourceTitles.length === 0 && explicit !== undefined) sourceTitles.push(explicit.externalId);
  if (sourceTitles.length === 0) return { state: 'MISS' };
  const query: PublicDiscoveryQuery = {
    discoveryTitles: [...favoriteProviderDiscoveryTitles(sourceTitles)],
    mediaKind: artifact.mediaKind,
    sourceTitles,
  };
  if (explicit !== undefined) query.explicitProviderReference = explicit;
  if (artifact.season !== undefined && artifact.seasonEvidence?.conflict !== true) query.season = artifact.season;
  query.preSerialization = hasFavoritePreSerializationMarker(sourceTitles);
  query.sourceFormat = hasFavoriteOvaMarker(sourceTitles) ? 'OVA' : 'NON_OVA';
  return port.resolveOrRequest(key, query);
}

export async function requestPublicFavoriteDiscoveryRecovery(
  port: PublicDiscoveryRequestClientPort,
  key: PublicDiscoveryKey,
  artifact: FavoriteParseArtifact,
  options?: { readonly explicitProviderReference?: FavoritePublicReference },
): Promise<PublicDiscoveryReadState> {
  if (port.requestRecovery === undefined) throw new Error('PUBLIC_DISCOVERY_RECOVERY_UNAVAILABLE');
  const recoveryPort: PublicDiscoveryRequestClientPort = { ...port, resolveOrRequest: port.requestRecovery };
  return requestPublicFavoriteDiscovery(recoveryPort, key, artifact, options);
}
