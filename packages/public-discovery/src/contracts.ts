import { z } from 'zod';

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const titleSchema = z.string().trim().min(1).max(200);

export const publicDiscoveryProviderSchema = z.enum([
  'anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga',
]);

export const publicDiscoveryKeyV3Schema = z.strictObject({
  fingerprint: fingerprintSchema,
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  parserVersion: identifierSchema,
  siteRulesVersion: identifierSchema,
});

export const publicDiscoveryReferenceV3Schema = z.strictObject({
  externalId: identifierSchema,
  provider: publicDiscoveryProviderSchema,
});

export const publicDiscoveryWorkRelationSchema = z.strictObject({
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  reference: publicDiscoveryReferenceV3Schema,
  relationType: z.enum(['ADAPTATION', 'RELATED']),
  titles: z.array(titleSchema).min(1).max(4),
});

export const publicDiscoveryQuerySchema = z.strictObject({
  discoveryTitles: z.array(titleSchema).min(1).max(4),
  explicitProviderReference: publicDiscoveryReferenceV3Schema.optional(),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  preSerialization: z.boolean().optional(),
  season: z.number().int().positive().max(1000).optional(),
  sourceFormat: z.string().trim().min(1).max(64).optional(),
  sourceTitles: z.array(titleSchema).max(4),
});

export const publicDiscoveryRequestSchema = z.strictObject({
  key: publicDiscoveryKeyV3Schema,
  query: publicDiscoveryQuerySchema,
  requestDigest: fingerprintSchema,
  schemaVersion: z.literal(3),
});

export const publicDiscoverySubmissionSchema = publicDiscoveryRequestSchema.omit({ requestDigest: true });
export const publicDiscoveryRefreshSubmissionSchema = z.strictObject({
  key: publicDiscoveryKeyV3Schema,
  schemaVersion: z.literal(3),
});

const coverSchema = z.strictObject({ attribution: z.string().trim().min(1).max(200), url: z.string().url().max(2048) });
const titleVariantSchema = z.strictObject({ language: z.string().trim().min(1).max(32).optional(), title: titleSchema });

export const publicDiscoveryCandidateSchema = z.strictObject({
  canonicalUrl: z.string().url().max(2048).optional(),
  categories: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  chapterCount: z.number().int().nonnegative().optional(),
  cover: coverSchema.optional(),
  displayTitle: titleSchema.optional(),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']).optional(),
  endYear: z.number().int().min(1800).max(3000).optional(),
  episodeCount: z.number().int().nonnegative().optional(),
  externalId: identifierSchema,
  format: z.string().trim().min(1).max(100).optional(),
  genres: z.array(z.string().trim().min(1).max(100)).max(32).optional(),
  linkedReferences: z.array(publicDiscoveryReferenceV3Schema).max(5).optional(),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  metadataVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  popularity: z.strictObject({ kind: z.enum(['MEMBERS', 'RANK']), value: z.number().int().nonnegative() }).optional(),
  preSerialization: z.boolean(),
  provider: publicDiscoveryProviderSchema,
  season: z.number().int().positive().max(1000).optional(),
  relations: z.array(publicDiscoveryWorkRelationSchema).max(5).optional(),
  startYear: z.number().int().min(1800).max(3000).optional(),
  titles: z.array(titleSchema).min(1).max(32),
  titleVariants: z.array(titleVariantSchema).max(32).optional(),
  volumeCount: z.number().int().nonnegative().optional(),
});

export const publicDiscoveryVerifiedProfileSchema = z.strictObject({
  candidate: publicDiscoveryCandidateSchema,
  references: z.array(publicDiscoveryReferenceV3Schema).min(1).max(5),
  workId: identifierSchema,
});

export const publicDiscoveryTerminalResolutionSchema = z.discriminatedUnion('state', [
  z.strictObject({ profile: publicDiscoveryVerifiedProfileSchema, state: z.literal('VERIFIED') }),
  z.strictObject({ reason: z.string().trim().min(1).max(200), state: z.literal('NOT_FOUND') }),
  z.strictObject({
    candidates: z.array(publicDiscoveryReferenceV3Schema).min(2).max(10),
    reason: z.string().trim().min(1).max(200),
    state: z.literal('AMBIGUOUS'),
  }),
]);

export const publicDiscoveryClaimedRequestSchema = publicDiscoveryRequestSchema.extend({ attempt: z.number().int().positive() });
export const publicDiscoveryClaimBatchSchema = z.strictObject({
  claimToken: z.string().min(32).max(256),
  requests: z.array(publicDiscoveryClaimedRequestSchema).max(50),
  schemaVersion: z.literal(3),
});
export const publicDiscoveryResultSchema = z.strictObject({
  key: publicDiscoveryKeyV3Schema,
  requestDigest: fingerprintSchema,
  resolution: publicDiscoveryTerminalResolutionSchema,
});
export const publicDiscoveryResultBatchSchema = z.strictObject({
  claimToken: z.string().min(32).max(256),
  nonce: z.string().uuid(),
  results: z.array(publicDiscoveryResultSchema).min(1).max(50),
  schemaVersion: z.literal(3),
  verifiedAt: z.string().datetime({ offset: false }),
});
export const publicDiscoveryReceiptSchema = z.strictObject({
  published: z.number().int().nonnegative(),
  replayed: z.number().int().nonnegative(),
});

export type PublicDiscoveryCandidate = z.output<typeof publicDiscoveryCandidateSchema>;
export type PublicDiscoveryClaimBatch = z.output<typeof publicDiscoveryClaimBatchSchema>;
export type PublicDiscoveryClaimedRequest = z.output<typeof publicDiscoveryClaimedRequestSchema>;
export type PublicDiscoveryKeyV3 = z.output<typeof publicDiscoveryKeyV3Schema>;
export type PublicDiscoveryQuery = z.output<typeof publicDiscoveryQuerySchema>;
export type PublicDiscoveryReceipt = z.output<typeof publicDiscoveryReceiptSchema>;
export type PublicDiscoveryReferenceV3 = z.output<typeof publicDiscoveryReferenceV3Schema>;
export type PublicDiscoveryRequest = z.output<typeof publicDiscoveryRequestSchema>;
export type PublicDiscoveryRefreshSubmission = z.output<typeof publicDiscoveryRefreshSubmissionSchema>;
export type PublicDiscoveryResult = z.output<typeof publicDiscoveryResultSchema>;
export type PublicDiscoveryResultBatch = z.output<typeof publicDiscoveryResultBatchSchema>;
export type PublicDiscoveryTerminalResolution = z.output<typeof publicDiscoveryTerminalResolutionSchema>;
export type PublicDiscoveryVerifiedProfile = z.output<typeof publicDiscoveryVerifiedProfileSchema>;
export type PublicDiscoveryWorkRelation = z.output<typeof publicDiscoveryWorkRelationSchema>;
export type PublicDiscoverySubmission = z.output<typeof publicDiscoverySubmissionSchema>;

export type PublicDiscoveryReadState =
  | { state: 'MISS' }
  | { retryAt: string; state: 'PENDING' }
  | { reason: 'ATTEMPT_LIMIT'; state: 'UNAVAILABLE' }
  | { nextRefreshAt?: string; profile: PublicDiscoveryVerifiedProfile; state: 'VERIFIED'; verifiedAt: string }
  | { reason: string; state: 'NOT_FOUND'; verifiedAt: string }
  | { candidates: readonly PublicDiscoveryReferenceV3[]; reason: string; state: 'AMBIGUOUS'; verifiedAt: string };
