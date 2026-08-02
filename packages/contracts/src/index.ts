import { z } from 'zod';
export const errorEnvelope=z.object({error:z.object({code:z.string(),message:z.string(),requestId:z.string(),fields:z.array(z.record(z.unknown())).max(20)})});
export const healthContract=z.object({status:z.literal('ok'),currentProtocol:z.number().int(),minimumSupportedProtocol:z.number().int()});
export const cursorPage=z.object({items:z.array(z.unknown()),nextCursor:z.string().nullable().optional()});

export const EXTENSION_PROTOCOL = 1;
export const MINIMUM_EXTENSION_PROTOCOL = 1;
export const pairingChallengeContract = z.object({
  challengeId: z.string().uuid(), code: z.string().regex(/^\d{8}$/), expiresAt: z.string().datetime(),
  pairingUrl: z.string().url(), protocol: z.number().int()
});
export const deviceContract = z.object({id:z.string().uuid(), installationId:z.string().min(16), name:z.string(), browser:z.string(), lastSyncAt:z.string().datetime().nullable(), revokedAt:z.string().datetime().nullable()});
export const bookmarkContract = z.object({id:z.string().min(1), parentId:z.string().nullable(), title:z.string().max(500), url:z.string().url(), dateAdded:z.number().int().nonnegative().nullable(), dateGroupModified:z.number().int().nonnegative().nullable()});
export const importItemContract = bookmarkContract.extend({fingerprint:z.string().length(64), event:z.enum(['created','changed','moved','removed'])});
export const importBatchContract = z.object({batchId:z.string().uuid(), installationId:z.string().min(16), protocol:z.number().int(), items:z.array(importItemContract).max(250), cursor:z.string().nullable()});
