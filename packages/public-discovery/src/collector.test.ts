import { describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRetryError, publicDiscoveryProviderSchema, runPublicDiscoveryBatch, type PublicDiscoveryClaimBatch, type PublicDiscoveryResultBatch } from '.';
import { createPublicDiscoveryResolver } from './resolver';
import { FavoriteProviderHttpError, FavoriteProviderRateGate, readFavoriteProviderJson } from './provider-http';
import { z } from 'zod';

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
  it.each(['http-429', 'failed-probe'])('records the actual provider failure before deferring %s', async (scenario) => {
    const order: string[] = [];
    const recordFailure = vi.fn(async () => { order.push('record'); });
    const operation = vi.fn();
    const resolve = async () => {
      if (scenario === 'http-429') await readFavoriteProviderJson(async () => new Response(null, { status: 429, headers: { 'retry-after': '60' } }), 'https://provider.example/test', {}, z.object({}));
      else await new FavoriteProviderRateGate('anilist', {
        reserve: async () => ({ notBefore: 0, probeOnly: true }),
        recordFailure: async () => undefined, recordSuccess: async () => undefined,
      }, () => 0, async () => undefined, async () => { throw new FavoriteProviderHttpError(503); }).run(3_000, operation);
      throw new Error('expected-provider-failure');
    };
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, publish: vi.fn(), recordFailure, defer: async () => { order.push('defer'); } },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-30T12:00:00.000Z', resolver: { resolve },
    });
    expect(order).toEqual(['record', 'defer']);
    expect(recordFailure).toHaveBeenCalledWith(claims.requests[0], expect.objectContaining({ failure: expect.objectContaining({ status: scenario === 'http-429' ? 429 : 503 }) }), 'retry-requested', '2026-09-30T12:00:00.000Z');
    expect(report).toMatchObject({ deferred: 1, failed: 0, published: 0 });
    expect(operation).not.toHaveBeenCalled();
  });
  it('records the failure before requesting an automatic retry', async () => {
    const order: string[] = [];
    const failure = new FavoriteProviderHttpError(503);
    const recordFailure = vi.fn(async () => { order.push('record'); });
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), publish: vi.fn(), recordFailure, retryTransient: async () => { order.push('retry'); } },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-30T12:00:00.000Z',
      resolver: { resolve: async () => { throw failure; } },
    });
    expect(order).toEqual(['record', 'retry']);
    expect(recordFailure).toHaveBeenCalledExactlyOnceWith(claims.requests[0], failure, 'retry-requested', '2026-09-30T12:00:00.000Z');
    expect(report).toMatchObject({ deferred: 1, failed: 0 });
  });

  it('does not pretend persistence succeeded when the diagnostic store fails', async () => {
    const retryTransient = vi.fn();
    await expect(runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), publish: vi.fn(), retryTransient,
        recordFailure: async () => { throw new Error('diagnostic-store-unavailable'); } },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-30T12:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderHttpError(503); } },
    })).rejects.toThrow('diagnostic-store-unavailable');
    expect(retryTransient).not.toHaveBeenCalled();
  });

  it('records a publication failure without claiming the work was published', async () => {
    const recordFailure = vi.fn();
    const failure = new Error('D1_ERROR: private payload');
    await expect(runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), recordFailure, publish: async () => { throw failure; } },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-30T12:00:00.000Z',
      resolver: { resolve: async () => ({ state: 'NOT_FOUND', reason: 'synthetic-no-match' }) },
    })).rejects.toThrow(failure);
    expect(recordFailure).toHaveBeenCalledExactlyOnceWith(claims.requests[0], failure, 'publication-failed', '2026-09-30T12:00:00.000Z');
  });
  it.each([new TypeError('fetch failed'), new DOMException('aborted', 'AbortError'), new DOMException('timeout', 'TimeoutError')])('retries a recognized transport failure: %s', async (failure) => {
    const retryTransient = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), publish: vi.fn(), retryTransient },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-29T12:00:00.000Z',
      resolver: { resolve: async () => { throw failure; } },
    });
    expect(report).toMatchObject({ deferred: 1, failed: 0, published: 0 });
    expect(retryTransient).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 403, 404, 422])('does not automatically cycle permanent HTTP %i failures', async (status) => {
    const retryTransient = vi.fn();
    const publish = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), retryTransient, publish },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-29T12:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderHttpError(status); } },
    });
    expect(report).toMatchObject({ failed: 1, deferred: 0, published: 0 });
    expect(retryTransient).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it('does not report a retry when its durable reservation fails', async () => {
    await expect(runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), publish: vi.fn(), retryTransient: async () => { throw new Error('claim-lost'); } },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-29T12:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderHttpError(503); } },
    })).rejects.toThrow('claim-lost');
  });
  it.each([true, false])('does not hide a permanent provider failure behind a temporary fallback (%s)', async (permanentFirst) => {
    const permanent = { search: vi.fn(async () => { throw new FavoriteProviderHttpError(401); }), hydrate: vi.fn() };
    const temporary = { search: vi.fn(async () => { throw new FavoriteProviderHttpError(503); }), hydrate: vi.fn() };
    const retryTransient = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: vi.fn(), publish: vi.fn(), retryTransient },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-29T12:00:00.000Z',
      resolver: createPublicDiscoveryResolver({ anilist: permanentFirst ? permanent : temporary, 'kitsu-anime': permanentFirst ? temporary : permanent, mangaupdates: temporary, mangadex: temporary, 'kitsu-manga': temporary }),
    });
    expect(report).toMatchObject({ failed: 1, deferred: 0 });
    expect(retryTransient).not.toHaveBeenCalled();
  });
  it.each([408, 425, 500, 502, 503, 504])('automatically schedules consumed HTTP %i failures without Review', async (status) => {
    const retryTransient = vi.fn(async () => undefined);
    const publish = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer: async () => undefined, retryTransient, publish },
      limit: 1, nonce: () => crypto.randomUUID(), now: () => '2026-09-29T12:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderHttpError(status); } },
    });
    expect(report).toMatchObject({ deferred: 1, failed: 0, published: 0 });
    expect(retryTransient).toHaveBeenCalledExactlyOnceWith(claims.requests[0], '2026-09-29T12:00:00.000Z');
    expect(publish).not.toHaveBeenCalled();
  });
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
    const recordFailure = vi.fn();
    const report = await runPublicDiscoveryBatch({
      gateway: { claim: async () => claims, defer, recordFailure, publish: vi.fn() }, limit: 1,
      nonce: () => '550e8400-e29b-41d4-a716-446655440000', now: () => '2026-09-14T10:00:00.000Z',
      resolver: { resolve: async () => { throw new FavoriteProviderRetryError('Provider cadence requires a later wake.', Date.parse('2026-09-14T10:01:00.000Z')); } },
    });
    expect(report).toEqual({ claimed: 1, deferred: 1, failed: 0, published: 0, replayed: 0 });
    expect(defer).toHaveBeenCalledExactlyOnceWith(claims.requests[0], '2026-09-14T10:01:00.000Z', '2026-09-14T10:00:00.000Z');
    expect(recordFailure).not.toHaveBeenCalled();
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
