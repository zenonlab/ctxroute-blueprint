import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { D1FavoriteCollectiveAdapter } from '@tobirink/adapters-cloudflare';
import { bundledFavoriteSiteRules, collectiveDigest, favoriteCollectiveReceiptSchema } from '@tobirink/application';
import type { FavoriteCollectiveCommand, FavoriteOwnerCredentials } from '@tobirink/application';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS);
  key.fingerprint = await collectiveDigest(crypto.randomUUID());
});
const key = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '3', siteRulesVersion: '2' };
function lookup(): FavoriteCollectiveCommand { return { schemaVersion: 2, operation: 'lookup', nonce: crypto.randomUUID(), keys: [key] }; }
function contribute(id = '1', confirmed = true): FavoriteCollectiveCommand { return { schemaVersion: 2, operation: 'contribute', nonce: crypto.randomUUID(), choices: [{ key, mediaKind: 'ANIME', references: [{ provider: 'anilist', externalId: id }], confirmed }] }; }
async function owner(adapter: D1FavoriteCollectiveAdapter) {
  const credentials = { ownerId: crypto.randomUUID(), installationId: crypto.randomUUID(), token: await collectiveDigest(crypto.randomUUID()) };
  expect(await adapter.register({ ...credentials, consent: true, revokeToken: await collectiveDigest(crypto.randomUUID()) })).toBe(true);
  return credentials;
}
async function results(adapter: D1FavoriteCollectiveAdapter, credentials: FavoriteOwnerCredentials) {
  const result = await adapter.execute(credentials, lookup(), 100);
  if (result.kind !== 'ACCEPTED') throw new Error(result.kind);
  return result.receipt.results;
}

