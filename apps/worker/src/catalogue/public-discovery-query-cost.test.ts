import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { favoriteTitlePreparationVersion } from '@tobirink/application';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { processPublicDiscoveryQueue } from '../native-collectors';
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
  it.each(['token', 'key'] as const)('bounds a %s claim independently of unrelated active requests', async (selection) => {
    await env.PUBLIC_DB.prepare(`WITH RECURSIVE fixture(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 128
      ) INSERT INTO public_discovery_requests_v3(
        fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
        state, retry_at, created_at, updated_at)
      SELECT printf('%064x', 300000 + n), 'ANIME', '5', '3', printf('%064x', n), '{}',
        'PENDING', ?1, ?1, ?1 FROM fixture`).bind(future).run();
    const key = { fingerprint: fingerprint(300200), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    const token = '9'.repeat(64);
    await new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).request({ key, requestDigest: '8'.repeat(64), schemaVersion: 3,
      query: { discoveryTitles: ['Bounded continuation'], sourceTitles: [], mediaKind: 'ANIME' },
    }, now, token);
    try {
      const measured = instrumentD1(env.PUBLIC_DB);
      const adapter = new D1PublicDiscoveryV3Adapter(measured.database);
      expect(await adapter.nextPendingAt(token)).toBe(now);
      const claimed = await adapter.claimBatch({ claimToken: '7'.repeat(48), tokenDigest: '6'.repeat(64),
        ...(selection === 'token' ? { continuationTokenDigest: token } : { key }), now, leaseUntil, limit: 1 });
      expect(claimed.requests.map(request => request.key)).toEqual([key]);
      expect(await adapter.nextPendingAt(token)).toBeUndefined();
      expect(await adapter.nextPendingAt('6'.repeat(64))).toBe(leaseUntil);
      const replay = await adapter.claimBatch({ claimToken: '5'.repeat(48), tokenDigest: '4'.repeat(64),
        continuationTokenDigest: token, key, now, leaseUntil, limit: 1 });
      expect(replay.requests).toEqual([]);
      expect(await adapter.nextPendingAt('6'.repeat(64))).toBe(leaseUntil);
      const cost = measured.snapshot();
      console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'owned-continuation', selection, ...cost }));
      expect(cost.rowsRead).toBeLessThanOrEqual(60);
    } finally {
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint BETWEEN ?1 AND ?2')
        .bind(fingerprint(300001), fingerprint(300200)).run();
    }
  });

  it('publishes distinct verified identities sharing only an alternate title', async () => {
    const first = await claimedPublication(200040, ['First distinct identity', 'Shared alternate title']);
    const second = await claimedPublication(200041, ['Second distinct identity', 'Shared alternate title']);
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    await expect(adapter.publishBatch(first, 'c'.repeat(64), 'e'.repeat(64), now)).resolves.toEqual({ published: 1, replayed: 0 });
    await expect(adapter.publishBatch(second, 'c'.repeat(64), 'e'.repeat(64), now)).resolves.toEqual({ published: 1, replayed: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_works WHERE work_id IN (?1, ?2)')
      .bind('work_publication_cost_200040', 'work_publication_cost_200041').first()).toEqual({ count: 2 });
    expect(await env.PUBLIC_DB.prepare('SELECT ambiguous FROM catalogue_canonical_titles_v1 WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3')
      .bind(favoriteTitlePreparationVersion, 'shared alternate title', 'anime').first()).toEqual({ ambiguous: 1 });
    const replay = instrumentD1(env.PUBLIC_DB);
    expect(await new D1PublicDiscoveryV3Adapter(replay.database).publishBatch(second, 'c'.repeat(64), 'e'.repeat(64), now))
      .toEqual({ published: 0, replayed: 1 });
    expect(replay.snapshot().rowsWritten).toBe(0);
    expect(await env.PUBLIC_DB.prepare('SELECT work_id FROM catalogue_canonical_titles_v1 WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3 AND ambiguous = 0 LIMIT 1')
      .bind(favoriteTitlePreparationVersion, 'shared alternate title', 'anime').first()).toBeNull();
  });

  it('leaves admission headroom when publishing all thirty-two provider titles', async () => {
    const titles = Array.from({ length: 32 }, (_, index) => `Rich publication alias ${index}`);
    const batch = await claimedPublication(200032, titles);
    const measured = instrumentD1(env.PUBLIC_DB);
    expect(await new D1PublicDiscoveryV3Adapter(measured.database).publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now))
      .toEqual({ published: 1, replayed: 0 });
    const cost = measured.snapshot();
    console.info(JSON.stringify({ type: 'local-discovery-query-cost', scenario: 'thirty-two-titles', ...cost }));
    expect(cost.rowsRead).toBeLessThanOrEqual(220);
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_titles WHERE work_id = ?1')
      .bind('work_publication_cost_200032').first()).toEqual({ count: 32 });
  });
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

  it('rolls back the terminal transition and catalogue when the transaction fails', async () => {
    const existing = await claimedPublication(200043, ['Earlier rollback identity', 'Atomic rollback publication']);
    await new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).publishBatch(existing, 'c'.repeat(64), 'e'.repeat(64), now);
    const batch = await claimedPublication(200033, ['Atomic rollback publication']);
    const execute = env.PUBLIC_DB.batch.bind(env.PUBLIC_DB);
    const transaction = vi.spyOn(env.PUBLIC_DB, 'batch').mockImplementation(statements => execute([
      ...statements, env.PUBLIC_DB.prepare("SELECT json('invalid-publication-test')"),
    ]));
    try {
      await expect(new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now)).rejects.toThrow();
    } finally { transaction.mockRestore(); }
    expect(await env.PUBLIC_DB.prepare('SELECT state, claim_token_hash AS token, lease_until AS lease FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(fingerprint(200033)).first()).toEqual({ state: 'PROCESSING', token: 'c'.repeat(64), lease: leaseUntil });
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_works WHERE work_id = ?1')
      .bind('work_publication_cost_200033').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT ambiguous FROM catalogue_canonical_titles_v1 WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3')
      .bind(favoriteTitlePreparationVersion, 'atomic rollback publication', 'anime').first()).toEqual({ ambiguous: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_titles WHERE work_id = ?1')
      .bind('work_publication_cost_200033').first()).toEqual({ count: 0 });
  });

  it('marks a title shared by concurrent verified publishers without merging their identities', async () => {
    const first = await claimedPublication(200034, ['Concurrent guarded publication']);
    const second = await claimedPublication(200035, ['Concurrent guarded publication']);
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const results = await Promise.allSettled([first, second].map(batch => adapter.publishBatch(batch, 'c'.repeat(64), 'e'.repeat(64), now)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_works WHERE work_id IN (?1, ?2)')
      .bind('work_publication_cost_200034', 'work_publication_cost_200035').first()).toEqual({ count: 2 });
    expect(await env.PUBLIC_DB.prepare("SELECT count(*) AS count FROM public_discovery_requests_v3 WHERE fingerprint IN (?1, ?2) AND state = 'VERIFIED' AND claim_token_hash IS NULL AND lease_until IS NULL")
      .bind(fingerprint(200034), fingerprint(200035)).first()).toEqual({ count: 2 });
    expect(await env.PUBLIC_DB.prepare('SELECT ambiguous FROM catalogue_canonical_titles_v1 WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3')
      .bind(favoriteTitlePreparationVersion, 'concurrent guarded publication', 'anime').first()).toEqual({ ambiguous: 1 });
  });

  it('does not scan global pending work after an exact terminal publication', async () => {
    const key = { fingerprint: 'e'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    const unrelatedFingerprint = 'a'.repeat(64);
    await env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v3(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, claim_token_hash, lease_until, attempt_count, retry_at, created_at, updated_at)
      VALUES (?1, 'ANIME', '5', '3', ?2, '{}', 'PROCESSING', ?3, ?4, 8, ?4, ?4, ?4)`)
      .bind(unrelatedFingerprint, 'a'.repeat(64), 'b'.repeat(64), expired).run();
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    await adapter.request({
      key,
      query: {
        discoveryTitles: ['Bounded terminal publication'],
        explicitProviderReference: { externalId: '900001', provider: 'anilist' },
        mediaKind: 'ANIME',
        sourceTitles: ['Bounded terminal publication'],
      },
      requestDigest: 'f'.repeat(64),
      schemaVersion: 3,
    }, now);
    const provider = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: { Media: {
      coverImage: { extraLarge: null, large: null, medium: null }, format: 'TV', genres: [], id: 900001,
      siteUrl: 'https://anilist.co/anime/900001', synonyms: [], title: { english: null, native: null, romaji: 'Bounded terminal publication' }, type: 'ANIME',
    } } }));
    const metrics = { backlogBytes: 0, backlogCount: 0 };
    const queue = {
      metrics: async () => metrics,
      send: vi.fn(async () => ({ metadata: { metrics } })),
      sendBatch: vi.fn(async () => ({ metadata: { metrics } })),
    };
    try {
      const report = await processPublicDiscoveryQueue({ ...env, PROVIDER_TRANSPORT_MODE: 'direct', PUBLIC_DISCOVERY_QUEUE: queue }, key);
      expect(report).toMatchObject({ claimed: 1, continuationScheduled: false, failed: 0, published: 1 });
      expect(report.metrics?.rowsRead).toBeLessThanOrEqual(300);
      expect(queue.send).not.toHaveBeenCalled();
      expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
        .bind(unrelatedFingerprint).first()).toEqual({ state: 'PROCESSING' });
    } finally {
      provider.mockRestore();
      await env.PUBLIC_DB.prepare('DELETE FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(unrelatedFingerprint).run();
    }
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
    await env.PUBLIC_DB.exec('ANALYZE');
    await env.PUBLIC_DB.prepare("UPDATE sqlite_stat1 SET stat = '1 1 1 1' WHERE tbl = 'catalogue_canonical_titles_v1'").run();
    await env.PUBLIC_DB.exec('ANALYZE sqlite_schema');
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
    expect(externalReferenceGuards).toHaveLength(1);
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
    const publicationSql = statements.mock.calls.find(([sql]) => sql.includes('state = ?, result_json = ?'))?.[0];
    if (publicationSql === undefined) throw new Error('Publication transition guard must be exercised.');
    expect(publicationSql).not.toContain('catalogue_canonical_titles_v1');
    const ambiguitySql = statements.mock.calls.find(([sql]) => sql.startsWith('UPDATE catalogue_canonical_titles_v1 INDEXED BY'))?.[0];
    if (ambiguitySql === undefined) throw new Error('Title ambiguity marker must be exercised.');
    const explainAmbiguity = `EXPLAIN QUERY PLAN UPDATE catalogue_canonical_titles_v1 INDEXED BY sqlite_autoindex_catalogue_canonical_titles_v1_1 SET ambiguous = 1
        WHERE normalization_version = ?1 AND media_kind = ?2 AND work_id <> ?3 AND ambiguous = 0
          AND normalized_title IN (SELECT value FROM json_each(?4))
          AND EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
            fingerprint = ?5 AND media_kind = ?6 AND parser_version = ?7 AND rules_version = ?8
            AND state = 'VERIFIED' AND refresh_state = 'IDLE'
            AND claim_token_hash = ?9 AND request_digest = ?10 AND lease_until > ?11)`;
    expect(ambiguitySql.replace(/\s+/gu, ' ')).toBe(explainAmbiguity.slice('EXPLAIN QUERY PLAN '.length).replace(/\s+/gu, ' '));
    const plan = await env.PUBLIC_DB.prepare(explainAmbiguity)
      .bind(favoriteTitlePreparationVersion, 'anime', 'work_publication_cost_200001',
        JSON.stringify(['fresh alpha', 'fresh beta', 'fresh gamma', 'fresh delta']),
        fingerprint(200001), 'ANIME', '5', '3', 'c'.repeat(64), 'd'.repeat(64), now)
      .all<{ detail: string }>();
    expect(plan.results.some(({ detail }) => detail.includes('normalization_version=? AND normalized_title=? AND media_kind=?'))).toBe(true);
    const titleGuardPlan = await env.PUBLIC_DB.prepare(`EXPLAIN QUERY PLAN SELECT 1
      FROM catalogue_canonical_titles_v1
      WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3 AND work_id <> ?4`)
      .bind(favoriteTitlePreparationVersion, 'fresh alpha', 'anime', 'work_publication_cost_200001').all<{ detail: string }>();
    console.info(JSON.stringify({ type: 'local-discovery-query-plan', scenario: 'canonical-title-index', details: titleGuardPlan.results.map(({ detail }) => detail) }));
    expect(titleGuardPlan.results.some(({ detail }) => detail.includes('sqlite_autoindex_catalogue_canonical_titles_v1_1'))).toBe(true);
    console.info(JSON.stringify({ type: 'local-discovery-query-plan', scenario: 'canonical-ambiguity-marker', details: plan.results.map(({ detail }) => detail) }));
    expect(await env.PUBLIC_DB.prepare('SELECT count(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind('work_publication_cost_200001').first())
      .toEqual({ count: 4 });
  });

  it('rejects an exact provider reference conflict without any catalogue or terminal write at bounded cost', async () => {
    const batch = await claimedPublication(200002, ['Fresh conflict-free alias', 'synthetic catalogue 582 alias 4']);
    batch.results[0]!.resolution.profile.references = [{ provider: 'anilist', externalId: 'work_cost_1' }];
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
