import { describe, expect, it } from 'vitest';
import { verifyGitHubAgendaToken } from './github-oidc';

type JwtFixture = Readonly<Record<string, string | number>>;

function encodeBytes(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function encode(value: JwtFixture): string { return encodeBytes(new TextEncoder().encode(JSON.stringify(value))); }

describe('GitHub Agenda OIDC', () => {
  it('accepts only a current token for the exact repository workflow branch and audience', async () => {
    const keys = await crypto.subtle.generateKey({ hash: 'SHA-256', modulusLength: 2048, name: 'RSASSA-PKCS1-v1_5', publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
    if (!('publicKey' in keys)) throw new Error('expected-key-pair');
    const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
    const now = Date.parse('2026-09-14T10:00:00.000Z'); const nowSeconds = Math.floor(now / 1000);
    const header = encode({ alg: 'RS256', kid: 'fixture', typ: 'JWT' });
    const claims = encode({ aud: 'https://tobirink.test/v2/releases/generations', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/Tobirink', workflow_ref: 'tristan-monticelli/Tobirink/.github/workflows/agenda-collector.yml@refs/heads/main' });
    const signature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${claims}`))));
    const token = `${header}.${claims}.${signature}`;
    const fetcher = async () => Response.json({ keys: [{ ...publicKey, alg: 'RS256', kid: 'fixture', use: 'sig' }] });
    await expect(verifyGitHubAgendaToken(token, 'https://tobirink.test/v2/releases/generations', fetcher, now)).resolves.toBeUndefined();
    const discoveryClaims = encode({ aud: 'https://tobirink.test/v2/catalogue/discoveries/promotions', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/main', repository: 'tristan-monticelli/Tobirink', workflow_ref: 'tristan-monticelli/Tobirink/.github/workflows/public-discovery-collector.yml@refs/heads/main' });
    const discoverySignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${discoveryClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${discoveryClaims}.${discoverySignature}`, 'https://tobirink.test/v2/catalogue/discoveries/promotions', fetcher, now)).resolves.toBeUndefined();
    await expect(verifyGitHubAgendaToken(token, 'https://wrong.test', fetcher, now)).rejects.toThrow('agenda-oidc-audience');
    const wrongBranchClaims = encode({ aud: 'https://tobirink.test/v2/releases/generations', exp: nowSeconds + 300, iat: nowSeconds, iss: 'https://token.actions.githubusercontent.com', ref: 'refs/heads/feature', repository: 'tristan-monticelli/Tobirink', workflow_ref: 'tristan-monticelli/Tobirink/.github/workflows/agenda-collector.yml@refs/heads/main' });
    const wrongBranchSignature = encodeBytes(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${wrongBranchClaims}`))));
    await expect(verifyGitHubAgendaToken(`${header}.${wrongBranchClaims}.${wrongBranchSignature}`, 'https://tobirink.test/v2/releases/generations', fetcher, now)).rejects.toThrow();
  });
});
