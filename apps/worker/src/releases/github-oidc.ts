import { z } from 'zod';

const issuer = 'https://token.actions.githubusercontent.com';
const privateRepository = 'tristan-monticelli/Tobirink';
const publicDiscoveryRepository = 'tristan-monticelli/tobirink-public-discovery';
interface GitHubCollectorIdentity { readonly repository: string; readonly workflow: string }
const identitiesByPath: ReadonlyMap<string, GitHubCollectorIdentity> = new Map<string, GitHubCollectorIdentity>([
  ['/v2/releases/generations', Object.freeze({ repository: privateRepository, workflow: `${privateRepository}/.github/workflows/agenda-collector.yml@refs/heads/main` })],
  ['/v2/catalogue/discoveries/promotions', Object.freeze({ repository: privateRepository, workflow: `${privateRepository}/.github/workflows/public-discovery-collector.yml@refs/heads/main` })],
  ['/v3/catalogue/discoveries/collector/claims', Object.freeze({ repository: publicDiscoveryRepository, workflow: `${publicDiscoveryRepository}/.github/workflows/collect.yml@refs/heads/main` })],
  ['/v3/catalogue/discoveries/results', Object.freeze({ repository: publicDiscoveryRepository, workflow: `${publicDiscoveryRepository}/.github/workflows/collect.yml@refs/heads/main` })],
]);
const jwtHeaderSchema = z.strictObject({ alg: z.literal('RS256'), kid: z.string().min(1).max(256), typ: z.string().optional() });
const jwtClaimsSchema = z.object({
  aud: z.union([z.string(), z.array(z.string()).max(4)]), exp: z.number().int(), iat: z.number().int(), iss: z.literal(issuer),
  event_name: z.enum(['schedule', 'workflow_dispatch']), nbf: z.number().int().optional(), ref: z.literal('refs/heads/main'),
  repository: z.string().min(3).max(200), workflow_ref: z.string().min(3).max(500),
}).passthrough();
const jwksSchema = z.object({ keys: z.array(z.object({ alg: z.literal('RS256'), e: z.string(), kid: z.string(), kty: z.literal('RSA'), n: z.string(), use: z.literal('sig') }).passthrough()).max(16) }).passthrough();

type TokenFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const jwksByteLimit = 64 * 1024;

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > jwksByteLimit) throw new Error('agenda-oidc-jwks-too-large');
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('agenda-oidc-jwks-unavailable');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0; let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > jwksByteLimit) throw new Error('agenda-oidc-jwks-too-large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function decodeJsonText(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('agenda-oidc-malformed');
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(decoded, (character) => character.charCodeAt(0)));
  }
  catch { throw new Error('agenda-oidc-malformed'); }
}

function decodeSignature(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('agenda-oidc-malformed');
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export async function verifyGitHubAgendaToken(token: string, audience: string, fetcher: TokenFetcher = fetch.bind(globalThis), now = Date.now()): Promise<void> {
  if (token.length < 32 || token.length > 8192) throw new Error('agenda-oidc-malformed');
  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('agenda-oidc-malformed');
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  if (!encodedHeader || !encodedClaims || !encodedSignature) throw new Error('agenda-oidc-malformed');
  const header = jwtHeaderSchema.parse(JSON.parse(decodeJsonText(encodedHeader)));
  const claims = jwtClaimsSchema.parse(JSON.parse(decodeJsonText(encodedClaims)));
  const nowSeconds = Math.floor(now / 1000);
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(audience)) throw new Error('agenda-oidc-audience');
  const identity = identitiesByPath.get(new URL(audience).pathname);
  if (identity === undefined || claims.repository !== identity.repository || claims.workflow_ref !== identity.workflow) throw new Error('agenda-oidc-identity');
  if (claims.iat > nowSeconds + 30 || claims.exp < nowSeconds || claims.exp - claims.iat > 600 || (claims.nbf !== undefined && claims.nbf > nowSeconds + 30)) throw new Error('agenda-oidc-expired');
  const response = await fetcher(`${issuer}/.well-known/jwks`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('agenda-oidc-jwks-unavailable');
  const body = await readBoundedText(response);
  const jwk = jwksSchema.parse(JSON.parse(body)).keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error('agenda-oidc-key-missing');
  const key = await crypto.subtle.importKey('jwk', jwk, { hash: 'SHA-256', name: 'RSASSA-PKCS1-v1_5' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodeSignature(encodedSignature), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  if (!valid) throw new Error('agenda-oidc-signature');
}
