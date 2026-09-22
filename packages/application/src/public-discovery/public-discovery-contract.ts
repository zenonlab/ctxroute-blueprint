import { z } from 'zod';
import type { PublicDiscoveryQuery, PublicDiscoveryReadState } from '@tobirink/public-discovery';
import { publicDiscoveryKeyV3Schema } from '@tobirink/public-discovery';

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const publicIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/u);
const providerSchema = z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']);
const titleSchema = z.string().min(1).max(200).refine((title) => ![...title].some((character) => {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
}));

export const publicDiscoveryKeySchema = publicDiscoveryKeyV3Schema;

export type PublicDiscoveryErrorCode = 'ADMISSION_WAIT' | 'RATE_LIMITED' | 'NETWORK' | 'TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'CONTRACT_CONFLICT' | 'INVALID_RESPONSE';
export class PublicDiscoveryError extends Error {
  constructor(readonly code: PublicDiscoveryErrorCode, readonly httpStatus?: number, readonly retryAt?: string) {
    super(code); this.name = 'PublicDiscoveryError';
  }
}

export const publicDiscoveryReferenceSchema = z.strictObject({
  externalId: publicIdSchema,
  provider: providerSchema,
});

export const publicDiscoveryProfileSchema = z.strictObject({
  mediaKind: z.enum(['anime', 'manga']),
  officialTitles: z.array(z.strictObject({ locale: z.string().min(2).max(16).regex(/^[A-Za-z0-9-]+$/u), title: titleSchema })).min(1).max(8),
  preferredTitle: titleSchema,
  references: z.array(publicDiscoveryReferenceSchema).min(1).max(5),
  workId: publicIdSchema,
});

export const publicDiscoveryClaimSchema = z.strictObject({ key: publicDiscoveryKeySchema, schemaVersion: z.literal(1) });
export const publicDiscoveryProposalSchema = z.strictObject({
  key: publicDiscoveryKeySchema,
  leaseToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  references: z.array(publicDiscoveryReferenceSchema).min(1).max(5),
  schemaVersion: z.literal(1),
}).superRefine((value, context) => {
  const identities = value.references.map((reference) => `${reference.provider}:${reference.externalId}`);
  if (new Set(identities).size !== identities.length) context.addIssue({ code: 'custom', message: 'duplicate-reference', path: ['references'] });
});

export const publicDiscoveryPromotionSchema = z.strictObject({
  key: publicDiscoveryKeySchema,
  profile: publicDiscoveryProfileSchema,
  proposalDigest: fingerprintSchema,
  schemaVersion: z.literal(1),
  verifiedAt: z.iso.datetime({ offset: false }),
});

export const publicDiscoveryPromotionBatchSchema = z.strictObject({
  nonce: z.uuid(),
  promotions: z.array(publicDiscoveryPromotionSchema).min(1).max(50),
  schemaVersion: z.literal(1),
});

export type PublicDiscoveryKey = z.output<typeof publicDiscoveryKeySchema>;
export type PublicDiscoveryProfile = z.output<typeof publicDiscoveryProfileSchema>;
export type PublicDiscoveryReference = z.output<typeof publicDiscoveryReferenceSchema>;
export type PublicDiscoveryProposal = z.output<typeof publicDiscoveryProposalSchema>;
export type PublicDiscoveryPromotion = z.output<typeof publicDiscoveryPromotionSchema>;

export type PublicDiscoveryState =
  | { state: 'MISS' }
  | { retryAt: string; state: 'PENDING' }
  | { profile: PublicDiscoveryProfile; state: 'VERIFIED'; verifiedAt: string };

export type PublicDiscoveryClientState = PublicDiscoveryState | { expiresAt: string; state: 'LEASED' };

export interface PublicDiscoveryLocalRecord {
  expiresAt?: string;
  id: string;
  key: PublicDiscoveryKey;
  leaseToken?: string;
  references?: readonly PublicDiscoveryReference[];
  retryAt: string;
  state: 'LEASED' | 'PENDING' | 'PROPOSAL_PENDING';
}

export interface PublicDiscoveryLocalStore {
  listProposalPending(limit: number): Promise<readonly PublicDiscoveryLocalRecord[]>;
  read(key: PublicDiscoveryKey): Promise<PublicDiscoveryLocalRecord | undefined>;
  save(record: PublicDiscoveryLocalRecord): Promise<void>;
}

export interface PublicDiscoveryClientPort {
  maintain(): Promise<void>;
  propose(key: PublicDiscoveryKey, references: readonly PublicDiscoveryReference[]): Promise<void>;
  resolveOrClaim(key: PublicDiscoveryKey): Promise<PublicDiscoveryClientState>;
}

export interface PublicDiscoveryRequestClientPort {
  setDeadline?(deadline: number): void;
  lookup?(keys: readonly PublicDiscoveryKey[]): Promise<readonly { key: PublicDiscoveryKey; state: PublicDiscoveryReadState }[]>;
  requestRecovery?(key: PublicDiscoveryKey, query: PublicDiscoveryQuery): Promise<PublicDiscoveryReadState>;
  requestRefresh?(key: PublicDiscoveryKey): Promise<Extract<PublicDiscoveryReadState, { state: 'VERIFIED' }>>;
  resolveOrRequest(key: PublicDiscoveryKey, query: PublicDiscoveryQuery): Promise<PublicDiscoveryReadState>;
}

export interface PublicDiscoveryPort {
  claim(input: PublicDiscoveryKey, lease: { expiresAt: string; tokenDigest: string }, now: string): Promise<PublicDiscoveryState & { leaseGranted?: boolean }>;
  listPending(limit: number): Promise<readonly { key: PublicDiscoveryKey; proposalDigest: string; references: readonly z.output<typeof publicDiscoveryReferenceSchema>[] }[]>;
  promote(promotions: readonly PublicDiscoveryPromotion[]): Promise<{ promoted: number; replayed: number }>;
  propose(input: PublicDiscoveryProposal, tokenDigest: string, proposalDigest: string, now: string): Promise<boolean>;
  read(input: PublicDiscoveryKey, now: string): Promise<PublicDiscoveryState>;
}
