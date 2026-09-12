import { z } from 'zod';
import { favoriteCollectiveIdentitySchema, favoriteCollectiveKeySchema, favoriteCollectiveLookupQuerySchema, favoriteCollectiveLookupResultSchema, favoritePublicReferenceSchema } from './favorite-collective-lookup';
import { favoriteSiteRulesSchema } from '../favorites/site-rules';
import type { FavoriteSiteRules } from '../favorites/site-rules';
import type { ProviderCandidate } from '@tobirink/domain';

export const collectiveOpaqueIdSchema = z.uuid();
export const collectiveTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const favoriteOwnerCredentialsSchema = z.strictObject({ ownerId: collectiveOpaqueIdSchema, installationId: collectiveOpaqueIdSchema, token: collectiveTokenSchema });
export type FavoriteOwnerCredentials = z.infer<typeof favoriteOwnerCredentialsSchema>;
export const favoriteOwnerRegistrationSchema = favoriteOwnerCredentialsSchema.extend({ consent: z.literal(true), revokeToken: collectiveTokenSchema });
const boundedMetadataText = z.string().trim().min(1).max(1024);
const boundedCount = z.number().int().nonnegative();
export const favoritePublicMetadataSchema = z.strictObject({
  categories: z.array(boundedMetadataText).max(16).optional(),
  chapterCount: boundedCount.optional(), endYear: z.number().int().min(1800).max(3000).optional(),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']).optional(),
  episodeCount: boundedCount.optional(), format: boundedMetadataText.optional(), genres: z.array(boundedMetadataText).max(16).optional(),
  popularity: z.strictObject({ kind: z.enum(['MEMBERS', 'RANK']), value: boundedCount }).optional(),
  preSerialization: z.boolean(), startYear: z.number().int().min(1800).max(3000).optional(), volumeCount: boundedCount.optional(),
});
export type FavoritePublicMetadata = z.infer<typeof favoritePublicMetadataSchema>;
export const favoritePublicCacheEntrySchema = z.strictObject({
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  metadata: favoritePublicMetadataSchema,
  references: z.array(favoritePublicReferenceSchema).min(1).max(5).refine((refs) => new Set(refs.map((ref) => ref.provider)).size === refs.length),
});
export type FavoritePublicCacheEntry = z.infer<typeof favoritePublicCacheEntrySchema>;
export const favoritePublicCacheBatchRequestSchema = z.strictObject({ keys: favoriteCollectiveLookupQuerySchema });
export const favoritePublicCacheBatchResultSchema = z.strictObject({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/u), identity: favoritePublicCacheEntrySchema.optional() });
export const favoritePublicCacheBatchResponseSchema = z.strictObject({ results: z.array(favoritePublicCacheBatchResultSchema).min(1).max(50) });
export type FavoritePublicCacheBatchResult = z.infer<typeof favoritePublicCacheBatchResultSchema>;
export function favoritePublicMetadata(candidate: ProviderCandidate): FavoritePublicMetadata {
  const { categories, chapterCount, editorialStatus, endYear, episodeCount, format, genres, popularity, preSerialization, startYear, volumeCount } = candidate;
  return favoritePublicMetadataSchema.parse({ categories, chapterCount, editorialStatus, endYear, episodeCount, format, genres, popularity, preSerialization, startYear, volumeCount });
}
export const favoriteCollectiveChoiceSchema = z.strictObject({
  key: favoriteCollectiveKeySchema,
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  references: z.array(favoritePublicReferenceSchema).min(1).max(5).refine((refs) => new Set(refs.map((ref) => ref.provider)).size === refs.length),
  confirmed: z.boolean(),
  metadata: favoritePublicMetadataSchema.optional(),
}).refine((choice) => choice.key.mediaKind === 'UNKNOWN' || choice.key.mediaKind === choice.mediaKind)
  .refine((choice) => choice.references.every((ref) => choice.mediaKind === 'ANIME' ? ['anilist', 'kitsu-anime'].includes(ref.provider) : ref.provider !== 'kitsu-anime'));
