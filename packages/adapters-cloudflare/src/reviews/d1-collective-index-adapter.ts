import type {
  CollectiveAssociationRecord,
  CollectiveConsentRecord,
  CollectiveContributionResult,
  CollectiveIndexPort,
} from '@tobirink/application';

type SqlValue = null | number | string;

interface BoundD1Result {
  meta: { changes: number };
}

interface BoundD1PreparedStatement {
  bind(...values: SqlValue[]): BoundD1PreparedStatement;
  first<TResult>(): Promise<TResult | null>;
  run(): Promise<BoundD1Result>;
}

export interface BoundD1Database {
  prepare(query: string): BoundD1PreparedStatement;
}

const insertAssociationSql = `
  INSERT OR IGNORE INTO collective_associations (
    consent_id, canonical_work_id, provider, external_work_id, nonce, decided_at, received_at
  )
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
  WHERE EXISTS (
    SELECT 1 FROM collective_consents
    WHERE consent_id = ?1 AND write_token_hash = ?8 AND revoked_at IS NULL
  )
  AND (
    SELECT COUNT(*) FROM collective_associations
    WHERE consent_id = ?1 AND received_at >= ?9
  ) < ?10
`;

function utcDayStart(isoDate: string): string {
  return `${isoDate.slice(0, 10)}T00:00:00.000Z`;
}

export class D1CollectiveIndexAdapter implements CollectiveIndexPort {
  constructor(private readonly database: BoundD1Database) {}

  async createConsent(record: CollectiveConsentRecord): Promise<void> {
    await this.database.prepare(`
      INSERT INTO collective_consents (
        consent_id, write_token_hash, revoke_token_hash, created_at, revoked_at
      ) VALUES (?1, ?2, ?3, ?4, NULL)
    `).bind(record.consentId, record.writeTokenHash, record.revokeTokenHash, record.createdAt).run();
  }

  async recordAssociation(record: CollectiveAssociationRecord, dailyQuota: number): Promise<CollectiveContributionResult> {
    const insertion = await this.database.prepare(insertAssociationSql).bind(
      record.consentId,
      record.canonicalWorkId,
      record.provider,
      record.externalWorkId,
      record.nonce,
      record.decidedAt,
      record.receivedAt,
      record.writeTokenHash,
      utcDayStart(record.receivedAt),
      dailyQuota,
    ).run();
    if (insertion.meta.changes === 1) return 'accepted';

    const consent = await this.database.prepare(`
      SELECT revoked_at AS revokedAt FROM collective_consents
      WHERE consent_id = ?1 AND write_token_hash = ?2
    `).bind(record.consentId, record.writeTokenHash).first<{ revokedAt: string | null }>();
    if (!consent) return 'unauthorized';
    if (consent.revokedAt) return 'revoked';

    const duplicate = await this.database.prepare(`
      SELECT 1 AS found FROM collective_associations
      WHERE consent_id = ?1 AND nonce = ?2
    `).bind(record.consentId, record.nonce).first<{ found: number }>();
    if (duplicate) return 'duplicate';
    return 'quota-exceeded';
  }

  async revokeConsent(consentId: string, revokeTokenHash: string, revokedAt: string): Promise<boolean> {
    const result = await this.database.prepare(`
      UPDATE collective_consents SET revoked_at = ?3
      WHERE consent_id = ?1 AND revoke_token_hash = ?2 AND revoked_at IS NULL
    `).bind(consentId, revokeTokenHash, revokedAt).run();
    return result.meta.changes === 1;
  }
}
