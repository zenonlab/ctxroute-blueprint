import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRetryError, publicDiscoveryProviderSchema, runPublicDiscoveryBatch, type PublicDiscoveryClaimBatch, type PublicDiscoveryResultBatch } from '.';
import { createPublicDiscoveryResolver } from './resolver';

const key = {
  fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const,
  parserVersion: 'favorite-parser-v5', siteRulesVersion: 'site-rules-v1',
};
const claims: PublicDiscoveryClaimBatch = {
  claimToken: 'c'.repeat(48),
  requests: [{
    attempt: 1, key,
    query: { discoveryTitles: ['Frieren'], mediaKind: 'ANIME', sourceTitles: ['Sousou no Frieren'] },
    requestDigest: 'b'.repeat(64), schemaVersion: 3,
  }],
  schemaVersion: 3,
};

describe('runPublicDiscoveryBatch', () => {
  it('publishes the first verified result before resolving the next request', async () => {
    const order: string[] = [];
    await runPublicDiscoveryBatch({
      gateway: { claim: async () => ({ ...claims, requests: [...claims.requests, { ...claims.requests[0]!, key: { ...key, fingerprint: 'd'.repeat(64) } }] }), defer: async () => undefined, publish: async () => { order.push('published'); return { published: 1, replayed: 0 }; } },
      limit: 20, nonce: () => crypto.randomUUID(), now: () => '2026-09-18T12:00:00.000Z',
      resolver: { resolve: async () => { order.push('resolved'); return { state: 'NOT_FOUND', reason: 'synthetic-no-match' }; } },
    });
    expect(order).toEqual(['resolved', 'published', 'resolved', 'published']);
  });
  it('closes the portable contract over every configured provider family', () => {
    expect(publicDiscoveryProviderSchema.options).toEqual(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']);
  });
  it('publishes a validated terminal resolution', async () => {
    const publish = vi.fn(async (_batch: PublicDiscoveryResultBatch) => ({ published: 1, replayed: 0 }));
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: async () => undefined, publish }, limit: 20,
      nonce: () => '550e8400-e29b-41d4-a716-446655440000', now: () => '2026-09-14T10:00:00.000Z',
      resolver: { resolve: async () => ({ reason: 'no provider match', state: 'NOT_FOUND' }) },
    });
    expect(report).toEqual({ claimed: 1, deferred: 0, failed: 0, published: 1, replayed: 0 });
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ claimToken: claims.claimToken, results: [expect.objectContaining({ key })] }));
  });

  it('isolates transient resolver failures without publishing them', async () => {
    const publish = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: async () => undefined, publish }, limit: 1,
      nonce: () => '550e8400-e29b-41d4-a716-446655440000', now: () => '2026-09-14T10:00:00.000Z',
      resolver: { resolve: async () => { throw new Error('provider unavailable'); } },
    });
    expect(report).toEqual({ claimed: 1, deferred: 0, failed: 1, published: 0, replayed: 0 });
    expect(publish).not.toHaveBeenCalled();
  });

  it('defers provider cadence without publishing or consuming a failed attempt', async () => {
    const defer = vi.fn(async () => undefined);
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer, publish: vi.fn() }, limit: 1,
      nonce: () => '550e8400-e29b-41d4-a716-446655440000', now: () => '2026-09-14T10:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderRetryError('Provider cadence requires a later wake.', Date.parse('2026-09-14T10:01:00.000Z')); } },
    });
    expect(report).toEqual({ claimed: 1, deferred: 1, failed: 0, published: 0, replayed: 0 });
    expect(defer).toHaveBeenCalledExactlyOnceWith(claims.requests[0], '2026-09-14T10:01:00.000Z', '2026-09-14T10:00:00.000Z');
  });

  it.each(['HTTP 503', 'fetch failed', 'invalid provider schema'])('does not refund a spent %s failure from the portable resolver', async (message) => {
    const failure = new Error(message);
    const provider = { search: vi.fn(async () => { throw failure; }), hydrate: vi.fn(async () => undefined) };
    const defer = vi.fn(async () => undefined);
    const publish = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer, publish }, limit: 1,
      nonce: () => crypto.randomUUID(), now: () => '2026-09-26T10:00:00.000Z',
      resolver: createPublicDiscoveryResolver({ anilist: provider, mangaupdates: provider, mangadex: provider, 'kitsu-anime': provider, 'kitsu-manga': provider }),
    });
    expect(report).toEqual({ claimed: 1, deferred: 0, failed: 1, published: 0, replayed: 0 });
    expect(provider.search).toHaveBeenCalledTimes(2);
    expect(defer).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['cadence', 'HTTP 429'])('preserves the portable resolver %s deadline without spending an attempt', async (message) => {
    const retryAt = Date.parse('2026-09-26T10:02:00.000Z');
    const provider = { search: vi.fn(async () => { throw new FavoriteProviderRetryError(message, retryAt); }), hydrate: vi.fn(async () => undefined) };
    const defer = vi.fn(async () => undefined);
    const publish = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer, publish }, limit: 1,
      nonce: () => crypto.randomUUID(), now: () => '2026-09-26T10:00:00.000Z',
      resolver: createPublicDiscoveryResolver({ anilist: provider, mangaupdates: provider, mangadex: provider, 'kitsu-anime': provider, 'kitsu-manga': provider }),
    });
    expect(report).toEqual({ claimed: 1, deferred: 1, failed: 0, published: 0, replayed: 0 });
    expect(defer).toHaveBeenCalledExactlyOnceWith(claims.requests[0], '2026-09-26T10:02:00.000Z', '2026-09-26T10:00:00.000Z');
    expect(publish).not.toHaveBeenCalled();
  });
});
