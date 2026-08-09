import { sourceDispositionFromUrl, type FavoriteParseArtifact } from '@favlib/metadata';

/** The persisted shared artifact is the sole identity authority during API
 * classification. Client parsedTitle values and a second URL parse are never
 * consulted here. */
export function importIdentityFromArtifact(artifact: FavoriteParseArtifact | null | undefined, rawUrl: string) {
  if (artifact?.identity) return { status: 'recognized' as const, identity: artifact.identity, reason: `URL_IDENTITY_${String(artifact.identity.strategy ?? 'shared').toUpperCase()}` };
  const disposition = sourceDispositionFromUrl(rawUrl);
  return {
    status: disposition.status === 'excluded' ? 'excluded' as const : 'review' as const,
    identity: null,
    reason: artifact?.diagnostics?.[0] ?? disposition.reason,
  };
}
