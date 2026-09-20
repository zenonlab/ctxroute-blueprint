import {
  publicDiscoveryClaimBatchSchema,
  publicDiscoveryReceiptSchema,
  publicDiscoveryResultBatchSchema,
  publicDiscoveryTerminalResolutionSchema,
  type PublicDiscoveryClaimBatch,
  type PublicDiscoveryClaimedRequest,
  type PublicDiscoveryReceipt,
  type PublicDiscoveryResult,
  type PublicDiscoveryResultBatch,
  type PublicDiscoveryTerminalResolution,
} from './contracts.js';
import { FavoriteProviderRetryError } from './provider-kit.js';

export interface PublicDiscoveryGatewayPort {
  claim(limit: number): Promise<PublicDiscoveryClaimBatch>;
  defer(request: PublicDiscoveryClaimedRequest, retryAt: string, now: string): Promise<void>;
  publish(batch: PublicDiscoveryResultBatch): Promise<PublicDiscoveryReceipt>;
}
export interface PublicDiscoveryResolverPort {
  resolve(request: PublicDiscoveryClaimedRequest): Promise<PublicDiscoveryTerminalResolution>;
}
export interface PublicDiscoveryBatchInput {
  gateway: PublicDiscoveryGatewayPort;
  limit: number;
  nonce: () => string;
  now: () => string;
  resolver: PublicDiscoveryResolverPort;
}
export interface PublicDiscoveryBatchReport { claimed: number; deferred?: number; failed: number; published: number; replayed: number }

export async function runPublicDiscoveryBatch(input: PublicDiscoveryBatchInput): Promise<PublicDiscoveryBatchReport> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new RangeError('public discovery batch limit must be between 1 and 50');
  }
  const batch = publicDiscoveryClaimBatchSchema.parse(await input.gateway.claim(input.limit));
  let published = 0;
  let replayed = 0;
  let failed = 0;
  let deferred = 0;
  for (const request of batch.requests) {
    let resolution: PublicDiscoveryTerminalResolution;
    try {
      resolution = publicDiscoveryTerminalResolutionSchema.parse(await input.resolver.resolve(request));
    } catch (error) {
      if (error instanceof FavoriteProviderRetryError && Number.isFinite(error.retryAt)) {
        const now = input.now();
        const retryAt = new Date(Math.max(error.retryAt, Date.parse(now) + 1_000)).toISOString();
        await input.gateway.defer(request, retryAt, now);
        deferred += 1;
      } else failed += 1;
      continue;
    }
    const result: PublicDiscoveryResult = { key: request.key, requestDigest: request.requestDigest, resolution };
    const resultBatch = publicDiscoveryResultBatchSchema.parse({ claimToken: batch.claimToken, nonce: input.nonce(), results: [result], schemaVersion: 3, verifiedAt: input.now() });
    const receipt = publicDiscoveryReceiptSchema.parse(await input.gateway.publish(resultBatch));
    published += receipt.published;
    replayed += receipt.replayed;
  }
  return { claimed: batch.requests.length, deferred, failed, published, replayed };
}
