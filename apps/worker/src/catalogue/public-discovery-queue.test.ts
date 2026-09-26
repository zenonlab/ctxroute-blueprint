import { applyD1Migrations, createExecutionContext, env } from 'cloudflare:test';
import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { FavoriteProviderRetryError, type FavoriteProviderPort, type ProviderCandidateEnvelope } from '@tobirink/public-discovery';
import { HttpPublicDiscoveryAdapter } from '../../../../packages/adapters-browser/src/catalogue/http-public-discovery-adapter';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';
import { createBudgetedDiscoveryResolver, handleNativeCollectorQueue, processPublicDiscoveryQueue, type NativeCollectorSignal } from '../native-collectors';

function key(marker: string) {
  return { fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
}

function submission(marker: string, title: string) {
  return { key: key(marker), query: { discoveryTitles: [title], mediaKind: 'ANIME' as const, sourceTitles: [title] }, schemaVersion: 3 as const };
}

async function tokenDigest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function countedD1(database: D1Database, limit: number) {
  let calls = 0;
  const originals = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
  const spend = () => {
    calls += 1;
    if (calls > limit) throw new Error(`D1_TEST_INVOCATION_LIMIT: ${calls}/${limit}`);
  };
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => {
    // SAFETY: the counter delegates every statement operation to the real D1
    // binding, and batches unwrap these exact instances before execution.
    const wrapped = {
      all: <T = never>() => { spend(); return statement.all<T>(); },
      bind: (...values: Parameters<D1PreparedStatement['bind']>) => wrap(statement.bind(...values)),
      first: <T = never>(column?: string) => {
        spend(); return column === undefined ? statement.first<T>() : statement.first<T>(column);
      },
      raw: <T = never[]>(options?: { columnNames?: boolean }) => {
        spend(); return options?.columnNames === true ? statement.raw<T>({ columnNames: true }) : statement.raw<T>();
      },
      run: <T = never>() => { spend(); return statement.run<T>(); },
    } as D1PreparedStatement;
    originals.set(wrapped, statement);
    return wrapped;
  };
  return {
    calls: () => calls,
    // SAFETY: preserve all D1 methods while counting the real operations used
    // by the consumer; no SQL result or collector behavior is synthesized.
    database: {
      // Count a whole transaction as ONE call: a conservative lower bound.
      batch: <T = unknown>(statements: D1PreparedStatement[]) => {
        spend(); return database.batch<T>(statements.map(statement => originals.get(statement) ?? statement));
      },
      dump: () => database.dump(),
      exec: (query: string) => { spend(); return database.exec(query); },
      prepare: (query: string) => wrap(database.prepare(query)),
      withSession: (constraint?: D1SessionBookmark | D1SessionConstraint) => database.withSession(constraint),
    } as D1Database,
  };
}

beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));

async function preserveProviderRuntime() {
  const snapshot = await env.PUBLIC_DB.prepare(`SELECT provider, next_allowed_at AS nextAllowed, active_until AS activeUntil,
    consecutive_failures AS failures, circuit_open_until AS circuitOpen, updated_at AS updated
    FROM public_discovery_provider_runtime`).all<{
      provider: string; nextAllowed: number; activeUntil: number; failures: number; circuitOpen: number; updated: string;
    }>();
  return () => env.PUBLIC_DB.batch(snapshot.results.map(row => env.PUBLIC_DB.prepare(`UPDATE public_discovery_provider_runtime
    SET next_allowed_at = ?1, active_until = ?2, consecutive_failures = ?3, circuit_open_until = ?4, updated_at = ?5 WHERE provider = ?6`)
    .bind(row.nextAllowed, row.activeUntil, row.failures, row.circuitOpen, row.updated, row.provider)));
}

