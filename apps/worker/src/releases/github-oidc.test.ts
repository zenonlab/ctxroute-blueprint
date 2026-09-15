import { describe, expect, it, vi } from 'vitest';
import { verifyGitHubAgendaToken } from './github-oidc';

type JwtFixture = Readonly<Record<string, string | number>>;
const identityClaims = { repository_id: '1370309060', repository_owner_id: '239743354' };

function encodeBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function encode(value: JwtFixture): string { return encodeBytes(new TextEncoder().encode(JSON.stringify(value))); }

describe('GitHub Agenda OIDC', () => {
  it('accepts only current tokens for each exact repository workflow branch and audience', async () => {
    const keys = await crypto.subtle.generateKey({ hash: 'SHA-256', modulusLength: 2048, name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
    if (!('publicKey' in keys)) throw new Error('expected-key-pair');
    const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const now = Date.parse('2026-09-14T10:00:00.000Z'); const nowSeconds = Math.floor(now / 1000);
    const header = encode({ alg: 'RS256', kid: 'fixture', typ: 'JWT', x5t: 'fixture-thumbprint' });
    const agendaAudience = 'https://tobirink-public-api.choukky.workers.dev/v2/releases/generations';
    const claims = encode({ ...identityClaims, aud: agendaAudience, event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/agenda.yml@refs/heads/main' });
    const signature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${claims}`))));
    const token = `${header}.${claims}.${signature}`;
    let fetchCount = 0;
    const fetcher = async () => { fetchCount += 1; return Response.json({ keys: [{ ...publicKey, alg: 'RS256', kid: 'fixture', use: 'sig' }] }); };
    await expect(verifyGitHubAgendaToken(token, agendaAudience, fetcher, now)).resolves.toBeUndefined();
    const oversizedFetcher = async () => new Response(null, { headers: { 'content-length': '65537' } });
    await expect(verifyGitHubAgendaToken(token, agendaAudience, oversizedFetcher, now)).rejects.toThrow('jwks-too-large');
    const discoveryClaims = encode({ ...identityClaims, aud: 'https://tobirink-public-api.choukky.workers.dev/v3/catalogue/discoveries/collector/claims', event_name: 'workflow_dispatch', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/collect.yml@refs/heads/main' });
    const discoverySignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${discoveryClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${discoveryClaims}.${discoverySignature}`, 'https://tobirink-public-api.choukky.workers.dev/v3/catalogue/discoveries/collector/claims', fetcher, now)).resolves.toBeUndefined();
    await expect(verifyGitHubAgendaToken(`${header}.${discoveryClaims}.${discoverySignature}`, 'https://tobirink.test/v3/catalogue/discoveries/results', fetcher, now)).rejects.toThrow('agenda-oidc-audience');
    const resultClaims = encode({ ...identityClaims, aud: 'https://tobirink-public-api.choukky.workers.dev/v3/catalogue/discoveries/results', event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/collect.yml@refs/heads/main' });
    const resultSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${resultClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${resultClaims}.${resultSignature}`, 'https://tobirink-public-api.choukky.workers.dev/v3/catalogue/discoveries/results', fetcher, now)).resolves.toBeUndefined();
    expect(fetchCount).toBe(1);
    await expect(verifyGitHubAgendaToken(token, agendaAudience, fetcher, now + 300_001)).resolves.toBeUndefined();
    expect(fetchCount).toBe(2);
    await expect(verifyGitHubAgendaToken(token, 'https://wrong.test', fetcher, now)).rejects.toThrow('agenda-oidc-audience');
    const wrongBranchClaims = encode({ ...identityClaims, aud: agendaAudience, event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/feature', repository: 'tristan-monticelli/tobirink-public-discovery', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/agenda.yml@refs/heads/main' });
    const wrongBranchSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${wrongBranchClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${wrongBranchClaims}.${wrongBranchSignature}`, agendaAudience, fetcher, now)).rejects.toThrow();
    const wrongRepositoryClaims = encode({ ...identityClaims, aud: 'https://tobirink.test/v3/catalogue/discoveries/collector/claims', event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'attacker/fork', workflow_ref: 'attacker/fork/.github/workflows/collect.yml@refs/heads/main' });
    const wrongRepositorySignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${wrongRepositoryClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${wrongRepositoryClaims}.${wrongRepositorySignature}`, 'https://tobirink.test/v3/catalogue/discoveries/collector/claims', fetcher, now)).rejects.toThrow('agenda-oidc-identity');

    const wrongIdClaims = encode({ ...identityClaims, aud: agendaAudience, event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', repository_id: '1', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/agenda.yml@refs/heads/main' });
    const wrongIdSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${wrongIdClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${wrongIdClaims}.${wrongIdSignature}`, agendaAudience, fetcher, now)).rejects.toThrow('agenda-oidc-identity');

    const wrongOwnerIdClaims = encode({ ...identityClaims, aud: agendaAudience, event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', repository_owner_id: '1', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/agenda.yml@refs/heads/main' });
    const wrongOwnerIdSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${wrongOwnerIdClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${wrongOwnerIdClaims}.${wrongOwnerIdSignature}`, agendaAudience, fetcher, now)).rejects.toThrow('agenda-oidc-identity');

    const missingIdClaims = encode({ aud: agendaAudience, event_name: 'schedule', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/tobirink-public-discovery', workflow_ref: 'tristan-monticelli/tobirink-public-discovery/.github/workflows/agenda.yml@refs/heads/main' });
    const missingIdSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${missingIdClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${missingIdClaims}.${missingIdSignature}`, agendaAudience, fetcher, now)).rejects.toThrow();

    const rotatedHeader = encode({ alg: 'RS256', kid: 'rotated', typ: 'JWT' });
    const rotatedSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${rotatedHeader}.${claims}`))));
    let rotationFetches = 0;
    const rotatingFetcher = async () => {
      rotationFetches += 1;
      return Response.json({ keys: [{ ...publicKey, alg: 'RS256', kid: rotationFetches === 1 ? 'fixture' : 'rotated', use: 'sig' }] });
    };
    await expect(verifyGitHubAgendaToken(token, agendaAudience, rotatingFetcher, now)).resolves.toBeUndefined();
    await expect(verifyGitHubAgendaToken(`${rotatedHeader}.${claims}.${rotatedSignature}`, agendaAudience, rotatingFetcher, now)).resolves.toBeUndefined();
    expect(rotationFetches).toBe(2);

    const tooManyKeysFetcher = async () => Response.json({ keys: Array.from({ length: 17 }, (_, index) => ({ ...publicKey, alg: 'RS256', kid: `key-${index}`, use: 'sig' })) });
    await expect(verifyGitHubAgendaToken(token, agendaAudience, tooManyKeysFetcher, now)).rejects.toThrow();

    vi.useFakeTimers();
    try {
      const slowFetcher = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
      });
      const timeoutExpectation = expect(verifyGitHubAgendaToken(token, agendaAudience, slowFetcher, now)).rejects.toThrow('agenda-oidc-jwks-timeout');
      await vi.advanceTimersByTimeAsync(3_001);
      await timeoutExpectation;
    } finally { vi.useRealTimers(); }
  });
});
