import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';
import { handleNativeCollectorQueue, processPublicDiscoveryQueue } from '../native-collectors';

function key(marker: string) {
  return { fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
}

function submission(marker: string, title: string) {
  return { key: key(marker), query: { discoveryTitles: [title], mediaKind: 'ANIME' as const, sourceTitles: [title] }, schemaVersion: 3 as const };
}

beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));

describe('public discovery queue trigger', () => {
  it('keeps an empty claimed batch alive and retries when continuation delivery fails', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = new Date().toISOString();
    await adapter.request({ ...submission('3', 'Synthetic leased work'), requestDigest: 'a'.repeat(64) }, now);
    await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), now, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString(), limit: 1 });
    const metrics = { backlogBytes: 0, backlogCount: 0 };
    const queue = { metrics: async () => metrics, send: vi.fn(async () => ({ metadata: { metrics } })), sendBatch: vi.fn(async () => ({ metadata: { metrics } })) };
    const bindings = { ...env, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_GATEWAY_HMAC_KEY: 'x'.repeat(32) };
    expect(await processPublicDiscoveryQueue(bindings)).toMatchObject({ claimed: 0, continuationScheduled: true });
    expect(queue.send).toHaveBeenCalledExactlyOnceWith({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json', delaySeconds: 900 });
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

  it('emits one Queue signal for ten thousand identical admissions', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    let requests = 0;
    const port = {
      claimBatch: vi.fn(), confirmQueueSignal: vi.fn(async () => undefined), publishBatch: vi.fn(), read: vi.fn(),
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
  });
});
