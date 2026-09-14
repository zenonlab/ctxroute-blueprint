import type { FavoriteParseArtifact, ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRetryError } from './provider-ports';
import type { FavoriteProviderHydrationPort, FavoriteProviderHydrationPorts } from './provider-ports';
import { isProviderCandidateCompatible } from './provider-matcher';
import { stripFavoriteSeasonSuffix } from './season-extraction';

const decimalId = z.string().regex(/^[1-9]\d{0,18}$/u);
export const favoritePublicReferenceSchema = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('anilist'), externalId: decimalId.refine((id) => /^[1-9]\d{0,18}$/u.test(id) && BigInt(id) <= 2147483647n) }),
  z.strictObject({ provider: z.literal('mangaupdates'), externalId: decimalId.refine((id) => /^[1-9]\d{0,18}$/u.test(id) && BigInt(id) <= 9223372036854775807n) }),
  z.strictObject({ provider: z.literal('mangadex'), externalId: z.uuid().toLowerCase() }),
  z.strictObject({ provider: z.literal('kitsu-anime'), externalId: decimalId }),
  z.strictObject({ provider: z.literal('kitsu-manga'), externalId: decimalId }),
]);
const mediaKind = z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const version = z.string().min(1).max(256);
export const favoriteIdentityKeySchema = z.strictObject({ fingerprint, mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']), parserVersion: version, siteRulesVersion: version });
export const synchronizedFavoriteIdentitySchema = z.strictObject({
  mediaKind,
  references: z.array(favoritePublicReferenceSchema).min(1).max(5)
    .refine((references) => new Set(references.map((reference) => reference.provider)).size === references.length),
});
export const favoriteIdentityLookupResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ fingerprint, kind: z.literal('MISS') }),
  z.strictObject({ fingerprint, kind: z.literal('FOUND'), mediaKind, references: z.array(favoritePublicReferenceSchema).min(1).max(5).refine((references) => new Set(references.map((reference) => reference.provider)).size === references.length) }),
  z.strictObject({ fingerprint, identities: z.array(synchronizedFavoriteIdentitySchema).min(2).max(6), kind: z.literal('AMBIGUOUS') }),
]);
export type FavoritePublicReference = z.infer<typeof favoritePublicReferenceSchema>;
export type FavoriteIdentityKey = z.infer<typeof favoriteIdentityKeySchema>;
export type FavoriteIdentityLookupResult = z.infer<typeof favoriteIdentityLookupResultSchema>;
export interface FavoriteIdentityLookupPort {
  lookup(keys: readonly FavoriteIdentityKey[]): Promise<readonly FavoriteIdentityLookupResult[]>;
}

export async function favoriteIdentityKey(artifact: FavoriteParseArtifact): Promise<FavoriteIdentityKey> {
  if (!artifact.identityKey) throw new Error('Identity lookup requires a parsed identity.');
  const identity = artifact.season === undefined ? artifact.identityKey : stripFavoriteSeasonSuffix(artifact.identityKey, artifact.season);
  const encoded = new TextEncoder().encode(JSON.stringify([1, artifact.mediaKind, artifact.season ?? null, identity]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return favoriteIdentityKeySchema.parse({ fingerprint: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), mediaKind: artifact.mediaKind, parserVersion: artifact.parserVersion, siteRulesVersion: artifact.sourceAdapterVersion });
}

type SynchronizedIdentity =
  | { readonly kind: 'MISS' }
  | { readonly kind: 'RETRYABLE'; readonly stage: 'LOOKUP' | 'HYDRATION'; readonly retryAt?: number }
  | { readonly kind: 'REVIEW_REQUIRED'; readonly reason: 'AMBIGUOUS' | 'NOT_FOUND'; readonly candidates?: readonly ProviderCandidate[] }
  | { readonly kind: 'RESOLVED'; readonly candidate: ProviderCandidate; readonly references: readonly FavoritePublicReference[] };

function selectReference(media: z.infer<typeof mediaKind>, references: readonly FavoritePublicReference[]): FavoritePublicReference | undefined {
  const priorities = media === 'ANIME' ? ['anilist', 'kitsu-anime'] : ['mangaupdates', 'mangadex', 'anilist', 'kitsu-manga'];
  const provider = priorities.find((value) => references.some((reference) => reference.provider === value));
  const reference = references.find((value) => value.provider === provider);
  return reference !== undefined && references.every((value) => priorities.includes(value.provider)) ? reference : undefined;
}

export async function resolveSynchronizedFavoriteIdentity(port: FavoriteIdentityLookupPort | undefined, artifact: FavoriteParseArtifact, hydration: FavoriteProviderHydrationPorts, hydrate?: FavoriteProviderHydrationPort['hydrate']): Promise<SynchronizedIdentity> {
  if (port === undefined) return { kind: 'MISS' };
  let stage: 'LOOKUP' | 'HYDRATION' = 'LOOKUP';
  try {
    const key = await favoriteIdentityKey(artifact);
    const results = z.array(favoriteIdentityLookupResultSchema).length(1).parse(await port.lookup([key]));
    const result = results[0];
    if (result?.fingerprint !== key.fingerprint) throw new Error('Identity lookup correlation failed.');
    if (result.kind === 'MISS') return { kind: 'MISS' };
    if (result.kind === 'AMBIGUOUS') {
      stage = 'HYDRATION';
      const candidates: ProviderCandidate[] = [];
      for (const identity of result.identities) {
        const reference = selectReference(identity.mediaKind, identity.references);
        if (reference === undefined) throw new Error('Synchronized ambiguity has incompatible providers.');
        const adapter = hydration[reference.provider];
        if (adapter === undefined) throw new Error('Synchronized hydration provider is unavailable.');
        const candidate = await (hydrate === undefined ? adapter.hydrate(reference) : hydrate(reference));
        if (candidate !== undefined && candidate.provider === reference.provider && candidate.externalId === reference.externalId
          && (artifact.mediaKind === 'UNKNOWN' || isProviderCandidateCompatible({ mediaKind: artifact.mediaKind, sourceTitles: candidate.titles }, candidate))) candidates.push(candidate);
      }
      return candidates.length >= 2 ? { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS', candidates } : { kind: 'MISS' };
    }
    const reference = selectReference(result.mediaKind, result.references);
    if (reference === undefined) throw new Error('Synchronized identity has incompatible providers.');
    const adapter = hydration[reference.provider];
    if (adapter === undefined) throw new Error('Synchronized hydration provider is unavailable.');
    stage = 'HYDRATION';
    const candidate = await (hydrate === undefined ? adapter.hydrate(reference) : hydrate(reference));
    if (candidate === undefined) return { kind: 'REVIEW_REQUIRED', reason: 'NOT_FOUND' };
    if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('Synchronized hydration identity mismatch.');
    if (!isProviderCandidateCompatible({ mediaKind: result.mediaKind, sourceTitles: candidate.titles }, candidate)
      || (artifact.mediaKind !== 'UNKNOWN' && !isProviderCandidateCompatible({ mediaKind: artifact.mediaKind, sourceTitles: candidate.titles }, candidate))) return { kind: 'MISS' };
    return { kind: 'RESOLVED', candidate, references: result.references };
  } catch (error) {
    return error instanceof FavoriteProviderRetryError ? { kind: 'RETRYABLE', stage, retryAt: error.retryAt } : { kind: 'RETRYABLE', stage };
  }
}
