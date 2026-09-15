import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { D1PublicDiscoveryAdapter, D1PublicDiscoveryV2Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';

const discoveryKey = (marker: string) => ({ fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' });
type DiscoverySubmission = {
  key: ReturnType<typeof discoveryKey>;
  query: { discoveryTitles: string[]; mediaKind: 'ANIME'; sourceTitles: string[] };
  schemaVersion: 2;
};

async function jsonDigest(value: DiscoverySubmission): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function verifiedResult(key: ReturnType<typeof discoveryKey>, requestDigest: string, workMarker: string, externalId = workMarker) {
  return {
    key,
    requestDigest,
    resolution: {
      profile: {
        candidate: {
          displayTitle: `Work ${workMarker}`, externalId, mediaKind: 'ANIME' as const,
          preSerialization: false, provider: 'anilist' as const, titles: [`Work ${workMarker}`],
        },
        references: [{ externalId, provider: 'anilist' as const }],
        workId: `work_${workMarker}`,
      },
      state: 'VERIFIED' as const,
    },
  };
}

beforeEach(async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
});

describe('verified public discovery cache', () => {
  it('logs only a bounded code when collector OIDC verification rejects', async () => {
    const adapter = new D1PublicDiscoveryAdapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscovery: adapter }, async () => { throw new Error('raw verifier details'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', {
      headers: { Authorization: `Bearer ${'x'.repeat(32)}` }, method: 'POST',
    });
    expect(response.status).toBe(401);
    expect(warning).toHaveBeenCalledWith('discovery-ingestion-authorization-rejected', 'agenda-oidc-invalid');
    warning.mockRestore();
  });

  it('stores one server-side request for repeated v3 discovery misses', async () => {
    const key = discoveryKey('e');
    const body = { key, query: { discoveryTitles: ['Frieren'], mediaKind: 'ANIME', sourceTitles: ['Sousou no Frieren'] }, schemaVersion: 2 };
    const responses = await Promise.all([1, 2].map(() => SELF.fetch('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(body), headers: { 'CF-Connecting-IP': '192.0.2.3', 'Content-Type': 'application/json' }, method: 'POST',
    })));
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual([
      expect.objectContaining({ state: 'PENDING' }), expect.objectContaining({ state: 'PENDING' }),
    ]);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_discovery_requests_v2 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ count: 1 });
  });

  it('lets only the OIDC collector claim and terminally resolve a v3 request', async () => {
    const key = discoveryKey('f');
    const v1 = new D1PublicDiscoveryAdapter(env.PUBLIC_DB);
    const v2 = new D1PublicDiscoveryV2Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscovery: v1, publicDiscoveryV2: v2 }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Unknown Work'], mediaKind: 'ANIME', sourceTitles: ['Unknown Work'] }, schemaVersion: 2 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect((await app.request('https://tobirink.test/v3/catalogue/discoveries/collector/claims', { method: 'POST' })).status).toBe(401);
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
        }], schemaVersion: 2, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ published: 1, replayed: 0 });
    expect(await v2.read(key, verifiedAt)).toMatchObject({ reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' });
  });

  it('hydrates D1 with the full verified profile and replays the same result idempotently', async () => {
    const key = discoveryKey('9');
    const v1 = new D1PublicDiscoveryAdapter(env.PUBLIC_DB);
    const v2 = new D1PublicDiscoveryV2Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscovery: v1, publicDiscoveryV2: v2 }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Frieren'], mediaKind: 'ANIME', sourceTitles: ['Frieren'] }, schemaVersion: 2 }),
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
      schemaVersion: 2,
      verifiedAt,
    };
    const headers = { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' };
    const first = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', { body: JSON.stringify(payload), headers, method: 'POST' });
    const replay = await app.request('https://tobirink.test/v3/catalogue/discoveries/results', { body: JSON.stringify(payload), headers, method: 'POST' });
    expect(await first.json()).toEqual({ published: 1, replayed: 0 });
    expect(await replay.json()).toEqual({ published: 0, replayed: 1 });
    await expect(v2.read(key, verifiedAt)).resolves.toMatchObject({
      profile: { candidate: { episodeCount: 28, genres: ['Adventure'], provider: 'anilist' } }, state: 'VERIFIED',
    });
    expect(await env.PUBLIC_DB.prepare('SELECT preferred_title AS title FROM catalogue_works WHERE work_id = ?1').bind('work_anilist_154587').first()).toEqual({ title: 'Frieren' });
  });

  it.each([
    ['replaced', async (key: ReturnType<typeof discoveryKey>) => env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v2
      SET claim_token_hash = ?1, lease_until = ?2 WHERE fingerprint = ?3`).bind('d'.repeat(64), '2099-01-01T00:00:00.000Z', key.fingerprint).run()],
    ['expired', async (key: ReturnType<typeof discoveryKey>) => env.PUBLIC_DB.prepare(`UPDATE public_discovery_requests_v2
      SET lease_until = ?1 WHERE fingerprint = ?2`).bind('2000-01-01T00:00:00.000Z', key.fingerprint).run()],
  ])('rejects a %s lease without writing any catalogue row', async (marker, invalidateLease) => {
    const key = discoveryKey(marker === 'replaced' ? '7' : '8');
    const app = createPublicDiscoveryApp({
      publicDiscovery: new D1PublicDiscoveryAdapter(env.PUBLIC_DB),
      publicDiscoveryV2: new D1PublicDiscoveryV2Adapter(env.PUBLIC_DB),
    }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Lease Test'], mediaKind: 'ANIME', sourceTitles: ['Lease Test'] }, schemaVersion: 2 }),
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
        schemaVersion: 2, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind(`work_lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind(`work_lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_external_references WHERE external_id = ?1').bind(`lease_${marker}`).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions WHERE revision = ?1').bind(Date.parse(verifiedAt)).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v2 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PROCESSING' });
  });

  it('rejects a provider reference conflict without partial catalogue or terminal writes', async () => {
    const key = discoveryKey('6');
    const verifiedAt = new Date().toISOString();
    await env.PUBLIC_DB.batch([
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(1, verifiedAt),
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)').bind('work_existing', 'anime', 'Existing', 1),
      env.PUBLIC_DB.prepare('INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES (?1, ?2, ?3)').bind('anilist', 'shared-id', 'work_existing'),
    ]);
    const app = createPublicDiscoveryApp({
      publicDiscovery: new D1PublicDiscoveryAdapter(env.PUBLIC_DB),
      publicDiscoveryV2: new D1PublicDiscoveryV2Adapter(env.PUBLIC_DB),
    }, async () => undefined);
    await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify({ key, query: { discoveryTitles: ['Conflict'], mediaKind: 'ANIME', sourceTitles: ['Conflict'] }, schemaVersion: 2 }),
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
        schemaVersion: 2, verifiedAt,
      }),
      headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(409);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind('work_conflict').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_titles WHERE work_id = ?1').bind('work_conflict').first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_revisions WHERE revision = ?1').bind(Date.parse(verifiedAt)).first()).toEqual({ count: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_requests_v2 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PROCESSING' });
    expect(await env.PUBLIC_DB.prepare('SELECT work_id AS workId FROM catalogue_external_references WHERE provider = ?1 AND external_id = ?2').bind('anilist', 'shared-id').first()).toEqual({ workId: 'work_existing' });
  });

  it('exposes the expired eighth attempt as unavailable and requires an identical explicit retry', async () => {
    const key = discoveryKey('5');
    const adapter = new D1PublicDiscoveryV2Adapter(env.PUBLIC_DB);
    const submission = { key, query: { discoveryTitles: ['Attempt Limit'], mediaKind: 'ANIME' as const, sourceTitles: ['Attempt Limit'] }, schemaVersion: 2 as const };
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
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attemptCount, state FROM public_discovery_requests_v2 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ attemptCount: 8, state: 'FAILED' });
    await expect(adapter.request({ ...request, requestDigest: 'e'.repeat(64) }, exhaustedAt)).rejects.toThrow('public-discovery-request-conflict');
    const app = createPublicDiscoveryApp({ publicDiscovery: new D1PublicDiscoveryAdapter(env.PUBLIC_DB), publicDiscoveryV2: adapter });
    const retry = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission), headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(retry.status).toBe(202);
    await expect(retry.json()).resolves.toMatchObject({ state: 'PENDING' });
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attemptCount, state FROM public_discovery_requests_v2 WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ attemptCount: 0, state: 'PENDING' });
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