export const favoriteCollectiveAmbiguitySchema = z.strictObject({
  key: favoriteCollectiveKeySchema,
  identities: z.array(favoriteCollectiveIdentitySchema).min(2).max(6),
}).refine(({ identities }) => new Set(identities.map((identity) => JSON.stringify([...identity.references].sort((a, b) => a.provider.localeCompare(b.provider))))).size === identities.length)
  .refine(({ key, identities }) => identities.every((identity) => key.mediaKind === 'UNKNOWN' || key.mediaKind === identity.mediaKind))
  .refine(({ identities }) => identities.every((identity) => identity.references.every((reference) => identity.mediaKind === 'ANIME'
    ? ['anilist', 'kitsu-anime'].includes(reference.provider)
    : reference.provider !== 'kitsu-anime')));
export const favoriteCollectiveCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('lookup'), nonce: collectiveOpaqueIdSchema, keys: favoriteCollectiveLookupQuerySchema }),
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('contribute'), nonce: collectiveOpaqueIdSchema, choices: z.array(favoriteCollectiveChoiceSchema).max(50), ambiguities: z.array(favoriteCollectiveAmbiguitySchema).max(50).optional() })
    .refine(({ choices, ambiguities }) => choices.length + (ambiguities?.length ?? 0) >= 1 && choices.length + (ambiguities?.length ?? 0) <= 50)
    .refine(({ choices, ambiguities }) => new Set([...choices, ...(ambiguities ?? [])].map(({ key }) => key.fingerprint)).size === choices.length + (ambiguities?.length ?? 0)),
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('pair'), nonce: collectiveOpaqueIdSchema, pairingToken: collectiveTokenSchema }),
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('revoke'), nonce: collectiveOpaqueIdSchema }),
]);
export const favoritePairRedemptionSchema = z.strictObject({ ownerId: collectiveOpaqueIdSchema, pairingToken: collectiveTokenSchema, installationId: collectiveOpaqueIdSchema, token: collectiveTokenSchema, consent: z.literal(true) });
export const favoriteCollectiveReceiptSchema = z.strictObject({ schemaVersion: z.literal(2), nonce: collectiveOpaqueIdSchema, digest: collectiveTokenSchema, receivedAt: z.number().int().nonnegative(), results: z.array(favoriteCollectiveLookupResultSchema).max(50) });
export type FavoriteCollectiveCommand = z.infer<typeof favoriteCollectiveCommandSchema>;
export type FavoriteCollectiveReceipt = z.infer<typeof favoriteCollectiveReceiptSchema>;
export type FavoriteOwnerRegistration = z.infer<typeof favoriteOwnerRegistrationSchema>;
export type FavoritePairRedemption = z.infer<typeof favoritePairRedemptionSchema>;
export const favoriteOwnerLocalStateSchema = z.strictObject({
  schemaVersion: z.literal(1), status: z.enum(['pending', 'enabled', 'revoking', 'revoked']),
  registration: favoriteOwnerRegistrationSchema,
  redemption: favoritePairRedemptionSchema.optional(),
  pending: favoriteCollectiveCommandSchema.optional(),
  scanAfter: z.string().min(1).max(256).optional(),
  sent: z.record(collectiveTokenSchema, collectiveTokenSchema).refine((items) => Object.keys(items).length <= 10000),
  lookups: z.record(collectiveTokenSchema, z.strictObject({ expiresAt: z.number().int().nonnegative(), result: favoriteCollectiveLookupResultSchema })).refine((items) => Object.keys(items).length <= 10000).optional(),
  rules: favoriteSiteRulesSchema.optional(), rulesReadAt: z.number().int().nonnegative().optional(),
});
export type FavoriteOwnerLocalState = z.infer<typeof favoriteOwnerLocalStateSchema>;
export interface FavoriteOwnerLocalStatePort { clear?(): Promise<void>; read(): Promise<FavoriteOwnerLocalState | undefined>; save(state: FavoriteOwnerLocalState): Promise<void> }
export type FavoriteCollectiveResponse = { readonly kind: 'ACCEPTED'; readonly receipt: FavoriteCollectiveReceipt } | { readonly kind: 'UNAUTHORIZED' | 'REPLAY' | 'QUOTA_EXCEEDED' };
export interface FavoriteCollectiveServicePort {
  readRules(): Promise<FavoriteSiteRules>;
  register(input: FavoriteOwnerRegistration): Promise<boolean>;
  redeem(input: FavoritePairRedemption): Promise<boolean>;
  execute(credentials: FavoriteOwnerCredentials, command: FavoriteCollectiveCommand, dailyQuota: number): Promise<FavoriteCollectiveResponse>;
}

export async function collectiveDigest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
