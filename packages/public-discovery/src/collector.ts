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

export interface PublicDiscoveryGatewayPort {
  claim(limit: number): Promise<PublicDiscoveryClaimBatch>;
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
export interface PublicDiscoveryBatchReport { claimed: number; failed: number; published: number; replayed: number }

export async function runPublicDiscoveryBatch(input: PublicDiscoveryBatchInput): Promise<PublicDiscoveryBatchReport> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50) {
    throw new RangeError('public discovery batch limit must be between 1 and 50');
  }
  const batch = publicDiscoveryClaimBatchSchema.parse(await input.gateway.claim(input.limit));
  const results: PublicDiscoveryResult[] = [];
  let failed = 0;
  for (const request of batch.requests) {
    try {
      const resolution = publicDiscoveryTerminalResolutionSchema.parse(await input.resolver.resolve(request));
      results.push({ key: request.key, requestDigest: request.requestDigest, resolution });
    } catch {
      failed += 1;
    }
  }
  if (results.length === 0) return { claimed: batch.requests.length, failed, published: 0, replayed: 0 };
  const resultBatch = publicDiscoveryResultBatchSchema.parse({
    claimToken: batch.claimToken,
    nonce: input.nonce(),
    results,
    schemaVersion: 3,
    verifiedAt: input.now(),
  });
  const receipt = publicDiscoveryReceiptSchema.parse(await input.gateway.publish(resultBatch));
  return { claimed: batch.requests.length, failed, ...receipt };
}
