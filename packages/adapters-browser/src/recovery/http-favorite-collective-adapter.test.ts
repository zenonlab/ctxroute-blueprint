import { collectiveDigest, favoriteCollectiveCommandSchema } from '@tobirink/application';
import { describe, expect, it, vi } from 'vitest';
import { HttpFavoriteCollectiveAdapter } from './http-favorite-collective-adapter';

const credentials = { ownerId: '00000000-0000-4000-8000-000000000001', installationId: '00000000-0000-4000-8000-000000000002', token: 'a'.repeat(64) };
const key = { fingerprint: 'b'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '3', siteRulesVersion: '2' };
describe('typed collective HTTP boundary', () => {
  it('sends only public keys, credentials and nonce; validates receipt correlation', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = String(init.body); const command = favoriteCollectiveCommandSchema.parse(JSON.parse(body));
      return Response.json({ schemaVersion: 2, nonce: command.nonce, digest: await collectiveDigest(body), receivedAt: 1, results: [{ kind: 'MISS', fingerprint: key.fingerprint }] });
    });
    expect(await new HttpFavoriteCollectiveAdapter('https://worker.example', fetcher).lookup(credentials, [key])).toEqual([{ kind: 'MISS', fingerprint: key.fingerprint }]);
    const sent = fetcher.mock.calls[0]?.[1];
    expect(sent?.credentials).toBe('omit'); expect(sent?.redirect).toBe('error');
    expect(sent?.headers).toMatchObject({ 'X-Tobirink-Owner': credentials.ownerId });
    expect(JSON.parse(String(sent?.body))).toEqual(expect.objectContaining({ keys: [key] }));
    expect(String(sent?.body)).not.toContain(credentials.token);
  });
  it('rejects a mismatched receipt and an unsafe Worker origin', async () => {
    expect(() => new HttpFavoriteCollectiveAdapter('http://worker.example')).toThrow('HTTPS');
    const adapter = new HttpFavoriteCollectiveAdapter('https://worker.example', async () => Response.json({ schemaVersion: 2, nonce: credentials.ownerId, digest: '0'.repeat(64), receivedAt: 1, results: [] }));
    await expect(adapter.lookup(credentials, [key])).rejects.toThrow('correlation');
  });
});
