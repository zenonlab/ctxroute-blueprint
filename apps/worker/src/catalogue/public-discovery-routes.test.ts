import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { D1ProviderRuntimeControl, D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createPublicDiscoveryApp } from './public-discovery-routes';

const discoveryKey = (marker: string) => ({ fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' });
type DiscoverySubmission = {
  key: ReturnType<typeof discoveryKey>;
  query: { discoveryTitles: string[]; mediaKind: 'ANIME'; sourceTitles: string[] };
  schemaVersion: 3;
};
const costEventSchema = z.object({
  d1RowsRead: z.number().int().nonnegative(),
  d1RowsWritten: z.number().int().nonnegative(),
  task: z.string(),
  type: z.literal('worker.cost'),
});

async function jsonDigest(value: DiscoverySubmission): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function verifiedResult(key: { fingerprint: string; mediaKind: 'ANIME' | 'MANGA' | 'MANHWA' | 'MANHUA' | 'UNKNOWN'; parserVersion: string; siteRulesVersion: string }, requestDigest: string, workMarker: string, externalId = workMarker, title = `Work ${workMarker}`) {
  return {
    key,
    requestDigest,
    resolution: {
      profile: {
        candidate: {
          displayTitle: title, externalId, mediaKind: 'ANIME' as const,
          preSerialization: false, provider: 'anilist' as const, titles: [title],
        },
        references: [{ externalId, provider: 'anilist' as const }],
        workId: `work_${workMarker}`,
      },
      state: 'VERIFIED' as const,
    },
  };
}

beforeEach(async (context) => {
  if (context.task.name === 'preserves active requests and redacts historical terminal requests during migration') return;
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
});

describe('verified public discovery cache', () => {
  it('preserves active requests and redacts historical terminal requests during migration', async () => {
    const v3AlignmentIndex = env.TEST_MIGRATIONS.findIndex(({ name }) => name === '0015_public_discovery_v3_alignment.sql');
    const minimizationIndex = env.TEST_MIGRATIONS.findIndex(({ name }) => name === '0016_public_discovery_terminal_minimization.sql');
    expect(v3AlignmentIndex).toBeGreaterThan(-1);
    expect(minimizationIndex).toBeGreaterThan(v3AlignmentIndex);
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(0, v3AlignmentIndex));
    const key = discoveryKey('0');
    const now = '2026-09-15T12:00:00.000Z';
    const preservedJson = JSON.stringify({ key, query: { discoveryTitles: ['Preserved'], mediaKind: 'ANIME', sourceTitles: ['Preserved'] }, requestDigest: '0'.repeat(64), schemaVersion: 3 });
    await env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v2(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, retry_at, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'PENDING', ?7, ?7, ?7)`)
      .bind(...Object.values(key), '0'.repeat(64), preservedJson, now).run();
    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(v3AlignmentIndex, minimizationIndex));
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PENDING' });
    await expect(env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v2 LIMIT 1').first()).rejects.toThrow();
    const requestJson = JSON.stringify({ query: { discoveryTitles: ['Historical'], sourceTitles: ['Historical'] } });
    const states = ['PROCESSING', 'FAILED', 'VERIFIED', 'NOT_FOUND', 'AMBIGUOUS'] as const;
    await env.PUBLIC_DB.batch(states.map((state, index) => env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v3(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, claim_token_hash, lease_until, attempt_count, failure_reason, failed_at,
      result_json, retry_at, verified_at, created_at, updated_at, purge_after)
      VALUES (?1, 'ANIME', '5', '3', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?11, ?11, ?13)`)
      .bind(
        String.fromCharCode(117 + index).repeat(64), String.fromCharCode(117 + index).repeat(64), requestJson, state,
        state === 'PROCESSING' ? 'c'.repeat(64) : null,
        state === 'PROCESSING' ? '2099-01-01T00:00:00.000Z' : null,
        state === 'FAILED' ? 8 : 0,
        state === 'FAILED' ? 'ATTEMPT_LIMIT' : null,
        state === 'FAILED' ? now : null,
        ['VERIFIED', 'NOT_FOUND', 'AMBIGUOUS'].includes(state) ? '{}' : null,
        now,
        ['VERIFIED', 'NOT_FOUND', 'AMBIGUOUS'].includes(state) ? now : null,
        state === 'FAILED' ? '2026-10-15T12:00:00.000Z' : null,
      )));

    await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS.slice(minimizationIndex));

    const rows = (await env.PUBLIC_DB.prepare(`SELECT state, request_json AS requestJson
      FROM public_discovery_requests_v3 WHERE fingerprint IN (?1, ?2, ?3, ?4, ?5, ?6) ORDER BY state`)
      .bind(key.fingerprint, ...states.map((_, index) => String.fromCharCode(117 + index).repeat(64))).all()).results;
    expect(rows).toEqual([
      { requestJson: '{}', state: 'AMBIGUOUS' },
      { requestJson, state: 'FAILED' },
      { requestJson: '{}', state: 'NOT_FOUND' },
      { requestJson: preservedJson, state: 'PENDING' },
      { requestJson, state: 'PROCESSING' },
      { requestJson: '{}', state: 'VERIFIED' },
    ]);
  });

  it('emits exact D1 read and write metadata for public HTTP lookups', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const key = discoveryKey('6');
      const url = new URL('https://tobirink.test/v3/catalogue/discoveries');
      for (const [name, value] of Object.entries(key)) url.searchParams.set(name, value);
      const response = await SELF.fetch(url);
      expect(response.status).toBe(200);
      const events = info.mock.calls.flatMap(([value]) => {
        const parsed = costEventSchema.safeParse(JSON.parse(String(value)));
        return parsed.success ? [parsed.data] : [];
      });
      expect(events).toContainEqual(expect.objectContaining({
        d1RowsRead: expect.any(Number), d1RowsWritten: 0, task: 'discovery-lookup', type: 'worker.cost',
      }));
      expect(events[0]?.d1RowsRead).toBeGreaterThan(0);
      expect(JSON.stringify(events)).not.toContain(key.fingerprint);
    } finally {
      info.mockRestore();
    }
  });

  it('retires both external collector routes', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter });
    const responses = await Promise.all([
      app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', { method: 'POST' }),
      app.request('https://tobirink.test/v3/catalogue/discoveries/results', { method: 'POST' }),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([410, 410]);
    await expect(Promise.all(responses.map((response) => response.json()))).resolves.toEqual([
      { error: 'external-discovery-collector-retired' }, { error: 'external-discovery-collector-retired' },
    ]);
  });

  it('stores one server-side request for repeated v3 discovery misses', async () => {
    const key = discoveryKey('e');
    const body = { key, query: { discoveryTitles: ['Frieren'], mediaKind: 'ANIME', sourceTitles: ['Sousou no Frieren'] }, schemaVersion: 3 };
    const responses = await Promise.all([1, 2].map(() => SELF.fetch('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(body), headers: { 'CF-Connecting-IP': '192.0.2.3', 'Content-Type': 'application/json' }, method: 'POST',
    })));
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      expect.objectContaining({ state: 'PENDING' }), expect.objectContaining({ state: 'PENDING' }),
    ]);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ count: 1 });
  });

  it('reads up to fifty discovery states in one public request', async () => {
    const keys = Array.from({ length: 50 }, (_, index) => ({ ...discoveryKey('8'), fingerprint: `${'8'.repeat(62)}${index.toString(16).padStart(2, '0')}` }));
    const response = await SELF.fetch('https://tobirink.test/v3/catalogue/discoveries/lookup', {
      body: JSON.stringify({ keys, schemaVersion: 3 }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(200);
    const body = await response.json<unknown[]>();
    expect(body).toHaveLength(50);
    expect(body).toEqual(keys.map((key) => ({ key, state: { state: 'MISS' } })));
    const oversized = await SELF.fetch('https://tobirink.test/v3/catalogue/discoveries/lookup', {
      body: JSON.stringify({ keys: [...keys, { ...discoveryKey('f') }], schemaVersion: 3 }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(oversized.status).toBe(400);
  });

  it('returns explicit admission outcomes and claims exact references before precise and ambiguous searches', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const now = '2026-09-16T12:00:00.000Z';
    const rankedKey = (suffix: string) => ({ ...discoveryKey('d'), fingerprint: `${'d'.repeat(63)}${suffix}` });
    const ambiguous = { key: rankedKey('1'), query: { discoveryTitles: ['Unknown'], mediaKind: 'UNKNOWN' as const, sourceTitles: ['Unknown'] }, requestDigest: '1'.repeat(64), schemaVersion: 3 as const };
    const precise = { key: rankedKey('2'), query: { discoveryTitles: ['Anime'], mediaKind: 'ANIME' as const, sourceTitles: ['Anime'] }, requestDigest: '2'.repeat(64), schemaVersion: 3 as const };
    const exact = { key: rankedKey('3'), query: { discoveryTitles: ['Exact'], explicitProviderReference: { externalId: '154587', provider: 'anilist' as const }, mediaKind: 'ANIME' as const, sourceTitles: ['Exact'] }, requestDigest: '3'.repeat(64), schemaVersion: 3 as const };

    await expect(adapter.request(ambiguous, now)).resolves.toMatchObject({ outcome: 'created', state: { state: 'PENDING' } });
    await expect(adapter.request(precise, now)).resolves.toMatchObject({ outcome: 'created' });
    await expect(adapter.request(exact, now)).resolves.toMatchObject({ outcome: 'created' });
    await expect(adapter.request(exact, now)).resolves.toMatchObject({ outcome: 'existing' });
    const claim = await adapter.claimBatch({ claimToken: 'c'.repeat(48), leaseUntil: '2026-09-16T12:15:00.000Z', limit: 50, now, tokenDigest: 'c'.repeat(64) });
    const ranked = new Set([exact.key.fingerprint, precise.key.fingerprint, ambiguous.key.fingerprint]);
    expect(claim.requests.map(({ key }) => key.fingerprint).filter((fingerprint) => ranked.has(fingerprint))).toEqual([
      exact.key.fingerprint, precise.key.fingerprint, ambiguous.key.fingerprint,
    ]);
  });

  it('serves a fresh negative cache and admits one new collection only after its explicit expiry', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const request = { key: { ...discoveryKey('d'), fingerprint: `${'d'.repeat(63)}4` }, query: { discoveryTitles: ['Missing'], mediaKind: 'ANIME' as const, sourceTitles: ['Missing'] }, requestDigest: '4'.repeat(64), schemaVersion: 3 as const };
    const verifiedAt = '2026-09-16T12:00:00.000Z';
    await adapter.request(request, verifiedAt);
    const claim = await adapter.claimBatch({ claimToken: 'n'.repeat(48), leaseUntil: '2026-09-16T12:15:00.000Z', limit: 50, now: verifiedAt, tokenDigest: 'n'.repeat(64) });
    expect(claim.requests.some(({ key }) => key.fingerprint === request.key.fingerprint)).toBe(true);
    await adapter.publishBatch({
      claimToken: claim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440001',
      results: [{ key: request.key, requestDigest: request.requestDigest, resolution: { reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' } }],
      schemaVersion: 3, verifiedAt,
    }, 'n'.repeat(64), 'd'.repeat(64), verifiedAt);

    await expect(adapter.read(request.key, '2026-09-23T11:59:59.000Z')).resolves.toMatchObject({ state: 'NOT_FOUND' });
    await expect(adapter.read(request.key, '2026-09-23T12:00:00.001Z')).resolves.toEqual({ state: 'MISS' });
    await expect(adapter.request(request, '2026-09-23T12:00:00.001Z')).resolves.toMatchObject({ outcome: 'created', state: { state: 'PENDING' } });
  });

  it('serializes provider reservations and opens the configurable D1 circuit', async () => {
    const controls = new D1ProviderRuntimeControl(env.PUBLIC_DB, 2, 10_000, 8_000);
    await expect(controls.reserve('anilist', 10_000, 3_000)).resolves.toBe(10_000);
    await expect(controls.reserve('anilist', 10_000, 3_000)).resolves.toBe(18_000);
    await controls.recordSuccess('anilist', 11_000);
    await expect(controls.reserve('anilist', 11_000, 3_000)).resolves.toBe(21_000);
    await controls.recordFailure('mangaupdates', 10_000);
    await controls.recordFailure('mangaupdates', 10_000);
    await expect(controls.reserve('mangaupdates', 10_000, 6_000)).resolves.toBe(20_000);
  });

  it('returns 503 for a new key after the global active-request ceiling while preserving replays', async () => {
    const active = await env.PUBLIC_DB.prepare(`SELECT COUNT(*) AS count FROM public_discovery_requests_v3
      WHERE state IN ('PENDING', 'PROCESSING')`).first<{ count: number }>();
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB, (active?.count ?? 0) + 2);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter });
    const submit = (marker: string) => app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key: discoveryKey(marker), query: { discoveryTitles: [`Work ${marker}`], mediaKind: 'ANIME', sourceTitles: [`Work ${marker}`] }, schemaVersion: 3 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect((await submit('a')).status).toBe(202);
    expect((await submit('b')).status).toBe(202);
    expect((await submit('a')).status).toBe(202);
    const saturated = await submit('c');
    expect(saturated.status).toBe(503);
    await expect(saturated.json()).resolves.toEqual({ error: 'discovery-capacity-unavailable' });
  });

  it('keeps the retired-route test harness capable of exercising claim and publication', async () => {
    const key = discoveryKey('f');
    const v3 = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: v3 }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Unknown Work'], mediaKind: 'ANIME', sourceTitles: ['Unknown Work'] }, schemaVersion: 3 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claimed = await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', {
      body: JSON.stringify({ limit: 20 }), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    const batch = await claimed.json<{ claimToken: string; requests: { key: typeof key; requestDigest: string }[] }>();
    const request = batch.requests.find((value) => value.key.fingerprint === key.fingerprint);
    expect(request).toBeDefined();
    const verifiedAt = new Date().toISOString();
    const result = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', {
      body: JSON.stringify({
        claimToken: batch.claimToken, nonce: crypto.randomUUID(), results: [{
          key, requestDigest: request?.requestDigest,
          resolution: { reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' },
        }], schemaVersion: 3, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ published: 1, replayed: 0 });
    expect(await v3.read(key, verifiedAt)).toMatchObject({ reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' });
  });

  it('hydrates D1 with the full verified profile and replays the same result idempotently', async () => {
    const key = discoveryKey('9');
    const v3 = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: v3 }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Frieren'], mediaKind: 'ANIME', sourceTitles: ['Frieren'] }, schemaVersion: 3 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claimed = await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', {
      body: JSON.stringify({ limit: 50 }), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claim = await claimed.json<{ claimToken: string; requests: { key: typeof key; requestDigest: string }[] }>();
    const request = claim.requests.find((value) => value.key.fingerprint === key.fingerprint);
    if (!request) throw new Error('Expected claimed v3 request.');
    const verifiedAt = new Date().toISOString();
    const payload = {
      claimToken: claim.claimToken,
      nonce: crypto.randomUUID(),
      results: [{
        key, requestDigest: request.requestDigest,
        resolution: { profile: {
          candidate: {
            cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx154587.jpg' },
            displayTitle: 'Frieren', episodeCount: 28, externalId: '154587', genres: ['Adventure'],
            mediaKind: 'ANIME', metadataVersion: 2, preSerialization: false, provider: 'anilist', titles: ['Frieren', 'Sousou no Frieren'],
          },
          references: [{ externalId: '154587', provider: 'anilist' }], workId: 'work_anilist_154587',
        }, state: 'VERIFIED' },
      }],
      schemaVersion: 3,
      verifiedAt,
    };
    const headers = { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' };
    const first = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', { body: JSON.stringify(payload), headers, method: 'POST' });
    const replay = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', { body: JSON.stringify(payload), headers, method: 'POST' });
    expect(await first.json()).toEqual({ published: 1, replayed: 0 });
    expect(await replay.json()).toEqual({ published: 0, replayed: 1 });
    await expect(v3.read(key, verifiedAt)).resolves.toMatchObject({
      profile: { candidate: { episodeCount: 28, genres: ['Adventure'], provider: 'anilist' } }, state: 'VERIFIED',
    });
    expect(await env.PUBLIC_DB.prepare('SELECT preferred_title AS title FROM catalogue_works WHERE work_id = ?1').bind('work_anilist_154587').first()).toEqual({ title: 'Frieren' });
    expect((await env.PUBLIC_DB.prepare(`SELECT normalized_title AS normalizedTitle, media_kind AS mediaKind, work_id AS workId
      FROM catalogue_canonical_titles_v1 WHERE normalization_version = ?1 ORDER BY normalized_title`)
      .bind('favorite-title-preparation-v2').all()).results).toEqual([
        { mediaKind: 'anime', normalizedTitle: 'frieren', workId: 'work_anilist_154587' },
        { mediaKind: 'anime', normalizedTitle: 'sousou no frieren', workId: 'work_anilist_154587' },
      ]);
    expect(await env.PUBLIC_DB.prepare('SELECT request_json AS requestJson FROM public_discovery_requests_v3 WHERE fingerprint = ?1')
      .bind(key.fingerprint).first()).toEqual({ requestJson: '{}' });
    const nonce = await env.PUBLIC_DB.prepare('SELECT purge_after AS purgeAfter FROM public_discovery_result_nonces_v3 WHERE nonce = ?1')
      .bind(payload.nonce).first<{ purgeAfter: string }>();
    expect(Date.parse(nonce?.purgeAfter ?? '') - Date.parse(verifiedAt)).toBeGreaterThan(6 * 86_400_000);
  });

  it('refreshes a due VERIFIED profile without interrupting reads or retaining its old request', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const key = { ...discoveryKey('7'), fingerprint: '70'.repeat(32) };
    const admittedAt = '2026-09-01T12:00:00.000Z';
    const request = {
      key,
      query: { discoveryTitles: ['Refresh Work'], mediaKind: 'ANIME' as const, sourceTitles: ['Refresh Work'] },
      requestDigest: '7'.repeat(64), schemaVersion: 3 as const,
    };
    await adapter.request(request, admittedAt);
    const initialClaim = await adapter.claimBatch({
      claimToken: 'i'.repeat(48), leaseUntil: '2026-09-01T12:15:00.000Z', limit: 20,
      now: admittedAt, tokenDigest: 'i'.repeat(64),
    });
    expect(initialClaim.requests.some(({ key: claimedKey }) => claimedKey.fingerprint === key.fingerprint)).toBe(true);
    const result = verifiedResult(key, request.requestDigest, 'refresh', '754321', 'Refresh Work');
    await adapter.publishBatch({
      claimToken: initialClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440070',
      results: [result], schemaVersion: 3, verifiedAt: admittedAt,
    }, 'i'.repeat(64), '7'.repeat(64), admittedAt);
    await env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v3 SET next_refresh_at = '2026-09-15T00:00:00.000Z'
      WHERE fingerprint = ?1`).bind(key.fingerprint).run();

    const queue = { send: vi.fn(async () => undefined) };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue });
    const refresh = await app.request('https://tobirink.test/v3/catalogue/discoveries/refreshes', {
      body: JSON.stringify({ key, schemaVersion: 3 }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(refresh.status).toBe(202);
    await expect(refresh.json()).resolves.toMatchObject({ profile: { workId: 'work_refresh' }, state: 'VERIFIED' });
    expect(queue.send).toHaveBeenCalledOnce();

    const active = await env.PUBLIC_DB.prepare(`SELECT request_json AS requestJson, refresh_state AS refreshState
      FROM public_discovery_requests_v3 WHERE fingerprint = ?1`).bind(key.fingerprint).first();
    expect(active).toEqual({ requestJson: '{}', refreshState: 'PENDING' });
    const now = new Date().toISOString();
    const claim = await adapter.claimBatch({
      claimToken: 'r'.repeat(48), leaseUntil: new Date(Date.parse(now) + 900_000).toISOString(), limit: 20,
      now, tokenDigest: 'r'.repeat(64),
    });
    const refreshed = claim.requests.find(({ key: claimedKey }) => claimedKey.fingerprint === key.fingerprint);
    expect(refreshed).toMatchObject({
      attempt: 1,
      query: { discoveryTitles: ['Refresh Work'], explicitProviderReference: { externalId: '754321', provider: 'anilist' } },
      requestDigest: request.requestDigest,
    });
    await expect(adapter.read(key, now)).resolves.toMatchObject({ profile: { workId: 'work_refresh' }, state: 'VERIFIED' });
    const before = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions').first();
    await adapter.publishBatch({
      claimToken: claim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440071',
      results: [result], schemaVersion: 3, verifiedAt: now,
    }, 'r'.repeat(64), '8'.repeat(64), now);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions').first()).toEqual(before);
    expect(await env.PUBLIC_DB.prepare(`SELECT request_json AS requestJson, refresh_state AS refreshState
      FROM public_discovery_requests_v3 WHERE fingerprint = ?1`).bind(key.fingerprint).first())
      .toEqual({ requestJson: '{}', refreshState: 'IDLE' });

    expect((await app.request('https://tobirink.test/v3/catalogue/discoveries/refreshes', {
      body: JSON.stringify({ key, schemaVersion: 3 }), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    })).status).toBe(202);
    expect(queue.send).toHaveBeenCalledOnce();

    const changedAt = new Date(Date.parse(now) + 8 * 86_400_000).toISOString();
    await env.PUBLIC_DB.prepare('UPDATE public_discovery_requests_v3 SET next_refresh_at = ?1 WHERE fingerprint = ?2')
      .bind(changedAt, key.fingerprint).run();
    await expect(adapter.requestRefresh(key, changedAt)).resolves.toMatchObject({ outcome: 'created' });
    const changedClaim = await adapter.claimBatch({
      claimToken: 's'.repeat(48), leaseUntil: new Date(Date.parse(changedAt) + 900_000).toISOString(), limit: 20,
      now: changedAt, tokenDigest: 's'.repeat(64),
    });
    await expect(adapter.publishBatch({
      claimToken: changedClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440072',
      results: [{ key, requestDigest: request.requestDigest, resolution: { reason: 'temporary-provider-gap', state: 'NOT_FOUND' } }],
      schemaVersion: 3, verifiedAt: changedAt,
    }, 's'.repeat(64), '9'.repeat(64), changedAt)).rejects.toThrow('public-discovery-refresh-not-verified');
    await expect(adapter.read(key, changedAt)).resolves.toMatchObject({ profile: { candidate: { displayTitle: 'Refresh Work' } }, state: 'VERIFIED' });

    const changed = verifiedResult(key, request.requestDigest, 'refresh', '754321', 'Refresh Work Updated');
    await expect(adapter.publishBatch({
      claimToken: changedClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440073',
      results: [changed], schemaVersion: 3, verifiedAt: changedAt,
    }, 's'.repeat(64), 'a'.repeat(64), changedAt)).resolves.toEqual({ published: 1, replayed: 0 });
    await expect(adapter.read(key, changedAt)).resolves.toMatchObject({
      profile: { candidate: { displayTitle: 'Refresh Work Updated' }, workId: 'work_refresh' }, state: 'VERIFIED',
    });
    await env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v3 SET
      refresh_state = 'PROCESSING', refresh_attempt_count = 8, claim_token_hash = ?1, lease_until = ?2
      WHERE fingerprint = ?3`).bind('e'.repeat(64), '2000-01-01T00:00:00.000Z', key.fingerprint).run();
    const exhausted = await adapter.claimBatch({
      claimToken: 't'.repeat(48), leaseUntil: new Date(Date.parse(changedAt) + 900_000).toISOString(), limit: 20,
      now: changedAt, tokenDigest: 't'.repeat(64),
    });
    expect(exhausted.requests.some(({ key: claimedKey }) => claimedKey.fingerprint === key.fingerprint)).toBe(false);
    await expect(adapter.read(key, changedAt)).resolves.toMatchObject({
      profile: { candidate: { displayTitle: 'Refresh Work Updated' } }, state: 'VERIFIED',
    });
    expect(await env.PUBLIC_DB.prepare(`SELECT refresh_attempt_count AS attempts, refresh_state AS refreshState
      FROM public_discovery_requests_v3 WHERE fingerprint = ?1`).bind(key.fingerprint).first())
      .toEqual({ attempts: 0, refreshState: 'IDLE' });
  });

  it('indexes a late manga adaptation as a distinct work and coalesces its exact discovery', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const sourceKey = { ...discoveryKey('a'), fingerprint: 'ab'.repeat(32) };
    const now = '2026-09-16T09:00:00.000Z';
    const sourceRequest = {
      key: sourceKey,
      query: { discoveryTitles: ['Shared Title'], mediaKind: 'ANIME' as const, sourceTitles: ['Shared Title'] },
      requestDigest: 'b'.repeat(64), schemaVersion: 3 as const,
    };
    await adapter.request(sourceRequest, now);
    const sourceClaim = await adapter.claimBatch({
      claimToken: 'u'.repeat(48), leaseUntil: '2026-09-16T09:15:00.000Z', limit: 20,
      now, tokenDigest: 'u'.repeat(64),
    });
    expect(sourceClaim.requests.some(({ key }) => key.fingerprint === sourceKey.fingerprint)).toBe(true);
    const sourceBase = verifiedResult(sourceKey, sourceRequest.requestDigest, 'anime_source', '9001', 'Shared Title');
    const sourceResult = { ...sourceBase, resolution: { ...sourceBase.resolution, profile: {
      ...sourceBase.resolution.profile,
      candidate: { ...sourceBase.resolution.profile.candidate, relations: [{
        mediaKind: 'MANGA' as const, reference: { externalId: '9002', provider: 'anilist' as const },
        relationType: 'ADAPTATION' as const, titles: ['Shared Title'],
      }] },
    } } };
    const sourceReceipt = await adapter.publishBatch({
      claimToken: sourceClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440080',
      results: [sourceResult], schemaVersion: 3, verifiedAt: now,
    }, 'u'.repeat(64), 'b'.repeat(64), now);
    expect(sourceReceipt).toMatchObject({ published: 1, replayed: 0, followUps: [expect.any(Object)] });
    expect(sourceReceipt.followUps).toHaveLength(1);
    const followUp = sourceReceipt.followUps?.[0];
    if (!followUp) throw new Error('Expected bounded adaptation follow-up.');
    await adapter.confirmQueueSignal(followUp.key, followUp.requestDigest, now);
    await expect(adapter.publishBatch({
      claimToken: sourceClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440080',
      results: [sourceResult], schemaVersion: 3, verifiedAt: now,
    }, 'u'.repeat(64), 'b'.repeat(64), now)).resolves.toEqual({ published: 0, replayed: 1 });
    expect(await env.PUBLIC_DB.prepare(`SELECT relation_type AS relationType, target_media_kind AS mediaKind,
      target_work_id AS targetWorkId FROM catalogue_work_relations WHERE source_work_id = ?1`)
      .bind('work_anime_source').first()).toEqual({ relationType: 'ADAPTATION', mediaKind: 'MANGA', targetWorkId: null });

    const targetClaim = await adapter.claimBatch({
      claimToken: 'v'.repeat(48), leaseUntil: '2026-09-16T09:30:00.000Z', limit: 20,
      now, tokenDigest: 'v'.repeat(64),
    });
    const targetRequest = targetClaim.requests.find(({ key }) => key.fingerprint === followUp.key.fingerprint);
    expect(targetRequest).toMatchObject({
      query: { explicitProviderReference: { externalId: '9002', provider: 'anilist' }, mediaKind: 'MANGA' },
    });
    if (!targetRequest) throw new Error('Expected adaptation claim.');
    const targetResult = {
      ...verifiedResult(followUp.key, targetRequest.requestDigest, 'manga_target', '9002', 'Shared Title'),
      resolution: { profile: {
        ...verifiedResult(followUp.key, targetRequest.requestDigest, 'manga_target', '9002', 'Shared Title').resolution.profile,
        candidate: { ...verifiedResult(followUp.key, targetRequest.requestDigest, 'manga_target', '9002', 'Shared Title').resolution.profile.candidate, mediaKind: 'MANGA' as const },
      }, state: 'VERIFIED' as const },
    };
    await expect(adapter.publishBatch({
      claimToken: targetClaim.claimToken, nonce: '550e8400-e29b-41d4-a716-446655440081',
      results: [targetResult], schemaVersion: 3, verifiedAt: now,
    }, 'v'.repeat(64), 'c'.repeat(64), now)).resolves.toEqual({ published: 1, replayed: 0 });
    expect((await env.PUBLIC_DB.prepare(`SELECT work_id AS workId, media_kind AS mediaKind FROM catalogue_works
      WHERE preferred_title = 'Shared Title' ORDER BY media_kind`).all()).results).toEqual([
        { mediaKind: 'anime', workId: 'work_anime_source' },
        { mediaKind: 'manga', workId: 'work_manga_target' },
      ]);
    expect(await env.PUBLIC_DB.prepare(`SELECT target_work_id AS targetWorkId FROM catalogue_work_relations
      WHERE source_work_id = ?1`).bind('work_anime_source').first()).toEqual({ targetWorkId: 'work_manga_target' });
  });

  it('rejects a normalized-title collision atomically', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const token = 'c'.repeat(48);
    const tokenDigest = 'd'.repeat(64);
    const verifiedAt = '2026-09-15T12:00:00.000Z';
    const publish = async (marker: string, title: string) => {
      const key = discoveryKey(marker);
      const submission = { key, query: { discoveryTitles: [title], mediaKind: 'ANIME' as const, sourceTitles: [title] }, schemaVersion: 3 as const };
      const requestDigest = await jsonDigest(submission);
      await adapter.request({ ...submission, requestDigest }, verifiedAt);
      await adapter.claimBatch({ claimToken: token, leaseUntil: '2026-09-15T13:00:00.000Z', limit: 50, now: verifiedAt, tokenDigest });
      return adapter.publishBatch({
        claimToken: token, nonce: crypto.randomUUID(), results: [verifiedResult(key, requestDigest, marker, marker, title)], schemaVersion: 3, verifiedAt,
      }, tokenDigest, marker.repeat(64), verifiedAt);
    };
    await expect(publish('1', 'L’Épopée')).resolves.toEqual({ published: 1, replayed: 0 });
    await expect(publish('2', 'L Epopee')).rejects.toThrow('stale-public-discovery-result');
    expect(await env.PUBLIC_DB.prepare('SELECT work_id AS workId FROM catalogue_canonical_titles_v1 WHERE normalized_title = ?1 AND media_kind = ?2')
      .bind('l epopee', 'anime').first()).toEqual({ workId: 'work_1' });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind('work_2').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(discoveryKey('2').fingerprint).first()).toEqual({ state: 'PROCESSING' });
  });

  it('backfills the canonical index when an exact historical terminal result is replayed', async () => {
    const key = discoveryKey('4');
    const requestDigest = '4'.repeat(64);
    const verifiedAt = '2026-09-15T12:00:00.000Z';
    const result = verifiedResult(key, requestDigest, 'historical', 'historical', 'Épopée historique');
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(4, verifiedAt),
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)')
        .bind('work_historical', 'anime', 'Épopée historique', 4),
      env.PUBLIC_DB.prepare(`INSERT INTO public_discovery_requests_v3(
        fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
        state, result_json, retry_at, verified_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, '{}', 'VERIFIED', ?6, ?7, ?7, ?7, ?7)`)
        .bind(...Object.values(key), requestDigest, JSON.stringify(result.resolution), verifiedAt),
    ]);
    const replay = await new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB).publishBatch({
      claimToken: 'c'.repeat(48), nonce: crypto.randomUUID(), results: [result], schemaVersion: 3, verifiedAt,
    }, 'd'.repeat(64), 'e'.repeat(64), verifiedAt);
    expect(replay).toEqual({ published: 0, replayed: 1 });
    expect(await env.PUBLIC_DB.prepare(`SELECT work_id AS workId FROM catalogue_canonical_titles_v1
      WHERE normalization_version = ?1 AND normalized_title = ?2 AND media_kind = ?3`)
      .bind('favorite-title-preparation-v2', 'epopee historique', 'anime').first()).toEqual({ workId: 'work_historical' });
  });

  it.each([
    ['replaced', async (key: ReturnType<typeof discoveryKey>) => env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v3
      SET claim_token_hash = ?1, lease_until = ?2 WHERE fingerprint = ?3`).bind('d'.repeat(64), '2099-01-01T00:00:00.000Z', key.fingerprint).run()],
    ['expired', async (key: ReturnType<typeof discoveryKey>) => env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v3
      SET lease_until = ?1 WHERE fingerprint = ?2`).bind('2000-01-01T00:00:00.000Z', key.fingerprint).run()],
  ])('rejects a %s lease without writing any catalogue row', async (marker, invalidateLease) => {
    const key = discoveryKey(marker === 'replaced' ? '7' : '8');
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB) }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Lease Test'], mediaKind: 'ANIME', sourceTitles: ['Lease Test'] }, schemaVersion: 3 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claimed = await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', {
      body: JSON.stringify({ limit: 50 }), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claim = await claimed.json<{ claimToken: string; requests: { key: typeof key; requestDigest: string }[] }>();
    const request = claim.requests.find((value) => value.key.fingerprint === key.fingerprint);
    if (!request) throw new Error('Expected claimed lease test request.');
    await invalidateLease(key);
    const verifiedAt = new Date().toISOString();
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', {
      body: JSON.stringify({
        claimToken: claim.claimToken, nonce: crypto.randomUUID(), results: [verifiedResult(key, request.requestDigest, `lease_${marker}`)],
        schemaVersion: 3, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind(`work_lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind(`work_lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_external_references WHERE external_id = ?1').bind(`lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions WHERE revision = ?1').bind(Date.parse(verifiedAt)).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PROCESSING' });
  });

  it('rejects a provider reference conflict without partial catalogue or terminal writes', async () => {
    const key = discoveryKey('6');
    const verifiedAt = new Date().toISOString();
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(1, verifiedAt),
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)').bind('work_existing', 'anime', 'Existing', 1),
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES (?1, ?2, ?3)').bind('anilist', 'shared-id', 'work_existing'),
    ]);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB) }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Conflict'], mediaKind: 'ANIME', sourceTitles: ['Conflict'] }, schemaVersion: 3 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claimed = await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', {
      body: JSON.stringify({ limit: 50 }), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    const claim = await claimed.json<{ claimToken: string; requests: { key: typeof key; requestDigest: string }[] }>();
    const request = claim.requests.find((value) => value.key.fingerprint === key.fingerprint);
    if (!request) throw new Error('Expected claimed conflict request.');
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', {
      body: JSON.stringify({
        claimToken: claim.claimToken, nonce: crypto.randomUUID(), results: [verifiedResult(key, request.requestDigest, 'conflict', 'shared-id')],
        schemaVersion: 3, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind('work_conflict').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind('work_conflict').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions WHERE revision = ?1').bind(Date.parse(verifiedAt)).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PROCESSING' });
    expect(await env.PUBLIC_DB.prepare('SELECT work_id AS workId FROM catalogue_external_references WHERE provider = ?1 AND external_id = ?2').bind('anilist', 'shared-id').first()).toEqual({ workId: 'work_existing' });
  });

  it('exposes the expired eighth attempt as unavailable and requires an identical explicit retry', async () => {
    const key = discoveryKey('5');
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const submission = { key, query: { discoveryTitles: ['Attempt Limit'], mediaKind: 'ANIME' as const, sourceTitles: ['Attempt Limit'] }, schemaVersion: 3 as const };
    const request = { ...submission, requestDigest: await jsonDigest(submission) };
    await adapter.request(request, '2026-09-15T00:00:00.000Z');
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const now = new Date(Date.UTC(2026, 8, 15, attempt - 1)).toISOString();
      const leaseUntil = new Date(Date.UTC(2026, 8, 15, attempt)).toISOString();
      const claim = await adapter.claimBatch({ claimToken: 'c'.repeat(48), leaseUntil, limit: 1, now, tokenDigest: 'd'.repeat(64) });
      expect(claim.requests[0]?.attempt).toBe(attempt);
    }
    const exhaustedAt = '2026-09-15T08:00:00.000Z';
    await expect(adapter.read(key, exhaustedAt)).resolves.toEqual({ reason: 'ATTEMPT_LIMIT', state: 'UNAVAILABLE' });
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attemptCount, purge_after AS purgeAfter, state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({
      attemptCount: 8, purgeAfter: '2026-10-15T08:00:00.000Z', state: 'FAILED',
    });
    await expect(adapter.request({ ...request, requestDigest: 'e'.repeat(64) }, exhaustedAt)).rejects.toThrow('public-discovery-request-conflict');
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter });
    const retry = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(retry.status).toBe(202);
    await expect(retry.json()).resolves.toMatchObject({ state: 'PENDING' });
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attemptCount, state FROM public_discovery_requests_v3 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ attemptCount: 0, state: 'PENDING' });
    const reclaimedAt = new Date().toISOString();
    const reclaimed = await adapter.claimBatch({
      claimToken: 'r'.repeat(48), leaseUntil: new Date(Date.parse(reclaimedAt) + 15 * 60_000).toISOString(),
      limit: 50, now: reclaimedAt, tokenDigest: 'f'.repeat(64),
    });
    expect(reclaimed.requests.find((item) => item.key.fingerprint === key.fingerprint)?.attempt).toBe(1);
  });

  it('does not expose retired collective and unverified-cache endpoints', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://tobirink.test/v1/collective/consents', { method: 'POST' }),
      SELF.fetch('https://tobirink.test/v2/favorites/rules'),
      SELF.fetch('https://tobirink.test/v1/catalogue/favorites/resolve'),
      SELF.fetch('https://tobirink.test/v1/catalogue/favorites/resolve-batch', { method: 'POST' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });

  it('retires every legacy v2 discovery route with Gone', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://tobirink.test/v2/catalogue/discoveries'),
      SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/claims', { method: 'POST' }),
      SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/proposals', { method: 'POST' }),
      SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/pending'),
      SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/promotions', { method: 'POST' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([410, 410, 410, 410, 410]);
    expect(await responses[0]?.json()).toEqual({ error: 'public-discovery-v2-retired' });
  });
});
