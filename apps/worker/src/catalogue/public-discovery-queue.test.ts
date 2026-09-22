import { applyD1Migrations, env } from 'cloudflare:test';
import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { HttpPublicDiscoveryAdapter } from '../../../../packages/adapters-browser/src/catalogue/http-public-discovery-adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';
import { handleNativeCollectorQueue, processPublicDiscoveryQueue, type NativeCollectorSignal } from '../native-collectors';

function key(marker: string) {
  return { fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
}

function submission(marker: string, title: string) {
  return { key: key(marker), query: { discoveryTitles: [title], mediaKind: 'ANIME' as const, sourceTitles: [title] }, schemaVersion: 3 as const };
}

beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));

describe('public discovery queue trigger', () => {
  it('requeues a cadence-deferred claim at its deadline without using a provider attempt', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const request = { ...submission('c', 'Cadence deferred work'), requestDigest: 'd'.repeat(64) };
    const now = '2026-09-20T12:00:00.000Z';
    await adapter.request(request, now);
    const claim = await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), now, leaseUntil: '2026-09-20T12:15:00.000Z', limit: 1 });
    expect(claim.requests).toHaveLength(1);
    await adapter.deferClaim(claim.requests[0]!, 'b'.repeat(64), '2026-09-20T12:00:08.000Z', now);
    expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts, claim_token_hash AS claim FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(request.key.fingerprint).first()).toEqual({ state: 'PENDING', attempts: 0, claim: null });
    expect((await adapter.claimBatch({ claimToken: 'c'.repeat(48), tokenDigest: 'd'.repeat(64), now: '2026-09-20T12:00:07.000Z', leaseUntil: '2026-09-20T12:15:07.000Z', limit: 1 })).requests).toHaveLength(0);
    const resumed = await adapter.claimBatch({ claimToken: 'c'.repeat(48), tokenDigest: 'd'.repeat(64), now: '2026-09-20T12:00:08.000Z', leaseUntil: '2026-09-20T12:15:08.000Z', limit: 1 });
    expect(resumed.requests[0]?.attempt).toBe(1);
    await adapter.publishBatch({ claimToken: resumed.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440001', results: [{ key: request.key, requestDigest: request.requestDigest, resolution: { reason: 'synthetic-no-match', state: 'NOT_FOUND' } }], schemaVersion: 3, verifiedAt: '2026-09-20T12:00:09.000Z' }, 'd'.repeat(64), 'e'.repeat(64), '2026-09-20T12:00:09.000Z');
  });

  it('defers a refresh without losing its verified profile or consuming a refresh attempt', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const request = { ...submission('b', 'Verified refresh'), requestDigest: 'f'.repeat(64) };
    const initialAt = '2026-09-01T12:00:00.000Z';
    await adapter.request(request, initialAt);
    const initial = await adapter.claimBatch({ claimToken: 'e'.repeat(48), tokenDigest: 'e'.repeat(64), now: initialAt, leaseUntil: '2026-09-01T12:15:00.000Z', limit: 1 });
    const verified = { key: request.key, requestDigest: request.requestDigest, resolution: {
      profile: {
        candidate: { displayTitle: 'Verified refresh', externalId: '999998', genres: [], mediaKind: 'ANIME' as const, metadataVersion: 2 as const, preSerialization: false, provider: 'anilist' as const, titles: ['Verified refresh'] },
        references: [{ externalId: '999998', provider: 'anilist' as const }], workId: 'work_anilist_999998',
      }, state: 'VERIFIED' as const,
    } };
    await adapter.publishBatch({
      claimToken: initial.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440002',
      results: [verified], schemaVersion: 3, verifiedAt: initialAt,
    }, 'e'.repeat(64), 'f'.repeat(64), initialAt);
    await env.PUBLIC_DB.prepare('UPDATE public_discovery_requests_v3 SET next_refresh_at = ?1 WHERE fingerprint = ?2')
      .bind('2026-09-19T00:00:00.000Z', request.key.fingerprint).run();
    const now = '2026-09-20T12:00:00.000Z';
    expect((await adapter.requestRefresh(request.key, now)).outcome).toBe('created');
    const claimed = await adapter.claimBatch({ claimToken: 'g'.repeat(48), tokenDigest: 'g'.repeat(64), now, leaseUntil: '2026-09-20T12:15:00.000Z', limit: 1 });
    expect(claimed.requests[0]?.attempt).toBe(1);
    await adapter.deferClaim(claimed.requests[0]!, 'g'.repeat(64), '2026-09-20T12:00:08.000Z', now);
    expect(await env.PUBLIC_DB.prepare('SELECT state, refresh_state AS refreshState, refresh_attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(request.key.fingerprint).first()).toEqual({ state: 'VERIFIED', refreshState: 'PENDING', attempts: 0 });
    await expect(adapter.read(request.key, now)).resolves.toMatchObject({ state: 'VERIFIED', profile: { workId: 'work_anilist_999998' } });
    expect((await adapter.claimBatch({ claimToken: 'h'.repeat(48), tokenDigest: 'h'.repeat(64), now: '2026-09-20T12:00:07.000Z', leaseUntil: '2026-09-20T12:15:07.000Z', limit: 1 })).requests).toHaveLength(0);
    const resumed = await adapter.claimBatch({ claimToken: 'h'.repeat(48), tokenDigest: 'h'.repeat(64), now: '2026-09-20T12:00:08.000Z', leaseUntil: '2026-09-20T12:15:08.000Z', limit: 1 });
    expect(resumed.requests[0]?.attempt).toBe(1);
    await adapter.publishBatch({ claimToken: resumed.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440003', results: [verified], schemaVersion: 3, verifiedAt: '2026-09-20T12:00:09.000Z' }, 'h'.repeat(64), 'i'.repeat(64), '2026-09-20T12:00:09.000Z');
  });

  it('does not extend a D1 provider reservation beyond the request window', async () => {
    const controls = new D1ProviderRuntimeControl(env.PUBLIC_DB);
    expect(await controls.reserve('anilist', 10_000, 3_000)).toBe(10_000);
    expect(await controls.reserve('anilist', 10_000, 3_000)).toBe(18_000);
    const before = await env.PUBLIC_DB.prepare('SELECT next_allowed_at AS nextAllowed, active_until AS activeUntil FROM public_discovery_provider_runtime WHERE provider = ?1').bind('anilist').first();
    expect(await controls.reserve('anilist', 10_000, 3_000)).toBe(26_000);
    const after = await env.PUBLIC_DB.prepare('SELECT next_allowed_at AS nextAllowed, active_until AS activeUntil FROM public_discovery_provider_runtime WHERE provider = ?1').bind('anilist').first();
    expect(after).toEqual(before);
  });

  it.each(['exact', 'title'] as const)('carries the real extension %s request through admission, Queue, provider validation and D1 publication', async (mode) => {
    const queue = { send: vi.fn(async () => undefined) };
    const port = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: port, queue });
    const client = () => new HttpPublicDiscoveryAdapter('https://tobirink.test', async (url, init) => {
      // workerd's Request omits redirect:error; preserve browser rejection in this in-process transport.
      const response = await app.request(url, { ...init, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) throw new Error('Unexpected test redirect');
      return response;
    });
    const titleQuery = { discoveryTitles: ['Cowboy Bebop'], sourceTitles: ['Cowboy Bebop'], mediaKind: 'ANIME' as const };
    const query = mode === 'exact'
      ? { ...titleQuery, explicitProviderReference: { provider: 'anilist' as const, externalId: '1' } } : titleQuery;
    const discoveryKey = key(mode === 'exact' ? 'e' : 'f');
    const extension = client();
    extension.setDeadline(Date.now() + 14_000);
    expect(await extension.resolveOrRequest(discoveryKey, query)).toMatchObject({ state: 'PENDING' });
    expect(queue.send).toHaveBeenCalledOnce();
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://graphql.anilist.co');
      const media = {
        id: 1, type: 'ANIME', format: 'TV', genres: [], synonyms: [], siteUrl: 'https://anilist.co/anime/1',
        title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', native: null },
        coverImage: { extraLarge: null, large: null, medium: null },
      };
      return Response.json({ data: String(init?.body).includes('FavoriteSearch')
        ? { Page: { pageInfo: { hasNextPage: false }, media: [media] } } : { Media: media } });
    });
    try {
      const item = { body: { type: 'public-discovery-ready' as const, version: 1 as const }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
      await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: () => processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }) });
      expect(provider).toHaveBeenCalledTimes(mode === 'exact' ? 1 : 2);
      expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
      const result = await client().resolveOrRequest(discoveryKey, query);
      expect(result).toMatchObject({ state: 'VERIFIED', profile: { candidate: { externalId: '1', titles: ['Cowboy Bebop'], provider: 'anilist' } } });
      expect(queue.send).toHaveBeenCalledOnce();
    } finally { provider.mockRestore(); }
  }, 15_000);
  it('keeps an empty claimed batch alive and retries when continuation delivery fails', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = new Date().toISOString();
    await adapter.request({ ...submission('3', 'Synthetic leased work'), requestDigest: 'a'.repeat(64) }, now);
    await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), now, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString(), limit: 1 });
    const metrics = { backlogBytes: 0, backlogCount: 0 };
    const queue = { metrics: async () => metrics, send: vi.fn(async (_body: NativeCollectorSignal, _options?: { contentType?: string; delaySeconds?: number }) => ({ metadata: { metrics } })), sendBatch: vi.fn(async () => ({ metadata: { metrics } })) };
    const bindings = { ...env, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_GATEWAY_HMAC_KEY: 'x'.repeat(32) };
    expect(await processPublicDiscoveryQueue(bindings)).toMatchObject({ claimed: 0, continuationScheduled: true });
    expect(queue.send).toHaveBeenCalledOnce();
    expect(queue.send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(queue.send.mock.calls[0]?.[1]?.delaySeconds).toBeLessThanOrEqual(900);
    queue.send.mockRejectedValueOnce(new Error('local-queue-failure'));
    const item = { body: { type: 'public-discovery-ready', version: 1 }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: () => processPublicDiscoveryQueue(bindings) });
    expect(item.ack).not.toHaveBeenCalled(); expect(item.retry).toHaveBeenCalledOnce();
  });
  it('measures warm local admission and D1 read separately', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => undefined } });
    const submit = () => app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('9', 'Synthetic latency')), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    await submit();
    const admissions: number[] = []; const reads: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      let start = performance.now();
      expect((await submit()).status).toBe(202);
      admissions.push(performance.now() - start);
      start = performance.now();
      expect((await adapter.read(key('9'), new Date().toISOString())).state).toBe('PENDING');
      reads.push(performance.now() - start);
    }
    const admissionP95 = admissions.sort((a, b) => a - b)[18]!;
    const readP95 = reads.sort((a, b) => a - b)[18]!;
    expect(admissionP95).toBeLessThan(500); expect(readP95).toBeLessThan(300);
    console.info(JSON.stringify({ type: 'local-discovery-latency', samples: 20, admissionP95, readP95 }));
  });
  it('repairs historical SENT signals without resetting attempts or stealing a valid lease', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const request = { ...submission('7', 'Synthetic repair'), requestDigest: 'a'.repeat(64) };
    const now = '2026-09-18T12:00:00.000Z';
    await adapter.request(request, now);
    await adapter.confirmQueueSignal(request.key, request.requestDigest, now);
    expect((await adapter.request(request, '2026-09-18T12:00:30.000Z')).outcome).toBe('existing');
    expect((await adapter.request(request, '2026-09-18T12:01:01.000Z')).outcome).toBe('created');
    await adapter.confirmQueueSignal(request.key, request.requestDigest, '2026-09-18T12:01:01.000Z');
    await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), now: '2026-09-18T12:02:00.000Z', leaseUntil: '2026-09-18T12:17:00.000Z', limit: 1 });
    expect((await adapter.request(request, '2026-09-18T12:03:00.000Z')).outcome).toBe('existing');
    expect((await adapter.request(request, '2026-09-18T12:18:00.000Z')).outcome).toBe('created');
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint = ?').bind(request.key.fingerprint).first()).toEqual({ attempts: 1 });
  });
  it('retains a continuation deadline with more than twenty requests and with an empty due batch', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = '2026-09-18T12:00:00.000Z';
    for (let index = 0; index < 25; index += 1) {
      const request = submission('8', `Synthetic ${index}`);
      request.key.fingerprint = index.toString(16).padStart(64, '0');
      await adapter.request({ ...request, requestDigest: 'a'.repeat(64) }, now);
    }
    const input = { claimToken: 'c'.repeat(48), tokenDigest: 'd'.repeat(64), now, leaseUntil: '2026-09-18T12:15:00.000Z', limit: 20 };
    expect((await adapter.claimBatch(input)).requests).toHaveLength(20);
    expect(await adapter.nextPendingAt()).toBe(now);
    expect((await adapter.claimBatch(input)).requests).toHaveLength(5);
    expect((await adapter.claimBatch(input)).requests).toHaveLength(0);
    expect(await adapter.nextPendingAt()).toBe(input.leaseUntil);
  });
  it('enqueues only an opaque signal after a cache miss', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB), queue });
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('4', 'Private raw title')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(queue.send).toHaveBeenCalledExactlyOnceWith({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' });
    expect(JSON.stringify(queue.send.mock.calls)).not.toContain('Private');
  });

  it('returns 503 but preserves PENDING when the queue is unavailable', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('queue-down'); } } });
    const discoveryKey = key('5');
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('5', 'Queue retry')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'discovery-queue-unavailable' });
    await expect(adapter.read(discoveryKey, new Date().toISOString())).resolves.toMatchObject({ state: 'PENDING' });
    const retry = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('5', 'Queue retry')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(retry.status).toBe(503);
  });

  it('releases a newly admitted signal when the Queue binding is missing, then repairs it on retry', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const body = JSON.stringify(submission('a', 'Missing queue binding'));
    const submit = (app: ReturnType<typeof createPublicDiscoveryApp>) => app.request(
      'https://tobirink.test/v3/catalogue/discoveries/requests',
      { body, headers: { 'Content-Type': 'application/json' }, method: 'POST' },
    );
    const unavailable = await submit(createPublicDiscoveryApp({ publicDiscoveryV3: adapter }));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({ error: 'discovery-queue-unavailable' });
    expect(await env.PUBLIC_DB.prepare('SELECT state, queue_signal_state AS signal FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(key('a').fingerprint).first()).toEqual({ signal: 'UNSENT', state: 'PENDING' });

    const queue = { send: vi.fn(async () => undefined) };
    const repaired = await submit(createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue }));
    expect(repaired.status).toBe(202);
    expect(queue.send).toHaveBeenCalledOnce();
    expect(await env.PUBLIC_DB.prepare('SELECT queue_signal_state AS signal FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(key('a').fingerprint).first()).toEqual({ signal: 'SENT' });
  });

  it('emits one Queue signal for ten thousand identical admissions', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    let requests = 0;
    const port = {
      claimBatch: vi.fn(), confirmQueueSignal: vi.fn(async () => undefined), publishBatch: vi.fn(), read: vi.fn(),
      deferClaim: vi.fn(async () => undefined),
      releaseQueueSignal: vi.fn(async () => undefined),
      requestRefresh: vi.fn(),
      request: vi.fn(async () => ({
        outcome: requests++ === 0 ? 'created' as const : 'existing' as const,
        state: { retryAt: '2026-09-16T12:01:00.000Z', state: 'PENDING' as const },
      })),
    };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: port, queue });
    const body = JSON.stringify(submission('6', 'Coalesced work'));

    for (let index = 0; index < 10_000; index += 1) {
      expect((await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
        body, headers: { 'Content-Type': 'application/json' }, method: 'POST',
      })).status).toBe(202);
    }

    expect(port.request).toHaveBeenCalledTimes(10_000);
    expect(queue.send).toHaveBeenCalledOnce();
    expect(port.confirmQueueSignal).toHaveBeenCalledOnce();
  }, 30_000);
});
