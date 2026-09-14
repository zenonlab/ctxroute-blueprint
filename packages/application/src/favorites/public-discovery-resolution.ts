import type { FavoriteParseArtifact } from '@tobirink/domain';
import type { PublicDiscoveryKey } from '../public-discovery';
import type { PublicDiscoveryRequestClientPort } from '../public-discovery';
import type { PublicDiscoveryQuery, PublicDiscoveryReadState } from '@tobirink/public-discovery';
import { favoriteProviderDiscoveryTitles, hasFavoriteOvaMarker, hasFavoritePreSerializationMarker } from './title-normalization';

function cleanedTitles(artifact: FavoriteParseArtifact): readonly string[] {
  const titles = [artifact.displayTitle, ...(artifact.aliases ?? []).map((alias) => alias.value)]
    .filter((title): title is string => title !== undefined);
  return [...new Set(titles)];
}

export async function requestPublicFavoriteDiscovery(
  port: PublicDiscoveryRequestClientPort,
  key: PublicDiscoveryKey,
  artifact: FavoriteParseArtifact,
): Promise<PublicDiscoveryReadState> {
  const explicit = artifact.sourceEvidence.explicitProviderReference;
  const sourceTitles = [...cleanedTitles(artifact)];
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
