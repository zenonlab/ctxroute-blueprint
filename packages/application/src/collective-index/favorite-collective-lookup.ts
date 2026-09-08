import type { FavoriteParseArtifact, ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRetryError } from '../favorites/provider-ports';
import type { FavoriteProviderHydrationPorts } from '../favorites/provider-ports';
import { isProviderCandidateCompatible } from '../favorites/provider-matcher';
import { stripFavoriteSeasonSuffix } from '../favorites/season-extraction';

const decimalId = z.string().regex(/^[1-9]\d{0,18}$/u);
export const favoritePublicReferenceSchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('anilist'), externalId: decimalId.refine((id) => BigInt(id) <= 2147483647n) }),
  z.strictObject({ provider: z.literal('mangaupdates'), externalId: decimalId.refine((id) => BigInt(id) <= 9223372036854775807n) }),
  z.strictObject({ provider: z.literal('mangadex'), externalId: z.uuid().toLowerCase() }),
  z.strictObject({ provider: z.literal('kitsu-anime'), externalId: decimalId }),
  z.strictObject({ provider: z.literal('kitsu-manga'), externalId: decimalId }),
]);
const mediaKind = z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().min(1).max(256);
export const favoriteCollectiveKeySchema = z.strictObject({ fingerprint, mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']), parserVersion: version, siteRulesVersion: version });
export const favoriteCollectiveLookupQuerySchema = z.array(favoriteCollectiveKeySchema).min(1).max(50).refine((keys) => new Set(keys.map((key) => key.fingerprint)).size === keys.length);
export const favoriteCollectiveLookupResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ fingerprint, kind: z.literal('MISS') }),
  z.strictObject({ fingerprint, kind: z.literal('FOUND'), mediaKind, scope: z.enum(['owner', 'shared']), references: z.array(favoritePublicReferenceSchema).min(1).max(5).refine((references) => new Set(references.map((reference) => reference.provider)).size === references.length) }),
]);
export type FavoritePublicReference = z.infer<typeof favoritePublicReferenceSchema>;
export type FavoriteCollectiveKey = z.infer<typeof favoriteCollectiveKeySchema>;
export type FavoriteCollectiveLookupResult = z.infer<typeof favoriteCollectiveLookupResultSchema>;
export interface FavoriteCollectiveLookupPort {
  lookup(keys: readonly FavoriteCollectiveKey[]): Promise<readonly FavoriteCollectiveLookupResult[]>;
}

export async function favoriteCollectiveKey(artifact: FavoriteParseArtifact): Promise<FavoriteCollectiveKey> {
  if (!artifact.identityKey) throw new Error('Collective lookup requires a parsed identity.');
  const identity = artifact.season === undefined ? artifact.identityKey : stripFavoriteSeasonSuffix(artifact.identityKey, artifact.season);
  const encoded = new TextEncoder().encode(JSON.stringify([1, artifact.mediaKind, artifact.season ?? null, identity]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return favoriteCollectiveKeySchema.parse({ fingerprint: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), mediaKind: artifact.mediaKind, parserVersion: artifact.parserVersion, siteRulesVersion: artifact.sourceAdapterVersion });
}

type CollectiveIdentity =
  | { readonly kind: 'MISS' }
  | { readonly kind: 'RETRYABLE'; readonly retryAt?: number }
  | { readonly kind: 'REVIEW_REQUIRED'; readonly reason: 'AMBIGUOUS' | 'NOT_FOUND' }
  | { readonly kind: 'RESOLVED'; readonly candidate: ProviderCandidate; readonly references: readonly FavoritePublicReference[]; readonly scope: 'owner' | 'shared' };

export async function resolveFavoriteCollectiveIdentity(port: FavoriteCollectiveLookupPort | undefined, artifact: FavoriteParseArtifact, hydration: FavoriteProviderHydrationPorts, ownerOnly = false): Promise<CollectiveIdentity> {
  if (port === undefined) return { kind: 'MISS' };
  try {
    const key = await favoriteCollectiveKey(artifact);
    const results = z.array(favoriteCollectiveLookupResultSchema).length(1).parse(await port.lookup([key]));
    const result = results[0];
    if (result?.fingerprint !== key.fingerprint) throw new Error('Collective lookup correlation failed.');
    if (result.kind === 'MISS') return { kind: 'MISS' };
    if (ownerOnly && result.scope !== 'owner') return { kind: 'MISS' };
    const priorities = result.mediaKind === 'ANIME' ? ['anilist', 'kitsu-anime'] : ['mangaupdates', 'mangadex', 'anilist', 'kitsu-manga'];
    const provider = priorities.find((value) => result.references.some((reference) => reference.provider === value));
    const reference = result.references.find((value) => value.provider === provider);
    if (reference === undefined || result.references.some((value) => !priorities.includes(value.provider))) throw new Error('Collective identity has incompatible providers.');
    const adapter = hydration[reference.provider];
    if (adapter === undefined) throw new Error('Collective hydration provider is unavailable.');
    const candidate = await adapter.hydrate(reference);
    if (candidate === undefined) return { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' };
    if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('Collective hydration identity mismatch.');
    if (!isProviderCandidateCompatible({ mediaKind: result.mediaKind, sourceTitles: candidate.titles }, candidate)
      || (artifact.mediaKind !== 'UNKNOWN' && !isProviderCandidateCompatible({ mediaKind: artifact.mediaKind, sourceTitles: candidate.titles }, candidate))) return { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' };
    return { kind: 'RESOLVED', candidate, references: result.references, scope: result.scope };
  } catch (error) {
    return error instanceof FavoriteProviderRetryError ? { kind: 'RETRYABLE', retryAt: error.retryAt } : { kind: 'RETRYABLE' };
  }
}
