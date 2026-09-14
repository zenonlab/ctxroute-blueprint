import { runPublicDiscoveryBatch } from './collector.js';
import { createPublicDiscoveryHttpGateway } from './http-gateway.js';
import { createPublicDiscoveryResolver } from './resolver.js';

export interface PublicDiscoveryCliEnvironment {
  readonly DISCOVERY_API_BASE_URL: string | undefined;
  readonly DISCOVERY_CLAIM_OIDC_TOKEN: string | undefined;
  readonly DISCOVERY_RESULT_OIDC_TOKEN: string | undefined;
}

function token(value: string | undefined, name: string): string {
  if (value === undefined || value.length < 32 || value.length > 8192) throw new Error(`missing-${name}`);
  return value;
}

export async function runPublicDiscoveryCli(environment: PublicDiscoveryCliEnvironment): Promise<void> {
  const report = await runPublicDiscoveryBatch({
    gateway: createPublicDiscoveryHttpGateway({
      baseUrl: environment.DISCOVERY_API_BASE_URL ?? 'https://tobirink.com',
      claimToken: token(environment.DISCOVERY_CLAIM_OIDC_TOKEN, 'discovery-claim-oidc-token'),
      resultToken: token(environment.DISCOVERY_RESULT_OIDC_TOKEN, 'discovery-result-oidc-token'),
    }),
    limit: 20,
    nonce: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    resolver: createPublicDiscoveryResolver(),
  });
  process.stdout.write(`${JSON.stringify({ event: 'public_discovery_batch', ...report })}\n`);
}
