import { z } from 'zod';
export function parseBookmarkTitle(value:string){
  const parts=value.replace(/\s+/g,' ').trim().split(/\s+-\s+/u).map(part=>part.trim()).filter(Boolean);
  const useful=parts.filter(part=>!/^\d+(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?$/iu.test(part)&&!/^voiranime$/iu.test(part)&&!/^(?:vostfr|vf|vo|sub|dub|scan|scans)$/iu.test(part));
  let title=useful[0]??value.trim();
  title=title.replace(/^(?:read|watch|regarder gratuitement|regarder)\s+/iu,'');
  title=title.replace(/\s+(?:chapter|chapitre|episode|ep)\s*\d+(?:\.\d+)?(?:[-–—].*|\s+.*)?$/iu,'');
  title=title.replace(/\s+(?:in english online free|online free|en hd)\s*$/iu,'');
  title=title.replace(/\s*(?:[-–—|·:]\s*)?(?:voiranime|mangakakalot|manganelo|mangakakalot\.com|manganelo\.com|manhwaz)\s*$/iu,'');
  return title.replace(/\s+(?:vostfr|vf|vo|sub|dub|scan|scans|en hd)\s*$/iu,'').trim().replace(/[|·:—–-]+$/u,'').trim()||null;
}
export const errorEnvelope=z.object({error:z.object({code:z.string(),message:z.string(),requestId:z.string(),fields:z.array(z.record(z.string(),z.unknown())).max(20)})});
export const healthContract=z.object({status:z.literal('ok'),currentProtocol:z.number().int(),minimumSupportedProtocol:z.number().int()});
export const cursorPage=z.object({items:z.array(z.unknown()),nextCursor:z.string().nullable().optional()});
export const calendarEventContract=z.object({mediaId:z.string(),releaseKey:z.string(),chapter:z.string().nullable().optional(),chapterDisplay:z.string().nullable().optional()}).passthrough();
export const calendarPageContract=z.object({items:z.array(calendarEventContract),total:z.number().int().nonnegative(),nextCursor:z.string().nullable(),timeZone:z.string(),filters:z.record(z.string(),z.unknown())});
export const contentPreferenceContract=z.object({allowAdult:z.boolean(),updatedAt:z.string().datetime().nullable()});
export const contentPreferencePatchContract=contentPreferenceContract.pick({allowAdult:true}).strict();
export const registerRequestContract=z.object({email:z.string().email().max(320),password:z.string().min(1).max(128)});
export const adminSettingsPatchContract=z.record(z.string(),z.number()).refine(value=>Object.keys(value).length>0);
export const adminUserPatchContract=z.object({role:z.enum(['admin','member']).optional(),active:z.boolean().optional()}).strict().refine(value=>value.role!==undefined||value.active!==undefined);
export const adminInvitationCreateContract=z.object({email:z.string().email().max(320),expiresInHours:z.number().int().min(1).max(168).default(24)});
export const adminMaintenanceScopeContract=z.object({scope:z.enum(['user','global']),userId:z.string().uuid().optional()}).refine(value=>value.scope==='global'||Boolean(value.userId),{message:'userId is required for user scope'});
export const reviewCollectiveStateContract=z.enum(['PROVISIONAL','CONFIRMED','SUSPENDED','DISPUTED','HOMONYM_REQUIRED']);
export const reviewManualContract=z.object({provider:z.enum(['anilist','mangaupdates']),id:z.string().trim().min(1).max(80).optional(),url:z.string().url().optional()}).strict().refine(value=>Boolean(value.id||value.url));
export const reviewReportContract=z.object({reason:z.enum(['WRONG_IDENTITY','WRONG_SEASON','WRONG_MEDIA_TYPE','PROVIDER_RECORD_CHANGED']),details:z.string().trim().max(500).optional()}).strict();
export const reviewRevalidationChoiceContract=z.object({profileId:z.string().uuid()}).strict();
export const adminReviewClusterChoiceContract=z.object({profileId:z.string().uuid()}).strict();
export const reviewCandidateContract=z.object({id:z.string().uuid(),providerId:z.string(),displayTitle:z.string(),image:z.string().nullable(),endorsements:z.number().int().nonnegative().nullable().optional(),reliableVotes:z.number().int().nonnegative().nullable().optional()}).passthrough();
export const reviewDetailContract=z.object({id:z.string().uuid(),provider:z.enum(['anilist','mangaupdates']),status:z.enum(['PENDING','RESOLVED','NO_MATCH']),mode:z.enum(['required','optional']),collectiveState:reviewCollectiveStateContract.nullable(),allowedActions:z.array(z.enum(['choose','no-match','manual','report'])),candidates:z.array(reviewCandidateContract).max(5)}).passthrough();
export const reviewRevalidationContract=z.object({id:z.string().uuid(),clusterId:z.string().uuid(),epoch:z.number().int().positive(),status:z.enum(['PENDING','CHOSEN','SKIPPED']),selectedProfileId:z.string().uuid().nullable(),collectiveState:reviewCollectiveStateContract,title:z.string()}).passthrough();
export const reviewRevalidationPageContract=z.object({items:z.array(reviewRevalidationContract)});
export const collectiveReviewIdentityContract=z.object({provider:z.enum(['anilist','mangaupdates']),mediaType:z.enum(['ANIME','MANGA','MANHWA','MANHUA']),parsedTitle:z.string().trim().min(1).max(500)}).strict().superRefine((value,ctx)=>{const expected=value.mediaType==='ANIME'?'anilist':'mangaupdates';if(value.provider!==expected)ctx.addIssue({code:z.ZodIssueCode.custom,path:['provider'],message:'PROVIDER_MEDIA_TYPE_MISMATCH'})});

export const EXTENSION_PROTOCOL = 1;
export const MINIMUM_EXTENSION_PROTOCOL = 1;
export const pairingChallengeContract = z.object({
  challengeId: z.string().uuid(), code: z.string().regex(/^\d{8}$/), expiresAt: z.string().datetime(),
  pairingUrl: z.string().url(), protocol: z.number().int()
});
export const deviceContract = z.object({id:z.string().uuid(), installationId:z.string().min(16), name:z.string(), browser:z.string(), lastSyncAt:z.string().datetime().nullable(), revokedAt:z.string().datetime().nullable()});
export const bookmarkContract = z.object({id:z.string().min(1), parentId:z.string().nullable(), title:z.string().max(500), url:z.string().url(), dateAdded:z.number().int().nonnegative().nullable(), dateGroupModified:z.number().int().nonnegative().nullable()});
export const importItemContract = bookmarkContract.extend({fingerprint:z.string().length(64), event:z.enum(['created','changed','moved','removed']), parsedTitle:z.string().max(500).nullable().optional()});
export const importBatchContract = z.object({batchId:z.string().uuid(), installationId:z.string().min(16), protocol:z.number().int(), items:z.array(importItemContract).max(250), cursor:z.string().nullable()});
export const catalogMediaContract = z.object({id:z.string().min(1),type:z.enum(['ANIME','MANGA','MANHWA','MANHUA','UNKNOWN']),seasonYear:z.number().int().nullable().optional(),countryOfOrigin:z.string().nullable().optional(),format:z.string().nullable().optional(),titles:z.array(z.object({text:z.string(),language:z.string().nullable().optional(),kind:z.string(),connector:z.string().nullable().optional()}))});
export const catalogSearchContract = z.object({items:z.array(catalogMediaContract)});
export const classificationContract = z.object({candidateId:z.string().uuid(),status:z.enum(['matched','review','ignored']),classifierVersion:z.string(),fingerprint:z.string().length(64),matches:z.array(z.object({mediaId:z.string(),score:z.number(),reasons:z.array(z.object({code:z.string(),weight:z.number(),detail:z.string().optional()}))}))});
export const extensionPreferencesContract=z.object({autoUpdateFavorites:z.boolean(),observeNavigation:z.boolean(),syncMinutes:z.number().int().min(5).max(1440),updatedAt:z.string().datetime().nullable()});
export const extensionPreferencesPatchContract=extensionPreferencesContract.pick({autoUpdateFavorites:true,observeNavigation:true,syncMinutes:true}).partial().strict().refine(value=>Object.keys(value).length>0);
export const extensionConfigContract=z.object({protocol:z.number().int(),minimumProtocol:z.number().int(),preferences:extensionPreferencesContract,availableVersion:z.string().nullable(),browser:z.enum(['chrome','firefox']).nullable(),role:z.enum(['admin','member'])});
export const extensionUpdateProposalContract=z.object({id:z.string().uuid(),bookmarkId:z.string().min(1).max(200),expectedUrl:z.string().url(),expectedTitle:z.string().max(500),newUrl:z.string().url(),newTitle:z.string().max(500),domain:z.string().min(1).max(253),state:z.enum(['PENDING','APPLIED','CANCELLED','STALE','FAILED']),createdAt:z.string().datetime()});
export const extensionProposalResultContract=z.object({result:z.enum(['APPLIED','CANCELLED','STALE','FAILED']),code:z.string().max(100).optional()}).strict();
export const extensionReleaseContract=z.object({browser:z.enum(['chrome','firefox']),version:z.string(),protocol:z.number().int(),checksumSha256:z.string().regex(/^[0-9a-f]{64}$/),artifactUrl:z.string().url(),updateManifestUrl:z.string().url().nullable(),installationMode:z.string(),publishedAt:z.string().datetime()});
export const extensionPageMetadataContract=z.object({pageUrl:z.string().url().max(4096),canonicalUrl:z.string().url().max(4096),title:z.string().trim().min(1).max(500).optional(),image:z.string().url().max(4096).optional(),type:z.string().max(100).optional(),year:z.number().int().min(1900).max(2200).optional(),format:z.string().max(100).optional(),confidence:z.number().min(0).max(1)});
export type ExtensionConfig=z.infer<typeof extensionConfigContract>;
export type ExtensionUpdateProposal=z.infer<typeof extensionUpdateProposalContract>;
