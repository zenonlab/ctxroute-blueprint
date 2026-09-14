import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { D1PublicDiscoveryAdapter, D1PublicDiscoveryV2Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';

const discoveryKey = (marker: string) => ({ fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' });

beforeEach(async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
});

async function claim(key: ReturnType<typeof discoveryKey>) {
  const response = await SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/claims', {
    body: JSON.stringify({ key, schemaVersion: 1 }),
    headers: { 'CF-Connecting-IP': '192.0.2.1', 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return { response, value: await response.json<{ expiresAt: string; leaseToken: string; state: string }>() };
}

describe('verified public discovery cache', () => {
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

  it('does not expose retired collective and unverified-cache endpoints', async () => {
    const responses = await Promise.all([
      SELF.fetch('https://tobirink.test/v1/collective/consents', { method: 'POST' }),
      SELF.fetch('https://tobirink.test/v2/favorites/rules'),
      SELF.fetch('https://tobirink.test/v1/catalogue/favorites/resolve'),
      SELF.fetch('https://tobirink.test/v1/catalogue/favorites/resolve-batch', { method: 'POST' }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404]);
  });

  it('atomically grants one lease and makes concurrent clients wait', async () => {
    const key = discoveryKey('a');
    const [first, second] = await Promise.all([claim(key), claim(key)]);
    expect([first.response.status, second.response.status].sort()).toEqual([200, 201]);
    expect([first.value.state, second.value.state].sort()).toEqual(['LEASED', 'PENDING']);
    const count = await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_discovery_claims').first<{ count: number }>();
    expect(count).toEqual({ count: 1 });
  });

  it('rejects raw favorite content before writing D1', async () => {
    const key = discoveryKey('b');
    const response = await SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/claims', {
      body: JSON.stringify({ key, rawTitle: 'private', schemaVersion: 1 }),
      headers: { 'CF-Connecting-IP': '192.0.2.2', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(400);
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM public_discovery_claims WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ count: 0 });
  });

  it('keeps client proposals pending and publishes only through the OIDC route', async () => {
    const key = discoveryKey('c');
    const leased = await claim(key);
    expect(leased.response.status).toBe(201);
    const proposal = await SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/proposals', {
      body: JSON.stringify({ key, leaseToken: leased.value.leaseToken, references: [{ externalId: '42', provider: 'anilist' }], schemaVersion: 1 }),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(proposal.status).toBe(202);
    const proposed = await proposal.json<{ proposalDigest: string }>();
    expect(await env.PUBLIC_DB.prepare('SELECT state FROM public_discovery_claims WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'PENDING_VERIFICATION' });
    expect(await env.PUBLIC_DB.prepare('SELECT COUNT(*) AS count FROM catalogue_works WHERE work_id = ?1').bind('work_anilist_42').first()).toEqual({ count: 0 });

    const unauthorized = await SELF.fetch('https://tobirink.test/v2/catalogue/discoveries/pending');
    expect(unauthorized.status).toBe(401);

    const adapter = new D1PublicDiscoveryAdapter(env.PUBLIC_DB);
    await expect(adapter.read(key, '2030-01-01T00:00:00.000Z')).resolves.toEqual({ retryAt: '2030-01-01T00:05:00.000Z', state: 'PENDING' });
    const app = createPublicDiscoveryApp({ publicDiscovery: adapter }, async () => undefined);
    const pending = await app.request('https://tobirink.test/v2/catalogue/discoveries/pending', { headers: { Authorization: `Bearer ${'x'.repeat(32)}` } });
    expect((await pending.json<{ claims: unknown[] }>()).claims).toHaveLength(1);

    const verifiedAt = new Date().toISOString();
    const promotion = {
      nonce: crypto.randomUUID(), promotions: [{ key, profile: {
        mediaKind: 'anime', officialTitles: [{ locale: 'en', title: 'Synthetic Series' }], preferredTitle: 'Synthetic Series',
        references: [{ externalId: '42', provider: 'anilist' }], workId: 'work_anilist_42',
      }, proposalDigest: proposed.proposalDigest, schemaVersion: 1, verifiedAt }], schemaVersion: 1,
    };
    const promoted = await app.request('https://tobirink.test/v2/catalogue/discoveries/promotions', {
      body: JSON.stringify(promotion), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(promoted.status).toBe(201);
    expect(await promoted.json()).toEqual({ promoted: 1, replayed: 0 });
    expect(await env.PUBLIC_DB.prepare('SELECT state, work_id AS workId FROM public_discovery_claims WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ state: 'VERIFIED', workId: 'work_anilist_42' });
    expect(await env.PUBLIC_DB.prepare('SELECT preferred_title AS title FROM catalogue_works WHERE work_id = ?1').bind('work_anilist_42').first()).toEqual({ title: 'Synthetic Series' });

    const replay = await app.request('https://tobirink.test/v2/catalogue/discoveries/promotions', {
      body: JSON.stringify({ ...promotion, nonce: crypto.randomUUID() }), headers: { Authorization: `Bearer ${'x'.repeat(32)}`, 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(await replay.json()).toEqual({ promoted: 0, replayed: 1 });
  });

  it('allows one bounded retry only after an abandoned lease expires', async () => {
    const key = discoveryKey('d');
    const adapter = new D1PublicDiscoveryAdapter(env.PUBLIC_DB);
    const first = await adapter.claim(key, { expiresAt: '2026-09-14T10:02:00.000Z', tokenDigest: '1'.repeat(64) }, '2026-09-14T10:00:00.000Z');
    const active = await adapter.claim(key, { expiresAt: '2026-09-14T10:03:00.000Z', tokenDigest: '2'.repeat(64) }, '2026-09-14T10:01:00.000Z');
    const expired = await adapter.claim(key, { expiresAt: '2026-09-14T10:05:00.000Z', tokenDigest: '3'.repeat(64) }, '2026-09-14T10:03:00.000Z');
    expect('leaseGranted' in first && first.leaseGranted).toBe(true);
    expect('leaseGranted' in active).toBe(false);
    expect('leaseGranted' in expired && expired.leaseGranted).toBe(true);
    expect(await env.PUBLIC_DB.prepare('SELECT attempt_count AS attempts FROM public_discovery_claims WHERE fingerprint = ?1').bind(key.fingerprint).first()).toEqual({ attempts: 2 });
  });
});
