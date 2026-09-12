import { bundledFavoriteSiteRules, collectiveDigest, favoriteCollectiveCommandSchema, favoriteCollectiveReceiptSchema, favoriteOwnerCredentialsSchema, favoriteOwnerRegistrationSchema, favoritePairRedemptionSchema, favoriteSiteRulesSchema } from '@tobirink/application';
import type { FavoriteCollectiveCommand, FavoriteCollectiveResponse, FavoriteCollectiveServicePort, FavoriteOwnerCredentials, FavoriteOwnerRegistration, FavoritePairRedemption } from '@tobirink/application';

type SqlValue = string | number | null;
interface Statement {
  bind(...values: SqlValue[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface FavoriteD1Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<readonly { meta: { changes: number } }[]> }

const authorizedSql = `SELECT 1 AS authorized FROM favorite_installations i JOIN favorite_owners o USING(owner_id)
  WHERE i.owner_id = ?1 AND i.installation_id = ?2 AND i.token_hash = ?3 AND o.revoked_at IS NULL`;
const reserveSql = `INSERT OR IGNORE INTO favorite_receipts(owner_id, nonce, digest, execution_id, received_at, response_json)
  SELECT ?1, ?4, ?5, ?6, ?7, ?8 WHERE EXISTS (
    SELECT 1 FROM favorite_installations i JOIN favorite_owners o USING(owner_id)
    WHERE i.owner_id = ?1 AND i.installation_id = ?2 AND i.token_hash = ?3 AND o.revoked_at IS NULL
  ) AND COALESCE((SELECT requests FROM favorite_daily_quotas WHERE owner_id = ?1 AND day = ?9), 0) < ?10`;
const quotaSql = `INSERT INTO favorite_daily_quotas(owner_id, day, requests)
  SELECT ?1, ?2, 1 WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?3 AND execution_id = ?4)
  ON CONFLICT(owner_id, day) DO UPDATE SET requests = requests - (-1)`;
const keysSql = `INSERT OR IGNORE INTO favorite_keys(key_id, fingerprint, media_kind, parser_version, rules_version)
  SELECT json_extract(value, '$.keyId'), json_extract(value, '$.key.fingerprint'), json_extract(value, '$.key.mediaKind'),
    json_extract(value, '$.key.parserVersion'), json_extract(value, '$.key.siteRulesVersion') FROM json_each(?1)
  WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?2 AND nonce = ?3 AND execution_id = ?4)`;
const choicesSql = `INSERT INTO favorite_choices(owner_id, key_id, identity_hash, media_kind, references_json, confirmed)
  SELECT ?2, json_extract(value, '$.keyId'), json_extract(value, '$.identityHash'), json_extract(value, '$.mediaKind'),
    json_extract(value, '$.references'), json_extract(value, '$.confirmed') FROM json_each(?1)
  WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?2 AND nonce = ?3 AND execution_id = ?4)
  ON CONFLICT(owner_id, key_id) DO UPDATE SET identity_hash = excluded.identity_hash, media_kind = excluded.media_kind,
    references_json = excluded.references_json, confirmed = excluded.confirmed
  WHERE favorite_choices.confirmed = 0 OR excluded.confirmed = 1`;
const ambiguitiesSql = `INSERT INTO favorite_ambiguity_sets(owner_id, key_id, identities_json, updated_at)
  SELECT ?2, json_extract(value, '$.keyId'), json_extract(value, '$.identities'), ?5 FROM json_each(?1)
  WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?2 AND nonce = ?3 AND execution_id = ?4)
  ON CONFLICT(owner_id, key_id) DO UPDATE SET identities_json = excluded.identities_json, updated_at = excluded.updated_at`;
const decisionsSql = `INSERT OR IGNORE INTO favorite_decisions(owner_id, nonce, choices_json)
  SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?2 AND execution_id = ?4)`;
const publicCacheSql = `INSERT OR IGNORE INTO favorite_public_cache(
    fingerprint, media_kind, identity_hash, parser_version, rules_version, references_json, metadata_json, created_at)
  SELECT json_extract(value, '$.key.fingerprint'), json_extract(value, '$.mediaKind'), json_extract(value, '$.identityHash'),
    json_extract(value, '$.key.parserVersion'), json_extract(value, '$.key.siteRulesVersion'), json_extract(value, '$.references'),
    json_extract(value, '$.metadata'), ?5 FROM json_each(?1)
  WHERE json_type(value, '$.metadata') = 'object'
    AND EXISTS (SELECT 1 FROM favorite_confirmations confirmation
      WHERE confirmation.key_id = json_extract(value, '$.keyId')
        AND confirmation.identity_hash = json_extract(value, '$.identityHash') AND confirmation.owner_count >= 2)
    AND EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?2 AND nonce = ?3 AND execution_id = ?4)`;

// Each key reads one owner row or at most two indexed, active shared identities.
export const favoriteLookupReceiptSql = `UPDATE favorite_receipts SET response_json = json_set(response_json, '$.results', json((
  SELECT json_group_array(json(COALESCE(
    (SELECT json_object('kind', 'FOUND', 'fingerprint', json_extract(k.value, '$.fingerprint'), 'scope', 'owner', 'mediaKind', c.media_kind, 'references', json(c.references_json))
      FROM favorite_choices c WHERE c.owner_id = ?1 AND c.key_id = json_extract(k.value, '$.keyId')),
    (SELECT json_object('kind', 'AMBIGUOUS', 'fingerprint', json_extract(k.value, '$.fingerprint'), 'scope', 'owner', 'identities', json(a.identities_json))
      FROM favorite_ambiguity_sets a WHERE a.owner_id = ?1 AND a.key_id = json_extract(k.value, '$.keyId')),
    (SELECT CASE WHEN COUNT(*) = 1 AND MIN(owner_count) >= 2 THEN json_object('kind', 'FOUND', 'fingerprint', json_extract(k.value, '$.fingerprint'), 'scope', 'shared', 'mediaKind', MIN(media_kind), 'references', json(MIN(references_json))) END
      FROM (SELECT owner_count, media_kind, references_json FROM favorite_confirmations
        WHERE key_id = json_extract(k.value, '$.keyId') AND owner_count > 0 ORDER BY identity_hash LIMIT 2)),
    json_object('kind', 'MISS', 'fingerprint', json_extract(k.value, '$.fingerprint'))
  ))) FROM json_each(?4) k
))) WHERE owner_id = ?1 AND nonce = ?2 AND execution_id = ?3`;

export class D1FavoriteCollectiveAdapter implements FavoriteCollectiveServicePort {
  constructor(private readonly database: FavoriteD1Database, private readonly now: () => number = Date.now) {}

  async readRules() {
    const row = await this.database.prepare('SELECT revision, document_json AS document, digest FROM favorite_site_rules WHERE published = 1 ORDER BY revision DESC LIMIT 1').first<{ revision: number; document: string; digest: string }>();
    if (row === null) return bundledFavoriteSiteRules;
    if (new TextEncoder().encode(row.document).byteLength > 65536 || await collectiveDigest(row.document) !== row.digest) throw new Error('Invalid published rule document.');
    const rules = favoriteSiteRulesSchema.parse(JSON.parse(row.document));
    if (rules.version !== row.revision) throw new Error('Rule revision mismatch.');
    return rules;
  }

  async register(input: FavoriteOwnerRegistration): Promise<boolean> {
    const registration = favoriteOwnerRegistrationSchema.parse(input);
    const revokeHash = await collectiveDigest(registration.revokeToken);
    const tokenHash = await collectiveDigest(registration.token);
    const now = this.now();
    await this.database.batch([
      this.database.prepare('INSERT OR IGNORE INTO favorite_owners(owner_id, revoke_hash, created_at) VALUES (?1, ?2, ?3)').bind(registration.ownerId, revokeHash, now),
      this.database.prepare(`INSERT OR IGNORE INTO favorite_installations(owner_id, installation_id, token_hash, created_at)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM favorite_owners WHERE owner_id = ?1 AND revoke_hash = ?5 AND revoked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM favorite_installations WHERE owner_id = ?1 LIMIT 1)`)
        .bind(registration.ownerId, registration.installationId, tokenHash, now, revokeHash),
    ]);
    return (await this.database.prepare(authorizedSql).bind(registration.ownerId, registration.installationId, tokenHash).first()) !== null;
  }

  async redeem(input: FavoritePairRedemption): Promise<boolean> {
    const redemption = favoritePairRedemptionSchema.parse(input);
    const pairHash = await collectiveDigest(redemption.pairingToken);
    const tokenHash = await collectiveDigest(redemption.token);
    const now = this.now();
    await this.database.batch([
      this.database.prepare(`INSERT OR IGNORE INTO favorite_installations(owner_id, installation_id, token_hash, created_at)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM favorite_pairings p JOIN favorite_owners o USING(owner_id)
          WHERE p.owner_id = ?1 AND p.token_hash = ?5 AND p.expires_at > ?4 AND p.consumed_by IS NULL AND o.revoked_at IS NULL)
        AND (SELECT COUNT(*) FROM (SELECT 1 FROM favorite_installations WHERE owner_id = ?1 LIMIT 16)) < 16`)
        .bind(redemption.ownerId, redemption.installationId, tokenHash, now, pairHash),
      this.database.prepare(`UPDATE favorite_pairings SET consumed_by = ?2 WHERE owner_id = ?1 AND token_hash = ?3
        AND consumed_by IS NULL AND expires_at > ?4 AND EXISTS (SELECT 1 FROM favorite_installations WHERE owner_id = ?1 AND installation_id = ?2 AND token_hash = ?5)`)
        .bind(redemption.ownerId, redemption.installationId, pairHash, now, tokenHash),
    ]);
    return (await this.database.prepare(`SELECT 1 FROM favorite_pairings p JOIN favorite_installations i USING(owner_id)
      JOIN favorite_owners o USING(owner_id) WHERE p.owner_id = ?1 AND p.token_hash = ?2 AND p.consumed_by = ?3
      AND i.installation_id = ?3 AND i.token_hash = ?4 AND o.revoked_at IS NULL`).bind(redemption.ownerId, pairHash, redemption.installationId, tokenHash).first()) !== null;
  }

  async execute(input: FavoriteOwnerCredentials, value: FavoriteCollectiveCommand, dailyQuota: number): Promise<FavoriteCollectiveResponse> {
    const credentials = favoriteOwnerCredentialsSchema.parse(input);
    const command = favoriteCollectiveCommandSchema.parse(value);
    if (!Number.isSafeInteger(dailyQuota) || dailyQuota < 1 || dailyQuota > 10000) throw new Error('Invalid owner quota.');
    const tokenHash = await collectiveDigest(credentials.token);
    const digest = await collectiveDigest(JSON.stringify(command));
    const owner = await this.database.prepare(`SELECT o.revoked_at AS revokedAt FROM favorite_installations i JOIN favorite_owners o USING(owner_id)
      WHERE i.owner_id = ?1 AND i.installation_id = ?2 AND i.token_hash = ?3`).bind(credentials.ownerId, credentials.installationId, tokenHash).first<{ revokedAt: number | null }>();
    if (owner === null) return { kind: 'UNAUTHORIZED' };
    if (owner.revokedAt !== null) {
      if (command.operation !== 'revoke') return { kind: 'UNAUTHORIZED' };
      const previous = await this.database.prepare('SELECT digest, response_json AS response FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?2').bind(credentials.ownerId, command.nonce).first<{ digest: string; response: string }>();
      return previous?.digest === digest ? { kind: 'ACCEPTED', receipt: favoriteCollectiveReceiptSchema.parse(JSON.parse(previous.response)) } : { kind: 'UNAUTHORIZED' };
    }
    const executionId = crypto.randomUUID();
    const now = this.now();
    const receipt = favoriteCollectiveReceiptSchema.parse({ schemaVersion: 2, nonce: command.nonce, digest, receivedAt: now, results: [] });
    const day = Math.floor(now / 86400000);
    const statements = [
      this.database.prepare(reserveSql).bind(credentials.ownerId, credentials.installationId, tokenHash, command.nonce, digest, executionId, now, JSON.stringify(receipt), day, dailyQuota),
      this.database.prepare(quotaSql).bind(credentials.ownerId, day, command.nonce, executionId),
    ];
    const ownerId = credentials.ownerId;
    if (command.operation === 'contribute') {
      const choices = await Promise.all(command.choices.map(async (choice) => {
        const references = [...choice.references].sort((a, b) => a.provider < b.provider ? -1 : 1);
        return { ...choice, references, keyId: await collectiveDigest(JSON.stringify([2, choice.key.mediaKind, choice.key.fingerprint, choice.key.parserVersion, choice.key.siteRulesVersion])), identityHash: await collectiveDigest(JSON.stringify([choice.mediaKind, references])) };
      }));
      const ambiguities = await Promise.all((command.ambiguities ?? []).map(async (ambiguity) => {
        const identities = ambiguity.identities.map((identity) => ({ ...identity, references: [...identity.references].sort((a, b) => a.provider.localeCompare(b.provider)) }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        return { ...ambiguity, identities, keyId: await collectiveDigest(JSON.stringify([2, ambiguity.key.mediaKind, ambiguity.key.fingerprint, ambiguity.key.parserVersion, ambiguity.key.siteRulesVersion])) };
      }));
      const payload = JSON.stringify(choices);
      const ambiguityPayload = JSON.stringify(ambiguities);
      const keysPayload = JSON.stringify([...choices, ...ambiguities]);
      statements.push(this.database.prepare(keysSql).bind(keysPayload, ownerId, command.nonce, executionId));
      if (choices.length > 0) statements.push(this.database.prepare(choicesSql).bind(payload, ownerId, command.nonce, executionId), this.database.prepare(publicCacheSql).bind(payload, ownerId, command.nonce, executionId, now));
      if (ambiguities.length > 0) statements.push(this.database.prepare(ambiguitiesSql).bind(ambiguityPayload, ownerId, command.nonce, executionId, now));
      statements.push(this.database.prepare(decisionsSql).bind(ownerId, command.nonce, JSON.stringify({ choices, ambiguities }), executionId));
    } else if (command.operation === 'lookup') {
      const keys = await Promise.all(command.keys.map(async (key) => ({ ...key, keyId: await collectiveDigest(JSON.stringify([2, key.mediaKind, key.fingerprint, key.parserVersion, key.siteRulesVersion])) })));
      statements.push(this.database.prepare(favoriteLookupReceiptSql).bind(ownerId, command.nonce, executionId, JSON.stringify(keys)));
    } else if (command.operation === 'pair') {
      statements.push(this.database.prepare(`INSERT OR IGNORE INTO favorite_pairings(owner_id, token_hash, expires_at)
        SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?4 AND execution_id = ?5)`)
        .bind(ownerId, await collectiveDigest(command.pairingToken), now + 300000, command.nonce, executionId));
    } else {
      statements.push(this.database.prepare(`UPDATE favorite_owners SET revoked_at = ?2 WHERE owner_id = ?1
        AND EXISTS (SELECT 1 FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?3 AND execution_id = ?4)`)
        .bind(ownerId, now, command.nonce, executionId));
    }
    await this.database.batch(statements);
    const stored = await this.database.prepare('SELECT digest, response_json AS response FROM favorite_receipts WHERE owner_id = ?1 AND nonce = ?2').bind(ownerId, command.nonce).first<{ digest: string; response: string }>();
    if (stored === null) return { kind: 'QUOTA_EXCEEDED' };
    if (stored.digest !== digest) return { kind: 'REPLAY' };
    return { kind: 'ACCEPTED', receipt: favoriteCollectiveReceiptSchema.parse(JSON.parse(stored.response)) };
  }
}
