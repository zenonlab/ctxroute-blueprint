import { z } from 'zod';
import { favoriteCollectiveKeySchema, favoriteCollectiveLookupQuerySchema, favoriteCollectiveLookupResultSchema, favoritePublicReferenceSchema } from './favorite-collective-lookup';
import { favoriteSiteRulesSchema } from '../favorites/site-rules';
import type { FavoriteSiteRules } from '../favorites/site-rules';
import { providerCandidateSchema } from '../favorites/provider-search-checkpoint';

export const collectiveOpaqueIdSchema = z.uuid();
export const collectiveTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const favoriteOwnerCredentialsSchema = z.strictObject({ ownerId: collectiveOpaqueIdSchema, installationId: collectiveOpaqueIdSchema, token: collectiveTokenSchema });
export type FavoriteOwnerCredentials = z.infer<typeof favoriteOwnerCredentialsSchema>;
export const favoriteOwnerRegistrationSchema = favoriteOwnerCredentialsSchema.extend({ consent: z.literal(true), revokeToken: collectiveTokenSchema });
export const favoriteCollectiveChoiceSchema = z.strictObject({
  key: favoriteCollectiveKeySchema,
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  references: z.array(favoritePublicReferenceSchema).min(1).max(5).refine((refs) => new Set(refs.map((ref) => ref.provider)).size === refs.length),
  confirmed: z.boolean(),
  candidate: providerCandidateSchema.optional(),
}).refine((choice) => choice.key.mediaKind === 'UNKNOWN' || choice.key.mediaKind === choice.mediaKind)
  .refine((choice) => choice.references.every((ref) => choice.mediaKind === 'ANIME' ? ['anilist', 'kitsu-anime'].includes(ref.provider) : ref.provider !== 'kitsu-anime'))
  .refine((choice) => choice.candidate === undefined || choice.candidate.mediaKind === choice.mediaKind)
  .refine((choice) => choice.candidate === undefined || choice.references.some((reference) => reference.provider === choice.candidate?.provider && reference.externalId === choice.candidate.externalId));
export const favoriteCollectiveCommandSchema = z.discriminatedUnion('operation', [
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('lookup'), nonce: collectiveOpaqueIdSchema, keys: favoriteCollectiveLookupQuerySchema }),
  z.strictObject({ schemaVersion: z.literal(2), operation: z.literal('contribute'), nonce: collectiveOpaqueIdSchema, choices: z.array(favoriteCollectiveChoiceSchema).min(1).max(50).refine((choices) => new Set(choices.map(({ key }) => key.fingerprint)).size === choices.length) }),
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
export interface FavoriteOwnerLocalStatePort { read(): Promise<FavoriteOwnerLocalState | undefined>; save(state: FavoriteOwnerLocalState): Promise<void> }
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