describe('favorite owner SQL index', () => {
  it('enforces the quota atomically under distinct concurrent nonces', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB); const credentials = await owner(adapter);
    const outcomes = await Promise.all([adapter.execute(credentials, contribute('1'), 1), adapter.execute(credentials, contribute('2'), 1)]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual(['ACCEPTED', 'QUOTA_EXCEEDED']);
  });

  it('handles fifty keys with bounded SQL statements and measured reads', async () => {
    let statementCount = 0; let rowsRead = 0;
    const adapter = new D1FavoriteCollectiveAdapter({
      prepare: (sql) => { statementCount += 1; return env.COLLECTIVE_DB.prepare(sql); },
      async batch(statements: D1PreparedStatement[]) {
        const results = await env.COLLECTIVE_DB.batch(statements);
        rowsRead += results.reduce((sum, result) => sum + result.meta.rows_read, 0);
        return results;
      },
    });
    const credentials = await owner(adapter);
    const keys = await Promise.all(Array.from({ length: 50 }, async (_, index) => ({ ...key, fingerprint: await collectiveDigest(String(index)) })));
    await adapter.execute(credentials, { schemaVersion: 2, operation: 'contribute', nonce: crypto.randomUUID(), choices: keys.map((key) => ({ key, mediaKind: 'ANIME', references: [{ provider: 'anilist', externalId: '1' }], confirmed: true })) }, 100);
    statementCount = 0; rowsRead = 0;
    const response = await adapter.execute(credentials, { schemaVersion: 2, operation: 'lookup', nonce: crypto.randomUUID(), keys }, 100);
    expect(response.kind).toBe('ACCEPTED');
    if (response.kind === 'ACCEPTED') expect(response.receipt.results).toHaveLength(50);
    expect(statementCount).toBeLessThanOrEqual(5);
    expect(rowsRead).toBeLessThan(500);
  });
  it('isolates choices, counts owners once, and preserves conflicting personal choices', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB);
    const first = await owner(adapter); const second = await owner(adapter); const observer = await owner(adapter);
    expect((await adapter.execute(first, contribute(), 100)).kind).toBe('ACCEPTED');
    expect(await results(adapter, first)).toMatchObject([{ kind: 'FOUND', scope: 'owner' }]);
    const alternateRoute = await adapter.execute(first, { schemaVersion: 2, operation: 'lookup', nonce: crypto.randomUUID(), keys: [{ ...key, siteRulesVersion: 'another-site-route' }] }, 100);
    expect(alternateRoute).toMatchObject({ kind: 'ACCEPTED', receipt: { results: [{ kind: 'FOUND', scope: 'owner' }] } });
    await adapter.execute(first, contribute('99', false), 100);
    expect(await results(adapter, first)).toMatchObject([{ references: [{ externalId: '1' }] }]);
    expect(await results(adapter, observer)).toEqual([{ kind: 'MISS', fingerprint: key.fingerprint }]);
    const pairingToken = await collectiveDigest(crypto.randomUUID());
    expect((await adapter.execute(first, { schemaVersion: 2, operation: 'pair', nonce: crypto.randomUUID(), pairingToken }, 100)).kind).toBe('ACCEPTED');
    const device = { ownerId: first.ownerId, installationId: crypto.randomUUID(), token: await collectiveDigest(crypto.randomUUID()) };
    expect(await adapter.redeem({ ...device, pairingToken, consent: true })).toBe(true);
    expect(await adapter.redeem({ ...device, pairingToken, consent: true })).toBe(true);
    expect(await adapter.redeem({ ...device, installationId: crypto.randomUUID(), pairingToken, consent: true })).toBe(false);
    await adapter.execute(device, contribute(), 100);
    expect(await results(adapter, observer)).toMatchObject([{ kind: 'MISS' }]);
    await adapter.execute(second, contribute(), 100);
    expect(await results(adapter, observer)).toMatchObject([{ kind: 'FOUND', scope: 'shared', references: [{ externalId: '1' }] }]);
    await adapter.execute(second, contribute('2'), 100);
    expect(await results(adapter, observer)).toMatchObject([{ kind: 'MISS' }]);
    expect(await results(adapter, first)).toMatchObject([{ references: [{ externalId: '1' }] }]);
    expect(await results(adapter, second)).toMatchObject([{ references: [{ externalId: '2' }] }]);
  });

  it('returns identical receipts after concurrent retries and rejects a changed nonce payload', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB);
    const credentials = await owner(adapter); const command = contribute();
    const [first, second] = await Promise.all([adapter.execute(credentials, command, 2), adapter.execute(credentials, command, 2)]);
    expect(first).toEqual(second); expect(first.kind).toBe('ACCEPTED');
    expect((await adapter.execute(credentials, { ...contribute('2'), nonce: command.nonce }, 2)).kind).toBe('REPLAY');
    const readCommand = lookup(); const before = await adapter.execute(credentials, readCommand, 2);
    expect((await adapter.execute(credentials, contribute('3'), 2)).kind).toBe('QUOTA_EXCEEDED');
    expect(await adapter.execute(credentials, readCommand, 2)).toEqual(before);
    const counts = await env.COLLECTIVE_DB.prepare('SELECT owner_count FROM favorite_confirmations WHERE key_id = ?1').bind(await collectiveDigest(JSON.stringify([1, key.mediaKind, key.fingerprint]))).first<{ owner_count: number }>();
    expect(counts?.owner_count).toBe(1);
  });

  it('never shares automatic decisions and expires pairing invitations', async () => {
    let now = 1000000; const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB, () => now);
    const first = await owner(adapter); const second = await owner(adapter); const observer = await owner(adapter);
    await adapter.execute(first, contribute('1', false), 100); await adapter.execute(second, contribute('1', false), 100);
    expect(await results(adapter, observer)).toMatchObject([{ kind: 'MISS' }]);
    const pairingToken = '1'.repeat(64);
    await adapter.execute(first, { schemaVersion: 2, operation: 'pair', nonce: crypto.randomUUID(), pairingToken }, 100);
    now += 300001;
    expect(await adapter.redeem({ ...first, installationId: crypto.randomUUID(), pairingToken, consent: true })).toBe(false);
    const revocation = { schemaVersion: 2 as const, operation: 'revoke' as const, nonce: crypto.randomUUID() };
    const receipt = await adapter.execute(first, revocation, 100);
    expect(await adapter.execute(first, revocation, 100)).toEqual(receipt);
    expect((await adapter.execute(first, lookup(), 100)).kind).toBe('UNAUTHORIZED');
    expect((await adapter.execute({ ...second, token: 'f'.repeat(64) }, lookup(), 100)).kind).toBe('UNAUTHORIZED');
  });

  it('rolls back every mutation when a SQL batch fails', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB); const credentials = await owner(adapter);
    const failing = new D1FavoriteCollectiveAdapter({
      prepare: (sql) => sql.startsWith('INSERT INTO favorite_choices')
        ? env.COLLECTIVE_DB.prepare('INSERT INTO favorite_owners SELECT NULL, NULL, NULL, NULL WHERE ?1 IS NOT NULL AND ?2 IS NOT NULL AND ?3 IS NOT NULL AND ?4 IS NOT NULL')
        : env.COLLECTIVE_DB.prepare(sql),
      batch: env.COLLECTIVE_DB.batch.bind(env.COLLECTIVE_DB),
    });
    const command = contribute();
    await expect(failing.execute(credentials, command, 100)).rejects.toThrow();
    expect(await env.COLLECTIVE_DB.prepare('SELECT 1 FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?2').bind(credentials.ownerId, command.nonce).first()).toBeNull();
    expect(await results(adapter, credentials)).toMatchObject([{ kind: 'MISS' }]);
  });

  it('uses covering lookups with bounded shared identities and retains historical catalogue tables', async () => {
    const plan = await env.COLLECTIVE_DB.prepare(`EXPLAIN QUERY PLAN SELECT owner_count, media_kind, references_json
      FROM favorite_confirmations WHERE key_id = ?1 AND owner_count > 0 ORDER BY identity_hash LIMIT 2`).bind('x').all<{ detail: string }>();
    const details = plan.results.map(({ detail }) => detail).join('\n');
    expect(details).toContain('favorite_confirmations_active');
    const own = await env.COLLECTIVE_DB.prepare('EXPLAIN QUERY PLAN SELECT media_kind, references_json FROM favorite_choices WHERE owner_id = ?1 AND key_id = ?2').bind('x', 'y').all<{ detail: string }>();
    expect(own.results.map(({ detail }) => detail).join(' ')).toContain('sqlite_autoindex_favorite_choices');
    expect(details).not.toMatch(/SCAN (?:favorite_choices|favorite_confirmations|c)\b/u);
    const columns = await env.COLLECTIVE_DB.prepare('PRAGMA table_info(favorite_choices)').all<{ name: string }>();
    expect(columns.results.map(({ name }) => name)).toEqual(['owner_id', 'key_id', 'identity_hash', 'media_kind', 'references_json', 'confirmed']);
    expect(await env.COLLECTIVE_DB.prepare("SELECT name FROM sqlite_schema WHERE name = 'collective_associations'").first()).not.toBeNull();
  });

  it('serves only digest-verified published declarative rules', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB);
    expect(await adapter.readRules()).toEqual(bundledFavoriteSiteRules);
    const rules = { ...bundledFavoriteSiteRules, version: 99 }; const document = JSON.stringify(rules);
    await env.COLLECTIVE_DB.prepare('INSERT INTO favorite_site_rules VALUES (?1, ?2, ?3, 1)').bind(99, document, await collectiveDigest(document)).run();
    expect(await adapter.readRules()).toEqual(rules);
    await env.COLLECTIVE_DB.prepare('UPDATE favorite_site_rules SET digest = ?1 WHERE revision = 99').bind('0'.repeat(64)).run();
    await expect(adapter.readRules()).rejects.toThrow('Invalid published');
  });

  it('rejects private fields, web sessions, excessive bodies and unauthenticated batches over HTTP', async () => {
    const adapter = new D1FavoriteCollectiveAdapter(env.COLLECTIVE_DB); const credentials = await owner(adapter);
    const url = 'https://tobirink.test/v2/favorites/batches';
    const headers = { Authorization: `Bearer ${credentials.token}`, 'X-Tobirink-Owner': credentials.ownerId, 'X-Tobirink-Installation': credentials.installationId, 'Content-Type': 'application/json' };
    expect((await SELF.fetch(url, { method: 'POST', body: JSON.stringify(lookup()) })).status).toBe(401);
    expect((await SELF.fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...lookup(), title: 'Synthetic forbidden field' }) })).status).toBe(400);
    expect((await SELF.fetch(url, { method: 'POST', headers: { ...headers, Cookie: 'session=synthetic' }, body: JSON.stringify(lookup()) })).status).toBe(403);
    expect((await SELF.fetch(url, { method: 'POST', headers, body: ' '.repeat(65537) })).status).toBe(413);
    const response = await SELF.fetch(url, { method: 'POST', headers, body: JSON.stringify(lookup()) });
    expect(response.status).toBe(200);
    expect(favoriteCollectiveReceiptSchema.parse(await response.json()).results).toMatchObject([{ kind: 'MISS' }]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
