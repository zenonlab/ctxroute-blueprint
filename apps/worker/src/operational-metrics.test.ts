import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { instrumentAgendaR2, instrumentD1, instrumentProviderFetch } from './operational-metrics';
import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter, R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { enqueueAgendaRefresh, processAgendaQueue, recoverPendingAgenda, type NativeCollectorSignal } from './native-collectors';
import worker, { publicDiscoveryRecoveryCron } from './index';

describe('operational metrics', () => {
  beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('accounts for admission and recovery exactly once and retries a failed send without losing its signal', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T03:23:00.000Z'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const get = vi.spyOn(env.RELEASE_SNAPSHOTS, 'get');
    const put = vi.spyOn(env.RELEASE_SNAPSHOTS, 'put');
    const list = vi.spyOn(env.RELEASE_SNAPSHOTS, 'list');
    const send = vi.fn().mockRejectedValueOnce(new Error('queue-unavailable')).mockResolvedValue(undefined);
    const bindings = { ...env, PUBLIC_DISCOVERY_QUEUE: Object.assign(Object.create(null), { send }) };
    const controller = { scheduledTime: Date.now(), cron: '23 3 * * SUN', noRetry: vi.fn() };
    await expect(enqueueAgendaRefresh(controller, bindings)).rejects.toThrow('queue-unavailable');
    const events = info.mock.calls.map(call => JSON.parse(String(call[0])));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ task: 'agenda-admission', result: 'changed', queueSends: 0 });
    expect(events[1]).toMatchObject({ task: 'agenda-recovery', result: 'failed', queueSends: 1, queueFailures: 1 });
    expect(events.reduce((sum, event) => sum + event.r2Reads, 0)).toBe(get.mock.calls.length);
    expect(events.reduce((sum, event) => sum + event.r2Writes, 0)).toBe(put.mock.calls.length);
    expect(events.reduce((sum, event) => sum + event.r2Lists, 0)).toBe(list.mock.calls.length);
    expect(warn.mock.calls.map(call => JSON.parse(String(call[0])).code)).toContain('agenda-recovery-failed');
    const store = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS);
    await expect(store.pendingSignal()).resolves.toBe('2026-09-20T03:23:00.000Z');
    await recoverPendingAgenda(bindings);
    expect(send).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-09-20T03:24:01.000Z'));
    await recoverPendingAgenda(bindings);
    expect(send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(info.mock.calls.at(-1)?.[0]))).toMatchObject({ task: 'agenda-recovery', queueSends: 1, queueFailures: 0, result: 'changed' });
    await expect(store.pendingSignal()).resolves.toBe('2026-09-20T03:23:00.000Z');
  });

  it('uses the daily bounded Discovery wake without changing the weekly Agenda cron', async () => {
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-22T12:00:00.000Z');
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = '2026-09-22T12:00:00.000Z';
    const key = { fingerprint: 'f'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    await adapter.request({ key, query: { discoveryTitles: ['Recovery fixture'], mediaKind: 'ANIME', sourceTitles: ['Recovery fixture'] }, requestDigest: 'd'.repeat(64), schemaVersion: 3 }, now);
    await env.PUBLIC_DB.prepare('UPDATE public_discovery_requests_v3 SET retry_at = ?1 WHERE fingerprint = ?2').bind('2026-09-22T12:05:00.000Z', key.fingerprint).run();
    const send = vi.fn(async (_body: NativeCollectorSignal, _options?: { contentType?: string; delaySeconds?: number }) => undefined);
    await worker.scheduled({ scheduledTime: Date.parse(now), cron: publicDiscoveryRecoveryCron, noRetry: vi.fn() }, { ...env, PROVIDER_TRANSPORT_MODE: 'direct', PUBLIC_DISCOVERY_QUEUE: Object.assign(Object.create(null), { send }) });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ type: 'public-discovery-ready', version: 1 }, expect.objectContaining({ contentType: 'json' }));
    expect(send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
  });

  it('retains R2 attempt metrics when collection fails before its first claim', async () => {
    vi.spyOn(env.RELEASE_SNAPSHOTS, 'get').mockRejectedValueOnce(new Error('network'));
    await expect(processAgendaQueue(env, '2026-09-20T03:23:00.000Z')).rejects.toMatchObject({ metrics: { r2Reads: 1, r2Writes: 0, providerRequests: 0, result: 'failed' } });
  });

  it('coalesces operational recovery messages with the final batch recovery and emits a bounded overdue signal', async () => {
    const scheduledFor = '2020-01-01T00:00:00.000Z';
    await new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS).writePendingSignal({ scheduledFor, now: scheduledFor, ownerToken: 'x'.repeat(64) });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const send = vi.fn(async () => undefined);
    const messages = Array.from({ length: 3 }, (_, index) => ({ id: String(index), timestamp: new Date(), attempts: 1, body: { type: 'agenda-recovery' as const, version: 1 as const }, ack: vi.fn(), retry: vi.fn() }));
    const batch: MessageBatch<NativeCollectorSignal> = { queue: 'test', messages, metadata: { metrics: { backlogCount: 3, backlogBytes: 150 } }, ackAll: vi.fn(), retryAll: vi.fn() };
    await worker.queue(batch, { ...env, PUBLIC_DISCOVERY_QUEUE: Object.assign(Object.create(null), { send }) });
    expect(send).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ task: 'agenda-recovery', queueSends: 1 });
    expect(warn.mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([{ schemaVersion: 1, type: 'native-collector.health', code: 'agenda-recovery-overdue' }]);
    for (const item of messages) { expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled(); }
  });

  it('continues a truncated legacy scan even when its first page contains no outstanding work', async () => {
    await env.RELEASE_SNAPSHOTS.put('agenda-operations/v2/legacy-signals-scan.json', JSON.stringify({ cursor: null, complete: false }));
    await env.RELEASE_SNAPSHOTS.put('agenda-operations/v2/pending.json', JSON.stringify({ schemaVersion: 1, scheduled: [], nextDeliveryAt: null }));
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const list = vi.spyOn(env.RELEASE_SNAPSHOTS, 'list').mockResolvedValueOnce({ objects: [], truncated: true, cursor: 'next-page', delimitedPrefixes: [] });
    const send = vi.fn(async () => undefined);
    await recoverPendingAgenda({ ...env, PUBLIC_DISCOVERY_QUEUE: Object.assign(Object.create(null), { send }) });
    expect(list).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'agenda-recovery', version: 1 }, { contentType: 'json', delaySeconds: 60 });
    expect(await (await env.RELEASE_SNAPSHOTS.get('agenda-operations/v2/legacy-signals-scan.json'))?.json()).toEqual({ cursor: 'next-page', complete: false });
  });
  it('counts R2 operations and conditional conflicts without exposing object keys', async () => {
    const metrics = instrumentAgendaR2(env.RELEASE_SNAPSHOTS);
    const options = { httpMetadata: { contentType: 'application/json' }, onlyIf: { etagDoesNotMatch: '*' } };
    await metrics.bucket.put('metrics/r2-counter', '{}', options);
    await expect(metrics.bucket.put('metrics/r2-counter', '{}', options)).resolves.toBeNull();
    await metrics.bucket.get('metrics/r2-counter');
    await metrics.bucket.list?.({ prefix: 'metrics/', limit: 1 });
    expect(metrics.snapshot()).toEqual({ r2Reads: 1, r2Writes: 2, r2Lists: 1, r2Conflicts: 1 });
  });
  it('sums only D1Result meta without inspecting query values', async () => {
    const statement = {
      all: vi.fn(async () => ({ meta: { rows_read: 3, rows_written: 0 }, results: [{ value: 1 }], success: true })),
      bind: vi.fn(), first: vi.fn(), raw: vi.fn(),
      run: vi.fn(async () => ({ meta: { rows_read: 2, rows_written: 1 }, results: [], success: true })),
    };
    statement.bind.mockReturnValue(statement);
    const database: D1Database = Object.assign(Object.create(null), {
      batch: vi.fn(async () => [{ meta: { rows_read: 4, rows_written: 2 }, results: [], success: true }]),
      dump: vi.fn(), exec: vi.fn(), prepare: vi.fn(() => statement), withSession: vi.fn(),
    });
    const metrics = instrumentD1(database);
    await metrics.database.prepare('SELECT value').first();
    await metrics.database.prepare('UPDATE value').run();
    await metrics.database.batch([metrics.database.prepare('INSERT value')]);
    expect(statement.first).not.toHaveBeenCalled();
    expect(metrics.snapshot()).toEqual({ rowsRead: 9, rowsWritten: 3 });
  });

  it('counts real provider HTTP requests by bounded provider name', async () => {
    const upstream = vi.fn(async (input: string) => new Response('{}', {
      status: input.includes('anilist') ? 429 : input.includes('mangaupdates') ? 503 : 200,
    }));
    const metrics = instrumentProviderFetch(upstream);
    expect((await metrics.fetch('https://graphql.anilist.co', {})).status).toBe(429);
    expect((await metrics.fetch('https://api.mangaupdates.com/v1/releases/search', {})).status).toBe(503);
    expect((await metrics.fetch('https://tobirink.com/v3/releases', {})).status).toBe(200);
    expect(metrics.snapshot()).toEqual({ anilist: 1, kitsu: 0, mangadex: 0, mangaupdates: 1 });
    expect(Object.keys(metrics.snapshot())).toEqual(['anilist', 'kitsu', 'mangadex', 'mangaupdates']);
  });

  it('uses native row metadata instead of multiplying writes by payload size', async () => {
    const statement = {
      all: vi.fn(), bind: vi.fn(), first: vi.fn(), raw: vi.fn(),
      run: vi.fn(async () => ({ meta: { rows_read: 0, rows_written: 1 }, results: [{ payload: 'x'.repeat(64_000) }], success: true })),
    };
    statement.bind.mockReturnValue(statement);
    const database: D1Database = Object.assign(Object.create(null), {
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(), prepare: vi.fn(() => statement), withSession: vi.fn(),
    });
    const metrics = instrumentD1(database);
    await metrics.database.prepare('INSERT synthetic payload').run();
    expect(metrics.snapshot()).toEqual({ rowsRead: 0, rowsWritten: 1 });
  });
});
