import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { beforeAll, describe, expect, it } from 'vitest';
import { instrumentD1 } from '../operational-metrics';

const now = '2026-09-23T12:00:00.000Z';
const expired = '2026-09-23T11:00:00.000Z';
const leaseUntil = '2026-09-23T12:15:00.000Z';
const future = '2026-09-23T13:00:00.000Z';
const fingerprint = (id: number) => id.toString(16).padStart(64, '0');

beforeAll(async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
  await env.PUBLIC_DB.prepare(`WITH RECURSIVE fixture(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 1024
    ) INSERT INTO public_discovery_requests_v3(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, result_json, retry_at, verified_at, created_at, updated_at, result_expires_at)
    SELECT printf('%064x', 100000 + n), 'ANIME', '5', '3', printf('%064x', n), '{}',
      'NOT_FOUND', '{"reason":"synthetic-terminal","state":"NOT_FOUND"}', ?1, ?1, ?1, ?1, ?2
    FROM fixture`).bind(expired, future).run();
});

describe('public discovery indexed query cost', () => {
  it('does not scan terminal history during an empty Queue wake', async () => {
    const measured = instrumentD1(env.PUBLIC_DB);
    const adapter = new D1PublicDiscoveryV3Adapter(measured.database);
    expect((await adapter.claimBatch({ claimToken: 'a'.repeat(48), tokenDigest: 'a'.repeat(64), now, leaseUntil, limit: 5 })).requests).toEqual([]);
    expect(await adapter.nextPendingAt()).toBeUndefined();
    const cost = measured.snapshot();
    console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'empty-wake', terminalRows: 1024, ...cost }));
    expect(cost.rowsWritten).toBe(0);
    expect(cost.rowsRead).toBeLessThan(32);
  });

  it('preserves priority, concurrent leases and refreshes without reading terminal history', async () => {
    const seeds = [
      { id: 1, priority: 2, state: 'PENDING', updated: '2026-09-23T10:01:00.000Z' },
      { id: 2, priority: 1, state: 'PENDING', updated: '2026-09-23T10:02:00.000Z' },
      { id: 3, priority: 1, state: 'VERIFIED', refresh: 'PENDING', updated: '2026-09-23T10:01:00.000Z' },
      { id: 4, priority: 3, state: 'PROCESSING', attempt: 2, lease: expired },
      { id: 5, priority: 2, state: 'VERIFIED', refresh: 'PROCESSING', attempt: 2, lease: expired },
      { id: 6, priority: 2, state: 'PENDING', updated: '2026-09-23T10:03:00.000Z' },
      { id: 7, priority: 1, state: 'PROCESSING', attempt: 1, lease: future },
      { id: 8, priority: 1, state: 'PENDING', retryAt: future },
      { id: 9, priority: 1, state: 'PROCESSING', attempt: 8, lease: expired },
      { id: 10, priority: 1, state: 'VERIFIED', refresh: 'PROCESSING', attempt: 8, lease: expired },
    ];
    await env.PUBLIC_DB.batch(seeds.map(seed => {
      const key = { fingerprint: fingerprint(seed.id), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3' };
      const request = { key, query: { discoveryTitles: ['Synthetic query cost'], mediaKind: 'ANIME', sourceTitles: ['Synthetic query cost'] }, requestDigest: 'd'.repeat(64), schemaVersion: 3 };
      const profile = {
        candidate: { externalId: String(seed.id), mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Synthetic query cost'] },
        references: [{ externalId: String(seed.id), provider: 'anilist' }], workId: `work_query_cost_${seed.id}`,
      };
      return env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v3(
        fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
        state, refresh_state, admission_priority, attempt_count, refresh_attempt_count,
        claim_token_hash, lease_until, retry_at, created_at, updated_at, result_json, verified_at, next_refresh_at)
        VALUES (?1, 'ANIME', '5', '3', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13, ?14, ?15)`)
        .bind(key.fingerprint, request.requestDigest, seed.state === 'VERIFIED' ? '{}' : JSON.stringify(request),
          seed.state, seed.refresh ?? 'IDLE', seed.priority,
          seed.state === 'VERIFIED' ? 0 : seed.attempt ?? 0, seed.state === 'VERIFIED' ? seed.attempt ?? 0 : 0,
          seed.lease === undefined ? null : 'e'.repeat(64), seed.lease ?? null, seed.retryAt ?? seed.lease ?? expired,
          seed.updated ?? expired, seed.state === 'VERIFIED' ? JSON.stringify({ profile, state: 'VERIFIED' }) : null,
          seed.state === 'VERIFIED' ? expired : null, seed.state === 'VERIFIED' ? future : null);
    }));
    const measured = instrumentD1(env.PUBLIC_DB);
    const adapter = new D1PublicDiscoveryV3Adapter(measured.database);
    const claim = (marker: string) => adapter.claimBatch({ claimToken: marker.repeat(48), tokenDigest: marker.repeat(64), now, leaseUntil, limit: 2 });
    const first = await claim('a');
    expect(first.requests.map(request => request.key.fingerprint)).toEqual([fingerprint(2), fingerprint(3)]);
    const concurrent = await Promise.all([claim('b'), claim('c')]);
    const claimed = [...first.requests, ...concurrent.flatMap(batch => batch.requests)];
    expect(claimed).toHaveLength(6);
    expect(new Set(claimed.map(request => request.key.fingerprint)).size).toBe(6);
    expect(claimed.map(request => request.key.fingerprint).sort()).toEqual([1, 2, 3, 4, 5, 6].map(fingerprint));
    expect(claimed.find(request => request.key.fingerprint === fingerprint(4))?.attempt).toBe(3);
    expect(claimed.find(request => request.key.fingerprint === fingerprint(5))?.attempt).toBe(3);
    expect((await claim('f')).requests).toEqual([]);
    expect(await adapter.nextPendingAt()).toBe(leaseUntil);
    const cost = measured.snapshot();
    console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'four-claims-and-continuation', terminalRows: 1024, seededRequests: seeds.length, ...cost }));
    expect(cost.rowsRead).toBeLessThan(300);
    expect(await env.PUBLIC_DB.prepare('SELECT state, attempt_count AS attempt FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(fingerprint(9)).first()).toEqual({ state: 'FAILED', attempt: 8 });
    expect(await env.PUBLIC_DB.prepare('SELECT state, refresh_state AS refresh, refresh_attempt_count AS attempt FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(fingerprint(10)).first()).toEqual({ state: 'VERIFIED', refresh: 'IDLE', attempt: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT claim_token_hash AS token, lease_until AS lease FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(fingerprint(7)).first()).toEqual({ token: 'e'.repeat(64), lease: future });
    await expect(adapter.read({ fingerprint: fingerprint(3), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3' }, now))
      .resolves.toMatchObject({ state: 'VERIFIED', profile: { workId: 'work_query_cost_3' } });
  });
});
