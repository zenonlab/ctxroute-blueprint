import { describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryHttpGateway } from './http-gateway.js';

const claimToken = 'c'.repeat(32);
const resultToken = 'r'.repeat(32);

describe('public discovery HTTP gateway', () => {
  it('uses separate OIDC tokens for the exact claim and result routes', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/collector/claims')
      ? Response.json({ claimToken: 'd'.repeat(32), requests: [], schemaVersion: 2 })
      : Response.json({ published: 1, replayed: 0 }));
    const gateway = createPublicDiscoveryHttpGateway({ baseUrl: 'https://tobirink.test', claimToken, fetcher, resultToken });
    await expect(gateway.claim(5)).resolves.toMatchObject({ requests: [] });
    await expect(gateway.publish({
      claimToken: 'd'.repeat(32), nonce: '12345678-1234-4234-8234-123456789abc',
      results: [{
        key: { fingerprint: 'a'.repeat(64), mediaKind: 'MANGA', parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
        requestDigest: 'b'.repeat(64), resolution: { reason: 'not-found', state: 'NOT_FOUND' },
      }],
      schemaVersion: 2, verifiedAt: '2026-09-14T12:00:00.000Z',
    })).resolves.toEqual({ published: 1, replayed: 0 });
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://tobirink.test/v3/catalogue/discoveries/collector/claims', expect.objectContaining({ headers: expect.objectContaining({
      Authorization: `Bearer ${claimToken}`,
      'User-Agent': 'TobiRink-Public-Discovery/0.1 (+https://github.com/tristan-monticelli/tobirink-public-discovery)',
    }) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, 'https://tobirink.test/v3/catalogue/discoveries/results', expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${resultToken}` }) }));
  });

  it('refuses an insecure remote API origin', async () => {
    const gateway = createPublicDiscoveryHttpGateway({ baseUrl: 'http://public.example', claimToken, resultToken });
    await expect(gateway.claim(1)).rejects.toThrow('HTTPS');
  });
});
