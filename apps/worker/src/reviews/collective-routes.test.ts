import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

interface ConsentResponse {
  consentId: string;
  revokeToken: string;
  writeToken: string;
}

beforeEach(async () => {
  await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS);
});

async function createConsent(): Promise<ConsentResponse> {
  const response = await SELF.fetch('https://tobirink.test/v1/collective/consents', {
    body: JSON.stringify({ consent: true }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  expect(response.status).toBe(201);
  return response.json<ConsentResponse>();
}

function association(consentId: string, nonce: string) {
  return {
    canonicalWorkId: 'work_frieren',
    consentId,
    decidedAt: '2026-09-04T10:00:00.000Z',
    externalWorkId: '154587',
    nonce,
    provider: 'anilist',
  };
}

async function contribute(credentials: ConsentResponse, nonce: string) {
  return SELF.fetch('https://tobirink.test/v1/collective/associations', {
    body: JSON.stringify(association(credentials.consentId, nonce)),
    headers: {
      Authorization: `Bearer ${credentials.writeToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

function revokeUrl(consentId: string): URL {
  const url = new URL('https://tobirink.test');
  url.pathname = ['/v1/collective/consents', encodeURIComponent(consentId), 'revoke'].join('/');
  return url;
}

describe('collective Review API', () => {
  it('requires explicit consent and rejects private fields', async () => {
    const refused = await SELF.fetch('https://tobirink.test/v1/collective/consents', {
      body: JSON.stringify({ consent: false }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(refused.status).toBe(400);

    const credentials = await createConsent();
    const privatePayload = { ...association(credentials.consentId, crypto.randomUUID()), title: 'Frieren' };
    const leaked = await SELF.fetch('https://tobirink.test/v1/collective/associations', {
      body: JSON.stringify(privatePayload),
      headers: { Authorization: `Bearer ${credentials.writeToken}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(leaked.status).toBe(400);
  });

  it('enforces nonce replay protection, daily quota and revocation', async () => {
    const credentials = await createConsent();
    const firstNonce = crypto.randomUUID();
    expect((await contribute(credentials, firstNonce)).status).toBe(201);
    expect((await contribute(credentials, firstNonce)).status).toBe(409);
    expect((await contribute(credentials, crypto.randomUUID())).status).toBe(201);
    expect((await contribute(credentials, crypto.randomUUID())).status).toBe(429);

    const revoked = await SELF.fetch(revokeUrl(credentials.consentId), {
      headers: { Authorization: `Bearer ${credentials.revokeToken}` },
      method: 'POST',
    });
    expect(revoked.status).toBe(200);
    expect((await contribute(credentials, crypto.randomUUID())).status).toBe(403);
  });

  it('rejects the wrong write and revoke credentials', async () => {
    const credentials = await createConsent();
    const wrongToken = 'A'.repeat(43);
    const write = await SELF.fetch('https://tobirink.test/v1/collective/associations', {
      body: JSON.stringify(association(credentials.consentId, crypto.randomUUID())),
      headers: { Authorization: `Bearer ${wrongToken}`, 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(write.status).toBe(403);
    const revoke = await SELF.fetch(revokeUrl(credentials.consentId), {
      headers: { Authorization: `Bearer ${wrongToken}` },
      method: 'POST',
    });
    expect(revoke.status).toBe(403);
  });

  it('stores only minimized columns, uses the quota index and bounds request bodies', async () => {
    const columns = await env.COLLECTIVE_DB.prepare('PRAGMA table_info(collective_associations)').all<{ name: string }>();
    const names = columns.results.map(({ name }) => name);
    expect(names).toEqual([
      'consent_id',
      'canonical_work_id',
      'provider',
      'external_work_id',
      'nonce',
      'decided_at',
      'received_at',
    ]);
    expect(names).not.toEqual(expect.arrayContaining(['title', 'url', 'library', 'progress']));

    const plan = await env.COLLECTIVE_DB.prepare(`
      EXPLAIN QUERY PLAN SELECT COUNT(*) FROM collective_associations
      WHERE consent_id = ?1 AND received_at >= ?2
    `).bind('consent_measurement', '2026-09-04T00:00:00.000Z').all<{ detail: string }>();
    expect(plan.results.map(({ detail }) => detail).join(' ')).toContain('collective_associations_quota');

    const oversized = await SELF.fetch('https://tobirink.test/v1/collective/consents', {
      body: JSON.stringify({ consent: true, padding: 'x'.repeat(2048) }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('cache-control')).toBe('no-store');
    expect(oversized.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
