import { runPublicDiscoveryCli } from './cli.js';

await runPublicDiscoveryCli({
  DISCOVERY_API_BASE_URL: process.env.DISCOVERY_API_BASE_URL,
  DISCOVERY_CLAIM_OIDC_TOKEN: process.env.DISCOVERY_CLAIM_OIDC_TOKEN,
  DISCOVERY_RESULT_OIDC_TOKEN: process.env.DISCOVERY_RESULT_OIDC_TOKEN,
});
