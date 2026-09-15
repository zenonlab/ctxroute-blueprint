import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { D1PublicDiscoveryAdapter, D1PublicDiscoveryV2Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';

const discoveryKey = (marker: string) => ({ fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' });

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
