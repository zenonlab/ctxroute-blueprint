import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { favoriteTitlePreparationVersion } from '@tobirink/application';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
  await env.PUBLIC_DB.prepare('INSERT INTO catalogue_revisions(revision, published_at) VALUES (1, ?1)').bind(expired).run();
  await env.PUBLIC_DB.prepare(`WITH RECURSIVE fixture(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 582
    ) INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision)
    SELECT 'work_cost_' || n, 'anime', 'Synthetic catalogue ' || n, 1 FROM fixture`).run();
  await env.PUBLIC_DB.prepare(`INSERT INTO catalogue_canonical_titles_v1(
      normalization_version, normalized_title, media_kind, work_id, created_at)
    SELECT ?1, 'synthetic catalogue ' || substr(work_id, 11) || ' alias ' || proposed.value, 'anime', work_id, ?2
    FROM catalogue_works CROSS JOIN json_each('[1,2,3,4]') AS proposed`)
    .bind(favoriteTitlePreparationVersion, expired).run();
  await env.PUBLIC_DB.prepare(`INSERT INTO catalogue_external_references(provider, external_id, work_id)
    SELECT 'anilist', work_id, work_id FROM catalogue_works`).run();
});

async function claimedPublication(id: number, titles: string[]) {
  const key = { fingerprint: fingerprint(id), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
  const requestDigest = 'd'.repeat(64);
  await env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v3(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, claim_token_hash, lease_until, attempt_count, retry_at, created_at, updated_at)
    VALUES (?1, 'ANIME', '5', '3', ?2, '{}', 'PROCESSING', ?3, ?4, 1, ?5, ?5, ?5)`)
    .bind(key.fingerprint, requestDigest, 'c'.repeat(64), leaseUntil, now).run();
  return {
    claimToken: 'c'.repeat(48), nonce: crypto.randomUUID(), schemaVersion: 3 as const, verifiedAt: now,
    results: [{ key, requestDigest, resolution: { state: 'VERIFIED' as const, profile: {
      workId: `work_publication_cost_${id}`,
      candidate: { displayTitle: titles[0], externalId: `publication-${id}`, mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles },
      references: [{ provider: 'anilist' as const, externalId: `publication-${id}` }],
    } } }],
  };
}

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

  it('uses the named four-key identity index for grouped lookups', async () => {
    const key = { fingerprint: fingerprint(100001), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    const measured = instrumentD1(env.PUBLIC_DB);
    const adapter = new D1PublicDiscoveryV3Adapter(measured.database);
    await expect(adapter.readMany?.([key], now)).resolves.toMatchObject([{ key, state: { state: 'NOT_FOUND' } }]);
    const plan = await env.PUBLIC_DB.prepare(`EXPLAIN QUERY PLAN WITH requested AS (
        SELECT json_extract(value, '$.fingerprint') AS fingerprint,
          json_extract(value, '$.mediaKind') AS mediaKind,
          json_extract(value, '$.parserVersion') AS parserVersion,
          json_extract(value, '$.siteRulesVersion') AS rulesVersion
        FROM json_each(?1)
      )
      SELECT requested.fingerprint, r.request_digest
      FROM requested
      LEFT JOIN public_discovery_requests_v3 AS r INDEXED BY sqlite_autoindex_public_discovery_requests_v3_1
        ON r.fingerprint = requested.fingerprint AND r.media_kind = requested.mediaKind
        AND r.parser_version = requested.parserVersion AND r.rules_version = requested.rulesVersion`).bind(JSON.stringify([key])).all<{ detail: string }>();
    console.info(JSON.stringify({ type: 'local-discovery-query-plan', scenario: 'grouped-lookup-identity-index', details: plan.results.map(({ detail }) => detail), ...measured.snapshot() }));
    expect(plan.results.some(({ detail }) => detail.includes('sqlite_autoindex_public_discovery_requests_v3_1'))).toBe(true);
    expect(measured.snapshot().rowsRead).toBeLessThan(16);
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

  it('bounds publication and replay reads by proposed titles rather than catalogue size', async () => {
    const batch = await claimedPublication(200001, ['Fresh alpha', 'Fresh beta', 'Fresh gamma', 'Fresh delta']);
    const measured = instrumentD1(env.PUBLIC_DB);
    const statements = vi.spyOn(measured.database, 'prepare');
    const adapter = new D1PublicDiscoveryV3Adapter(measured.database);
    expect(await adapter.publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now)).toEqual({ published: 1, replayed: 0 });
    const publication = measured.snapshot();
    const replayMeasured = instrumentD1(env.PUBLIC_DB);
    expect(await new D1PublicDiscoveryV3Adapter(replayMeasured.database).publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now))
      .toEqual({ published: 0, replayed: 1 });
    const replay = replayMeasured.snapshot();
    console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'publication-and-replay', catalogueWorks: 582, canonicalTitles: 2328, externalReferences: 582, publication, replay }));
    expect(publication.rowsRead).toBeLessThanOrEqual(300);
    expect(replay.rowsRead).toBeLessThan(100);
    expect(replay.rowsWritten).toBe(0);
    const externalReferenceGuards = statements.mock.calls.map(([sql]) => sql)
      .filter(sql => sql.includes('CROSS JOIN catalogue_external_references AS existing INDEXED BY sqlite_autoindex_catalogue_external_references_1'));
    expect(externalReferenceGuards).toHaveLength(7);
    expect(statements.mock.calls.map(([sql]) => sql).join('\n')).not.toContain('FROM catalogue_external_references AS existing');
    const externalGuardPlan = await env.PUBLIC_DB.prepare(`EXPLAIN QUERY PLAN SELECT 1 WHERE NOT EXISTS (
      SELECT 1 FROM json_each(?1) AS proposed
      CROSS JOIN catalogue_external_references AS existing INDEXED BY sqlite_autoindex_catalogue_external_references_1
        ON existing.provider = json_extract(proposed.value, '$.provider')
        AND existing.external_id = json_extract(proposed.value, '$.externalId')
      WHERE existing.work_id <> ?2)`).bind(
      JSON.stringify([{ provider: 'anilist', externalId: 'publication-200001' }]),
      'work_publication_cost_200001',
    ).all<{ detail: string }>();
    const externalPlanDetails = externalGuardPlan.results.map(({ detail }) => detail);
    const proposedLoop = externalPlanDetails.findIndex(detail => detail.includes('SCAN proposed VIRTUAL TABLE'));
    const referenceLookup = externalPlanDetails.findIndex(detail => detail.includes('sqlite_autoindex_catalogue_external_references_1 (provider=? AND external_id=?)'));
    expect(proposedLoop).toBeGreaterThanOrEqual(0);
    expect(referenceLookup).toBeGreaterThan(proposedLoop);
    const publicationSql = statements.mock.calls.find(([sql]) => sql.startsWith('INSERT OR IGNORE INTO catalogue_titles('))?.[0];
    if (publicationSql === undefined) throw new Error('Publication title guard must be exercised.');
    const canonicalGuard = publicationSql.slice(publicationSql.lastIndexOf('AND NOT EXISTS') + 4);
    const explainGuard = `EXPLAIN QUERY PLAN SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM json_each(?) AS proposed
      CROSS JOIN catalogue_canonical_titles_v1 AS existing INDEXED BY sqlite_autoindex_catalogue_canonical_titles_v1_1 ON existing.normalized_title = proposed.value
      WHERE existing.normalization_version = ? AND existing.media_kind = ? AND existing.work_id <> ?)`;
    expect(canonicalGuard.replace(/\s+/gu, ' ')).toBe(explainGuard.slice('EXPLAIN QUERY PLAN SELECT 1 WHERE '.length).replace(/\s+/gu, ' '));
    const plan = await env.PUBLIC_DB.prepare(explainGuard)
      .bind(JSON.stringify(['fresh alpha', 'fresh beta', 'fresh gamma', 'fresh delta']), favoriteTitlePreparationVersion, 'anime', 'work_publication_cost_200001')
      .all<{ detail: string }>();
    expect(plan.results.some(({ detail }) => detail.includes('normalization_version=? AND normalized_title=? AND media_kind=?'))).toBe(true);
    const titleGuardPlan = await env.PUBLIC_DB.prepare(`EXPLAIN QUERY PLAN SELECT 1
      FROM catalogue_canonical_titles_v1
      WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3 AND work_id <> ?4`)
      .bind(favoriteTitlePreparationVersion, 'fresh alpha', 'anime', 'work_publication_cost_200001').all<{ detail: string }>();
    console.info(JSON.stringify({ type: 'local-discovery-query-plan', scenario: 'canonical-title-index', details: titleGuardPlan.results.map(({ detail }) => detail) }));
    expect(titleGuardPlan.results.some(({ detail }) => detail.includes('sqlite_autoindex_catalogue_canonical_titles_v1_1'))).toBe(true);
    console.info(JSON.stringify({ type: 'local-discovery-query-plan', scenario: 'canonical-publication-guard', details: plan.results.map(({ detail }) => detail) }));
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind('work_publication_cost_200001').first())
      .toEqual({ count: 4 });
  });

  it('rejects a canonical conflict without any catalogue or terminal write at bounded cost', async () => {
    const batch = await claimedPublication(200002, ['Fresh conflict-free alias', 'synthetic catalogue 582 alias 4']);
    const measured = instrumentD1(env.PUBLIC_DB);
    await expect(new D1PublicDiscoveryV3Adapter(measured.database).publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now))
      .rejects.toThrow('stale-public-discovery-result');
    const cost = measured.snapshot();
    console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'publication-conflict', catalogueWorks: 582, canonicalTitles: 2328, ...cost }));
    expect(cost.rowsWritten).toBe(0);
    expect(cost.rowsRead).toBeLessThan(400);
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_works WHERE work_id = ?1').bind('work_publication_cost_200002').first())
      .toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(fingerprint(200002)).first())
      .toEqual({ state: 'PROCESSING' });
  });
});
