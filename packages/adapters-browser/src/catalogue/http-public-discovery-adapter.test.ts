import { describe, expect, it, vi } from 'vitest';
import type { PublicDiscoveryKey, PublicDiscoveryLocalRecord, PublicDiscoveryLocalStore } from '@tobirink/application';
import { HttpPublicDiscoveryAdapter } from './http-public-discovery-adapter';

const key: PublicDiscoveryKey = {
  fingerprint: 'a'.repeat(64),
  mediaKind: 'ANIME',
  parserVersion: '5',
  siteRulesVersion: '3',
};

class MemoryDiscoveryStore implements PublicDiscoveryLocalStore {
  record?: PublicDiscoveryLocalRecord;
  async read(): Promise<PublicDiscoveryLocalRecord | undefined> { return this.record; }
  async save(record: PublicDiscoveryLocalRecord): Promise<void> { this.record = structuredClone(record); }
  async listProposalPending(): Promise<readonly PublicDiscoveryLocalRecord[]> {
    return this.record?.state === 'PROPOSAL_PENDING' ? [this.record] : [];
  }
}

describe('HttpPublicDiscoveryAdapter', () => {
  it('persists one lease and never claims the same work twice while it is active', async () => {
    const local = new MemoryDiscoveryStore();
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => init.method === 'GET'
      ? Response.json({ state: 'MISS' })
      : Response.json({ expiresAt: '2026-09-14T12:15:00.000Z', leaseToken: 'x'.repeat(32), state: 'LEASED' }, { status: 201 }));
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', local, fetcher, () => Date.parse('2026-09-14T12:00:00.000Z'));

    await expect(adapter.resolveOrClaim(key)).resolves.toEqual({ expiresAt: '2026-09-14T12:15:00.000Z', state: 'LEASED' });
    await expect(adapter.resolveOrClaim(key)).resolves.toEqual({ expiresAt: '2026-09-14T12:15:00.000Z', state: 'LEASED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(local.record).toMatchObject({ leaseToken: 'x'.repeat(32), state: 'LEASED' });
  });

  it('proposes only the public key, lease and provider IDs', async () => {
    const local = new MemoryDiscoveryStore();
    local.record = { expiresAt: '2026-09-14T12:15:00.000Z', id: 'lease', key, leaseToken: 'x'.repeat(32), retryAt: '2026-09-14T12:15:00.000Z', state: 'LEASED' };
    const bodies: unknown[] = [];
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ proposalDigest: 'b'.repeat(64), state: 'PENDING' }, { status: 202 });
    });
    const adapter = new HttpPublicDiscoveryAdapter('https://tobirink.com', local, fetcher, () => Date.parse('2026-09-14T12:01:00.000Z'));

    await adapter.propose(key, [{ externalId: '154587', provider: 'anilist' }]);
    expect(bodies).toEqual([{ key, leaseToken: 'x'.repeat(32), references: [{ externalId: '154587', provider: 'anilist' }], schemaVersion: 1 }]);
    expect(JSON.stringify(bodies)).not.toContain('Frieren');
    expect(local.record).toMatchObject({ state: 'PENDING' });
  });
});