describe('public discovery queue trigger', () => {
  it('spends eight unavailable-provider attempts across fresh consumers, then stops without rearming FAILED', async () => {
    const restoreRuntime = await preserveProviderRuntime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const discoveryKey = { ...key('a'), fingerprint: 'a503'.padStart(64, '0'), mediaKind: 'UNKNOWN' as const };
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await adapter.request({ key: discoveryKey, query: { discoveryTitles: ['Synthetic unavailable work'], sourceTitles: ['Synthetic unavailable work'], mediaKind: 'UNKNOWN' }, requestDigest: 'd'.repeat(64), schemaVersion: 3 }, new Date().toISOString());
      for (let passage = 1; passage <= 10; passage += 1) {
        const report = await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, discoveryKey, false);
        expect(report).toMatchObject({ claimed: passage <= 8 ? 1 : 0, deferred: 0, failed: passage <= 8 ? 1 : 0, published: 0 });
        expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
          .bind(discoveryKey.fingerprint).first()).toEqual({ state: passage <= 8 ? 'PROCESSING' : 'FAILED', attempts: Math.min(passage, 8) });
        vi.setSystemTime(Date.now() + 16 * 60_000);
      }
      expect(provider).toHaveBeenCalledTimes(8 * 5);
      await expect(new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).read(discoveryKey, new Date().toISOString()))
        .resolves.toEqual({ state: 'UNAVAILABLE', reason: 'ATTEMPT_LIMIT' });
    } finally {
      provider.mockRestore(); warn.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(discoveryKey.fingerprint).run();
      await restoreRuntime();
    }
  });

  it('does not refund a spent primary failure when the fallback is cadence-deferred', async () => {
    const restoreRuntime = await preserveProviderRuntime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T00:00:00.000Z'));
    const discoveryKey = { ...key('b'), fingerprint: 'b503'.padStart(64, '0') };
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await env.PUBLIC_DB.prepare("UPDATE public_discovery_provider_runtime SET next_allowed_at = ?1 WHERE provider = 'kitsu-anime'")
        .bind(Date.now() + 120_000).run();
      await adapter.request({ ...submission('b', 'Synthetic mixed failure'), key: discoveryKey, requestDigest: 'e'.repeat(64) }, new Date().toISOString());
      expect(await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, discoveryKey, false))
        .toMatchObject({ claimed: 1, deferred: 0, failed: 1, published: 0 });
      expect(provider).toHaveBeenCalledTimes(1);
      expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
        .bind(discoveryKey.fingerprint).first()).toEqual({ state: 'PROCESSING', attempts: 1 });
    } finally {
      provider.mockRestore(); warn.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(discoveryKey.fingerprint).run();
      await restoreRuntime();
    }
  });

  it.each(['cadence', '429'])('preserves a pure %s deadline without spending an attempt', async (scenario) => {
    const restoreRuntime = await preserveProviderRuntime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T00:00:00.000Z'));
    const discoveryKey = { ...key('c'), fingerprint: (scenario === 'cadence' ? 'c503' : 'c429').padStart(64, '0') };
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const retryAt = new Date(Date.now() + 120_000).toISOString();
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '120' } }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      if (scenario === 'cadence') await env.PUBLIC_DB.prepare('UPDATE public_discovery_provider_runtime SET next_allowed_at = ?1')
        .bind(Date.now() + 120_000).run();
      await adapter.request({ ...submission('c', 'Synthetic deferred work'), key: discoveryKey, requestDigest: 'f'.repeat(64) }, new Date().toISOString());
      expect(await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, discoveryKey, false))
        .toMatchObject({ claimed: 1, deferred: 1, failed: 0, published: 0 });
      expect(provider).toHaveBeenCalledTimes(scenario === 'cadence' ? 0 : 2);
      expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts, retry_at AS retryAt FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
        .bind(discoveryKey.fingerprint).first()).toEqual({ state: 'PENDING', attempts: 0, retryAt });
      vi.setSystemTime(Date.now() + 119_000);
      expect(await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, discoveryKey, false)).toMatchObject({ claimed: 0 });
      expect(provider).toHaveBeenCalledTimes(scenario === 'cadence' ? 0 : 2);
    } finally {
      provider.mockRestore(); warn.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(discoveryKey.fingerprint).run();
      await restoreRuntime();
    }
  });

  it('keeps VERIFIED data after exhausting eight failed refresh attempts', async () => {
    const restoreRuntime = await preserveProviderRuntime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'));
    const discoveryKey = { ...key('d'), fingerprint: 'd503'.padStart(64, '0') };
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const initialAt = '2026-09-01T00:00:00.000Z';
    const requestDigest = 'a'.repeat(64);
    const profile = {
      workId: 'work_preserved_failed_refresh',
      candidate: { displayTitle: 'Synthetic preserved failed refresh', externalId: '905030', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic preserved failed refresh'] },
      references: [{ externalId: '905030', provider: 'anilist' as const }],
    };
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({}, { status: 503 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await adapter.request({ ...submission('d', 'Synthetic preserved failed refresh'), key: discoveryKey, requestDigest }, initialAt);
      const claim = await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), key: discoveryKey, now: initialAt, leaseUntil: '2026-09-01T00:15:00.000Z', limit: 1 });
      await adapter.publishBatch({ claimToken: claim.claimToken, nonce: crypto.randomUUID(), results: [{ key: discoveryKey, requestDigest, resolution: { state: 'VERIFIED', profile } }], schemaVersion: 3, verifiedAt: initialAt }, 'b'.repeat(64), 'c'.repeat(64), initialAt);
      expect((await adapter.requestRefresh(discoveryKey, new Date().toISOString())).outcome).toBe('created');
      for (let passage = 1; passage <= 10; passage += 1) {
        expect(await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, discoveryKey, false))
          .toMatchObject({ claimed: passage <= 8 ? 1 : 0, deferred: 0, failed: passage <= 8 ? 1 : 0, published: 0 });
        await expect(new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).read(discoveryKey, new Date().toISOString()))
          .resolves.toMatchObject({ state: 'VERIFIED', profile, verifiedAt: initialAt });
        vi.setSystemTime(Date.now() + 16 * 60_000);
      }
      expect(provider).toHaveBeenCalledTimes(8);
      expect(await env.PUBLIC_DB.prepare('SELECT state, refresh_state AS refreshState, refresh_attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
        .bind(discoveryKey.fingerprint).first()).toEqual({ state: 'VERIFIED', refreshState: 'IDLE', attempts: 0 });
    } finally {
      provider.mockRestore(); warn.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(discoveryKey.fingerprint).run();
      await restoreRuntime();
    }
  });

  it('overrides a resolver-converted budget error and defers later claims without calling any provider', async () => {
    const provider: FavoriteProviderPort = { search: vi.fn(), hydrate: vi.fn() };
    const providers = { anilist: provider, mangaupdates: provider, mangadex: provider, 'kitsu-anime': provider, 'kitsu-manga': provider };
    const resolver = createBudgetedDiscoveryResolver(providers, () => 43, () => 5);
    const request = { ...submission('2', 'Synthetic blocked budget'), attempt: 1, requestDigest: 'b'.repeat(64) };
    await expect(resolver.resolve(request)).rejects.toThrow('public-discovery-invocation-budget');
    await expect(resolver.resolve(request)).rejects.toBeInstanceOf(FavoriteProviderRetryError);
    expect(provider.search).not.toHaveBeenCalled();
    expect(provider.hydrate).not.toHaveBeenCalled();
  });

  it('bounds greedy pagination under 50 calls and terminalizes an over-budget first work after eight attempts', async () => {
    const runtime = await env.PUBLIC_DB.prepare(`SELECT provider, next_allowed_at AS nextAllowed, active_until AS activeUntil,
      consecutive_failures AS failures, circuit_open_until AS circuitOpen, updated_at AS updated
      FROM public_discovery_provider_runtime`).all<{
        provider: string; nextAllowed: number; activeUntil: number; failures: number; circuitOpen: number; updated: string;
      }>();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
    const discoveryKey = { ...key('b'), fingerprint: 'b0d6e7'.padStart(64, '0'), mediaKind: 'UNKNOWN' as const };
    const titles = ['Absent Alpha', 'Absent Bravo', 'Absent Charlie', 'Absent Delta'];
    const port = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = new URL(String(input));
      vi.setSystemTime(Date.now() + 1_001);
      if (url.hostname === 'graphql.anilist.co' || url.hostname === 'api.mangaupdates.com') return Response.json({}, { status: 503 });
      expect(url.hostname).toBe('kitsu.io');
      const offset = Number(url.searchParams.get('page[offset]'));
      const data = Array.from({ length: 20 }, (_value, index) => ({
        id: String(offset + index + 1), type: 'anime',
        attributes: { canonicalTitle: 'Completely Different Resource', abbreviatedTitles: [], slug: 'different-resource', subtype: 'TV', titles: {} },
      }));
      return Response.json({ data, links: { next: offset < 60 ? 'https://kitsu.io/next' : null }, meta: { count: 80 } });
    });
    const metrics = { backlogBytes: 0, backlogCount: 0 };
    const queue = { metrics: async () => metrics, send: vi.fn(async (_signal: NativeCollectorSignal) => ({ metadata: { metrics } })), sendBatch: vi.fn(async () => ({ metadata: { metrics } })) };
    const correlationId = '00000000-0000-4000-8000-000000000001';
    try {
      await port.request({ key: discoveryKey, query: { discoveryTitles: titles, sourceTitles: titles, mediaKind: 'UNKNOWN' }, requestDigest: 'e'.repeat(64), schemaVersion: 3 }, new Date().toISOString());
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const measured = countedD1(env.PUBLIC_DB, 50);
        const report = await processPublicDiscoveryQueue({ ...env, PUBLIC_DB: measured.database, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_TRANSPORT_MODE: 'direct' }, undefined, true, correlationId);
        expect(report).toMatchObject({ claimed: 1, failed: 1, deferred: 0, published: 0, continuationScheduled: true });
        expect(measured.calls()).toBeLessThanOrEqual(50);
        expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts, result_json AS result FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
          .bind(discoveryKey.fingerprint).first()).toEqual({ state: 'PROCESSING', attempts: attempt, result: null });
        vi.setSystemTime(Date.now() + 16 * 60_000);
      }
      expect(queue.send).toHaveBeenCalledTimes(8);
      expect(queue.send.mock.calls.every(([signal]) => signal.type === 'public-discovery-ready'
        && signal.correlationId === correlationId && signal.continuationToken?.length === 43)).toBe(true);
      const measured = countedD1(env.PUBLIC_DB, 50);
      expect(await processPublicDiscoveryQueue({ ...env, PUBLIC_DB: measured.database, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_TRANSPORT_MODE: 'direct' }))
        .toMatchObject({ claimed: 0, continuationScheduled: false });
      expect(measured.calls()).toBeLessThanOrEqual(50);
      await expect(port.read(discoveryKey, new Date().toISOString())).resolves.toEqual({ state: 'UNAVAILABLE', reason: 'ATTEMPT_LIMIT' });
      expect(queue.send).toHaveBeenCalledTimes(8);
      expect(provider).toHaveBeenCalledTimes(8 * 18);
      expect(warn.mock.calls).toEqual(Array.from({ length: 8 }, () => ['public-discovery-provider-failed', 'public-discovery-invocation-budget']));
    } finally {
      provider.mockRestore(); warn.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.batch(runtime.results.map(row => env.PUBLIC_DB.prepare(`UPDATE public_discovery_provider_runtime
        SET next_allowed_at = ?1, active_until = ?2, consecutive_failures = ?3, circuit_open_until = ?4, updated_at = ?5 WHERE provider = ?6`)
        .bind(row.nextAllowed, row.activeUntil, row.failures, row.circuitOpen, row.updated, row.provider)));
    }
  });

  it.each([false, true])('retains a late port reservation until settlement and closes its old resolver (settled first: %s)', async (settledFirst) => {
    vi.useFakeTimers();
    let used = 25;
    let settlePort: (envelope: ProviderCandidateEnvelope) => void;
    const pending = new Promise<ProviderCandidateEnvelope>(resolve => { settlePort = resolve; });
    const candidate = { externalId: '919191', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic late budget'] };
    const provider: FavoriteProviderPort = { search: vi.fn(() => pending), hydrate: vi.fn(async () => candidate) };
    const providers = { anilist: provider, mangaupdates: provider, mangadex: provider, 'kitsu-anime': provider, 'kitsu-manga': provider };
    const resolver = createBudgetedDiscoveryResolver(providers, () => used, () => 5, 10);
    const request = { ...submission('1', 'Synthetic late budget'), attempt: 1, requestDigest: 'a'.repeat(64) };
    const settle = async () => {
      settlePort({ candidates: [candidate], complete: true, digest: 'synthetic-late-budget', provider: 'anilist', truncated: false });
      await vi.advanceTimersByTimeAsync(0);
    };
    try {
      const first = expect(resolver.resolve(request)).rejects.toBeInstanceOf(FavoriteProviderRetryError);
      await vi.advanceTimersByTimeAsync(10);
      await first;
      used = 29;
      if (settledFirst) await settle();
      const next = resolver.resolve({ ...request, query: { ...request.query, explicitProviderReference: { provider: 'anilist', externalId: candidate.externalId } } });
      if (settledFirst) await expect(next).resolves.toMatchObject({ state: 'VERIFIED' });
      else await expect(next).rejects.toBeInstanceOf(FavoriteProviderRetryError);
      await settle();
      expect(provider.search).toHaveBeenCalledOnce();
      expect(provider.hydrate).toHaveBeenCalledTimes(settledFirst ? 1 : 0);
    } finally { await settle(); vi.useRealTimers(); }
  });

  it.each([1_000, 50, 21])('preserves real Queue progress under a D1 binding cap of %i', async (bindingCap) => {
    const port = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const scenario = bindingCap === 1_000 ? 0 : bindingCap === 50 ? 1 : 2;
    const count = bindingCap === 21 ? 2 : 5;
    const markers = Array.from({ length: count }, (_value, index) => (100 + index + 5 * scenario).toString(16).padStart(64, '0'));
    const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].slice(0, count).map(name => `Synthetic ${['Baseline', 'Capped', 'Failure'][scenario]} Budget ${name}`);
    const media = titles.map((title, index) => ({
      id: index + 1 + 5 * scenario, type: 'ANIME', format: 'TV', genres: [], synonyms: [], siteUrl: `https://anilist.co/anime/${index + 1 + 5 * scenario}`,
      title: { romaji: title, english: title, native: null }, coverImage: { extraLarge: null, large: null, medium: null },
    }));
    const runtime = await env.PUBLIC_DB.prepare(`SELECT next_allowed_at AS nextAllowed, active_until AS activeUntil,
      consecutive_failures AS failures, circuit_open_until AS circuitOpen, updated_at AS updated
      FROM public_discovery_provider_runtime WHERE provider = 'anilist'`).first<{
        nextAllowed: number; activeUntil: number; failures: number; circuitOpen: number; updated: string;
      }>();
    expect(runtime).not.toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 1 + scenario)));
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://graphql.anilist.co');
      const request = JSON.parse(String(init?.body));
      const candidate = media.find(value => request.variables.search === value.title.romaji || request.variables.id === value.id);
      expect(candidate).toBeDefined();
      // Advance only the fixture clock; preserve the real D1 cadence gate.
      vi.setSystemTime(Date.now() + 3_001);
      return Response.json({ data: request.query.includes('FavoriteSearch')
        ? { Page: { pageInfo: { hasNextPage: false }, media: [candidate] } } : { Media: candidate } });
    });
    try {
      for (const [index, title] of titles.entries()) {
        const request = submission('1', title);
        request.key.fingerprint = markers[index]!;
        await port.request({ ...request, requestDigest: markers[index]! }, new Date().toISOString());
      }
      const metrics = { backlogBytes: 0, backlogCount: 0 };
      const queue = { metrics: async () => metrics, send: vi.fn(async () => ({ metadata: { metrics } })), sendBatch: vi.fn(async () => ({ metadata: { metrics } })) };
      if (bindingCap === 21) {
        const measured = countedD1(env.PUBLIC_DB, bindingCap);
        await expect(processPublicDiscoveryQueue({ ...env, PUBLIC_DB: measured.database, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_TRANSPORT_MODE: 'direct' }))
          .resolves.toMatchObject({ claimed: 1, published: 1, metrics: { acceptedResults: 1, result: 'changed' } });
        expect(measured.calls()).toBeLessThanOrEqual(bindingCap);
        return;
      }
      let verified = 0;
      const callCounts: number[] = [];
      for (let wake = 0; wake < 10 && verified < 5; wake += 1) {
        const measured = countedD1(env.PUBLIC_DB, bindingCap);
        queue.send.mockClear();
        await processPublicDiscoveryQueue({ ...env, PUBLIC_DB: measured.database, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_TRANSPORT_MODE: 'direct' });
        callCounts.push(measured.calls());
        expect(measured.calls()).toBeLessThanOrEqual(50);
        const states = await env.PUBLIC_DB.prepare('SELECT state, claim_token_hash AS claim, attempt_count AS attempts FROM public_discovery_requests_v3 WHERE fingerprint IN (?1, ?2, ?3, ?4, ?5)')
          .bind(...markers).all<{ state: string; claim: string | null; attempts: number }>();
        expect(states.results).toHaveLength(5);
        expect(states.results.every(row => row.state === 'VERIFIED' || (row.state === 'PENDING' && row.claim === null))).toBe(true);
        expect(states.results.every(row => row.attempts <= 1)).toBe(true);
        verified = states.results.filter(row => row.state === 'VERIFIED').length;
        if (verified < 5) expect(queue.send).toHaveBeenCalledOnce();
        vi.setSystemTime(Date.now() + 3_001);
      }
      expect(verified).toBe(5);
      expect(callCounts).toHaveLength(5);
      expect(callCounts.every(calls => calls <= 50)).toBe(true);
      expect(provider).toHaveBeenCalledTimes(10);
      console.info(JSON.stringify({ type: 'local-discovery-invocation-budget', bindingCap, d1Calls: callCounts, providerCalls: provider.mock.calls.length }));
    } finally {
      provider.mockRestore(); vi.useRealTimers();
      await env.PUBLIC_DB.prepare(`UPDATE public_discovery_provider_runtime SET next_allowed_at = ?1,
        active_until = ?2, consecutive_failures = ?3, circuit_open_until = ?4, updated_at = ?5 WHERE provider = 'anilist'`)
        .bind(runtime!.nextAllowed, runtime!.activeUntil, runtime!.failures, runtime!.circuitOpen, runtime!.updated).run();
    }
  });

  it('requeues a cadence-deferred claim at its deadline without using a provider attempt', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const request = { ...submission('c', 'Cadence deferred work'), requestDigest: 'd'.repeat(64) };
    const now = '2026-09-20T12:00:00.000Z';
    await adapter.request(request, now);
    const claim = await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'b'.repeat(64), now, leaseUntil: '2026-09-20T12:15:00.000Z', limit: 1 });
    expect(claim.requests).toHaveLength(1);
    await adapter.deferClaim(claim.requests[0]!, 'b'.repeat(64), '2026-09-20T12:00:08.000Z', now);
    expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempts, claim_token_hash AS claim FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(request.key.fingerprint).first()).toEqual({ state: 'PENDING', attempts: 0, claim: 'b'.repeat(64) });
    expect((await adapter.claimBatch({ claimToken: 'c'.repeat(48), tokenDigest: 'd'.repeat(64), now: '2026-09-20T12:00:07.000Z', leaseUntil: '2026-09-20T12:15:07.000Z', limit: 1 })).requests).toHaveLength(0);
    const resumed = await adapter.claimBatch({ claimToken: 'c'.repeat(48), tokenDigest: 'd'.repeat(64), now: '2026-09-20T12:00:08.000Z', leaseUntil: '2026-09-20T12:15:08.000Z', limit: 1 });
    expect(resumed.requests[0]?.attempt).toBe(1);
    await adapter.publishBatch({ claimToken: resumed.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440001', results: [{ key: request.key, requestDigest: request.requestDigest, resolution: { reason: 'synthetic-no-match', state: 'NOT_FOUND' } }], schemaVersion: 3, verifiedAt: '2026-09-20T12:00:09.000Z' }, 'd'.repeat(64), 'e'.repeat(64), '2026-09-20T12:00:09.000Z');
  });

  it('claims only the row bound to an opaque continuation token', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = '2026-09-20T12:00:00.000Z';
    const firstToken = 'a'.repeat(43);
    const secondToken = 'b'.repeat(43);
    const first = { ...submission('1', 'First queued work'), requestDigest: '1'.repeat(64) };
    const second = { ...submission('2', 'Second queued work'), requestDigest: '2'.repeat(64) };
    await adapter.request(first, now, await tokenDigest(firstToken));
    await adapter.request(second, now, await tokenDigest(secondToken));

    const claimed = await adapter.claimBatch({
      claimToken: 'c'.repeat(43),
      continuationTokenDigest: await tokenDigest(secondToken),
      leaseUntil: '2026-09-20T12:15:00.000Z',
      limit: 1,
      now,
      tokenDigest: await tokenDigest('c'.repeat(43)),
    });

    expect(claimed.requests.map(request => request.key.fingerprint)).toEqual([second.key.fingerprint]);
    expect((await adapter.claimBatch({
      claimToken: 'd'.repeat(43),
      continuationTokenDigest: await tokenDigest(secondToken),
      leaseUntil: '2026-09-20T12:15:00.000Z',
      limit: 1,
      now,
      tokenDigest: await tokenDigest('d'.repeat(43)),
    })).requests).toHaveLength(0);
    await adapter.publishBatch({
      claimToken: claimed.claimToken,
      nonce: '550e8400-e29b-41d4-a716-446655440011',
      results: [{ key: second.key, requestDigest: second.requestDigest, resolution: { reason: 'selector-test', state: 'NOT_FOUND' } }],
      schemaVersion: 3,
      verifiedAt: now,
    }, await tokenDigest('c'.repeat(43)), '3'.repeat(64), now);
    const firstClaim = await adapter.claimBatch({
      claimToken: 'e'.repeat(43), leaseUntil: '2026-09-20T12:15:00.000Z', limit: 1, now, tokenDigest: await tokenDigest('e'.repeat(43)),
    });
    await adapter.publishBatch({
      claimToken: firstClaim.claimToken,
      nonce: '550e8400-e29b-41d4-a716-446655440012',
      results: [{ key: first.key, requestDigest: first.requestDigest, resolution: { reason: 'selector-test', state: 'NOT_FOUND' } }],
      schemaVersion: 3,
      verifiedAt: now,
    }, await tokenDigest('e'.repeat(43)), '4'.repeat(64), now);
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
    const measuredDefer = countedD1(env.PUBLIC_DB, 2);
    await new D1PublicDiscoveryV3Adapter(measuredDefer.database).deferClaim(claimed.requests[0]!, 'g'.repeat(64), '2026-09-20T12:00:08.000Z', now);
    expect(measuredDefer.calls()).toBe(2);
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
    const queue = { send: vi.fn(async (_signal: NativeCollectorSignal) => undefined) };
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
      const item = { body: queue.send.mock.calls[0]![0], attempts: 1, ack: vi.fn(), retry: vi.fn() };
      await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: (correlationId, continuationToken) => processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct' }, undefined, true, correlationId, continuationToken) });
      expect(provider).toHaveBeenCalledTimes(mode === 'exact' ? 1 : 2);
      expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
      const result = await client().resolveOrRequest(discoveryKey, query);
      expect(result).toMatchObject({ state: 'VERIFIED', profile: { candidate: { externalId: '1', titles: ['Cowboy Bebop'], provider: 'anilist' } } });
      expect(queue.send).toHaveBeenCalledOnce();
    } finally { provider.mockRestore(); }
  }, 15_000);
  it('acks an empty claimed batch when continuation delivery fails', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = new Date().toISOString();
    await adapter.request({ ...submission('3', 'Synthetic leased work'), requestDigest: 'a'.repeat(64) }, now);
    const continuationToken = 'a'.repeat(43);
    await adapter.claimBatch({ claimToken: continuationToken, tokenDigest: await tokenDigest(continuationToken), now, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString(), limit: 1 });
    const metrics = { backlogBytes: 0, backlogCount: 0 };
    const queue = { metrics: async () => metrics, send: vi.fn(async (_body: NativeCollectorSignal, _options?: { contentType?: string; delaySeconds?: number }) => ({ metadata: { metrics } })), sendBatch: vi.fn(async () => ({ metadata: { metrics } })) };
    const bindings = { ...env, PUBLIC_DISCOVERY_QUEUE: queue, PROVIDER_GATEWAY_HMAC_KEY: 'x'.repeat(32) };
    expect(await processPublicDiscoveryQueue(bindings, undefined, true, undefined, continuationToken)).toMatchObject({ claimed: 0, continuationScheduled: true });
    expect(queue.send).toHaveBeenCalledOnce();
    expect(queue.send.mock.calls[0]?.[1]?.delaySeconds).toBeGreaterThan(0);
    expect(queue.send.mock.calls[0]?.[1]?.delaySeconds).toBeLessThanOrEqual(900);
    queue.send.mockRejectedValueOnce(new Error('local-queue-failure'));
    const item = { body: { type: 'public-discovery-ready', version: 1 }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: () => processPublicDiscoveryQueue(bindings) });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
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
    expect(queue.send).toHaveBeenCalledExactlyOnceWith({ continuationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u), correlationId: expect.any(String), type: 'public-discovery-ready', version: 1 });
    expect(JSON.stringify(queue.send.mock.calls)).not.toContain('Private');
  });

  it('returns 503 but preserves PENDING when the queue is unavailable', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('queue-down private title'); } } });
    const discoveryKey = key('5');
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('5', 'Queue retry')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'discovery-queue-unavailable' });
    await expect(adapter.read(discoveryKey, new Date().toISOString())).resolves.toMatchObject({ state: 'PENDING' });
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'public-discovery-queue-runtime-failed', errorType: 'error', errorDetail: 'unknown' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private title');
    const retry = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('5', 'Queue retry')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(retry.status).toBe(503);
    warn.mockRestore();
  });

  it('accepts a Queue failure when the Worker runtime starts the bounded fallback', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const queueFallback = vi.fn(async () => undefined);
    const executionCtx = createExecutionContext();
    const fallbackKey = { ...key('e'), fingerprint: `${'e'.repeat(63)}1` };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('queue runtime'); } }, queueFallback });
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ ...submission('e', 'Queue fallback'), key: fallbackKey }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    }, undefined, executionCtx);
    expect(response.status).toBe(202);
    expect(queueFallback).toHaveBeenCalledOnce();
    expect(queueFallback).toHaveBeenCalledWith(fallbackKey, expect.any(String));
    await expect(adapter.read(fallbackKey, new Date().toISOString())).resolves.toMatchObject({ state: 'PENDING' });
  });

  it('returns 503 without leaking details when the bounded fallback rejects', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallbackKey = { ...key('f'), fingerprint: `${'f'.repeat(63)}1` };
    const queueFallback = vi.fn(async () => { throw new Error('private fallback detail'); });
    try {
      const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('queue runtime'); } }, queueFallback });
      const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
        body: JSON.stringify({ ...submission('f', 'Fallback rejection'), key: fallbackKey }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'discovery-unavailable' });
      expect(queueFallback).toHaveBeenCalledExactlyOnceWith(fallbackKey, expect.any(String));
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'public-discovery-queue-fallback-failed', errorType: 'error', errorDetail: 'unknown' }));
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private fallback detail');
    } finally { warn.mockRestore(); }
  });

  it('returns 503 when the bounded fallback does not publish its exact claim', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fallbackKey = { ...key('7'), fingerprint: `${'7'.repeat(63)}1` };
    const queueFallback = vi.fn(async () => ({ claimed: 1, deferred: 0, failed: 1, published: 0, replayed: 0 }));
    try {
      const app = createPublicDiscoveryApp({ deliveryMode: 'worker-direct', publicDiscoveryV3: adapter, queueFallback });
      const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
        body: JSON.stringify({ ...submission('7', 'Incomplete fallback'), key: fallbackKey }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ error: 'discovery-unavailable' });
      expect(queueFallback).toHaveBeenCalledExactlyOnceWith(fallbackKey, expect.any(String));
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'public-discovery-queue-fallback-failed', errorType: 'error', errorDetail: 'unknown' }));
    } finally { warn.mockRestore(); }
  });

  it('accepts an incomplete fallback only when its durable continuation was scheduled', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const fallbackKey = { ...key('8'), fingerprint: `${'8'.repeat(63)}1` };
    const queueFallback = vi.fn(async () => ({ claimed: 1, continuationScheduled: true, deferred: 0, failed: 1, published: 0, replayed: 0 }));
    const app = createPublicDiscoveryApp({ deliveryMode: 'worker-direct', publicDiscoveryV3: adapter, queueFallback });
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ ...submission('8', 'Continued fallback'), key: fallbackKey }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ state: 'PENDING' });
    expect(queueFallback).toHaveBeenCalledExactlyOnceWith(fallbackKey, expect.any(String));
  });

  it('claims only the fallback admission instead of older pending requests', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = new Date().toISOString();
    const olderKey = { ...key('a'), fingerprint: `${'a'.repeat(63)}1` };
    const fallbackKey = { ...key('b'), fingerprint: `${'b'.repeat(63)}1` };
    await adapter.request({ ...submission('a', 'Older pending request'), key: olderKey, requestDigest: 'a'.repeat(64) }, now);
    await adapter.request({ ...submission('b', 'Fallback request'), key: fallbackKey, requestDigest: 'b'.repeat(64) }, now);
    const claim = await adapter.claimBatch({ claimToken: 'c'.repeat(48), key: fallbackKey, leaseUntil: new Date(Date.now() + 15 * 60_000).toISOString(), limit: 1, now, tokenDigest: 'd'.repeat(64) });
    expect(claim.requests.map((request) => request.key)).toEqual([fallbackKey]);
    await expect(adapter.read(olderKey, now)).resolves.toMatchObject({ state: 'PENDING' });
  });

  it('classifies a platform internal Queue error without emitting its message', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('Internal Server Error'); } } });
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('d', 'Queue runtime')), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(503);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'public-discovery-queue-runtime-failed', errorType: 'error', errorDetail: 'internal-error' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Internal Server Error');
    warn.mockRestore();
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

  it('accepts a delivered signal when only its D1 confirmation fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const confirm = vi.spyOn(port, 'confirmQueueSignal').mockRejectedValueOnce(new Error('D1 confirmation failed'));
    const release = vi.spyOn(port, 'releaseQueueSignal');
    const queue = { send: vi.fn(async () => undefined) };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: port, queue });
    const request = submission('f', 'Confirmation fixture');
    request.key.fingerprint = crypto.randomUUID().replaceAll('-', '').repeat(2);
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(request),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    await expect(response.clone().json()).resolves.toMatchObject({ state: 'PENDING' });
    expect(response.status).toBe(202);
    expect(queue.send).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.health', code: 'public-discovery-queue-confirm-failed', errorType: 'none' }));
    warn.mockRestore();
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
