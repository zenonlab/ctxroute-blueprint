import {
  publicDiscoveryKeySchema,
  publicDiscoveryProfileSchema,
  publicDiscoveryReferenceSchema,
  type PublicDiscoveryKey,
  type PublicDiscoveryPort,
  type PublicDiscoveryPromotion,
  type PublicDiscoveryProposal,
  type PublicDiscoveryState,
} from '@tobirink/application';

type SqlValue = null | number | string;
interface Statement {
  all<TResult>(): Promise<{ results: TResult[] }>;
  bind(...values: SqlValue[]): Statement;
  first<TResult>(): Promise<TResult | null>;
}
export interface PublicDiscoveryD1Database {
  batch(statements: Statement[]): Promise<readonly { success: boolean }[]>;
  prepare(query: string): Statement;
}

interface DiscoveryRow {
  leaseTokenHash: string | null;
  profileJson: string | null;
  retryAt: string;
  state: 'PENDING_SEARCH' | 'PENDING_VERIFICATION' | 'VERIFIED';
  verifiedAt: string | null;
}

function keyValues(key: PublicDiscoveryKey): [string, string, string, string] {
  return [key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion];
}

function publicState(row: DiscoveryRow | null, now: string): PublicDiscoveryState {
  if (!row) return { state: 'MISS' };
  if (row.state !== 'VERIFIED') {
    const minimumRetryAt = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    return { retryAt: Date.parse(row.retryAt) > Date.parse(now) ? row.retryAt : minimumRetryAt, state: 'PENDING' };
  }
  if (!row.profileJson || !row.verifiedAt) throw new Error('invalid-verified-discovery');
  return { profile: publicDiscoveryProfileSchema.parse(JSON.parse(row.profileJson)), state: 'VERIFIED', verifiedAt: row.verifiedAt };
}

export class D1PublicDiscoveryAdapter implements PublicDiscoveryPort {
  constructor(private readonly database: PublicDiscoveryD1Database) {}

  private async row(key: PublicDiscoveryKey): Promise<DiscoveryRow | null> {
    return this.database.prepare(`SELECT state, lease_token_hash AS leaseTokenHash, profile_json AS profileJson,
      retry_at AS retryAt, verified_at AS verifiedAt FROM public_discovery_claims
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4 LIMIT 1`)
      .bind(...keyValues(key)).first<DiscoveryRow>();
  }

  async read(input: PublicDiscoveryKey, now: string): Promise<PublicDiscoveryState> {
    return publicState(await this.row(publicDiscoveryKeySchema.parse(input)), now);
  }

  async claim(input: PublicDiscoveryKey, lease: { expiresAt: string; tokenDigest: string }, now: string) {
    const key = publicDiscoveryKeySchema.parse(input);
    const row = await this.database.prepare(`INSERT INTO public_discovery_claims(
      fingerprint, media_kind, parser_version, rules_version, state, lease_token_hash, lease_until,
      attempt_count, retry_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, 'PENDING_SEARCH', ?5, ?6, 1, ?6, ?7, ?7)
    ON CONFLICT(fingerprint, media_kind, parser_version, rules_version) DO UPDATE SET
      lease_token_hash = excluded.lease_token_hash, lease_until = excluded.lease_until,
      attempt_count = public_discovery_claims.attempt_count + 1,
      retry_at = excluded.retry_at, updated_at = excluded.updated_at
    WHERE public_discovery_claims.state = 'PENDING_SEARCH'
      AND public_discovery_claims.lease_until <= ?7
      AND public_discovery_claims.attempt_count < 8
    RETURNING state, lease_token_hash AS leaseTokenHash, profile_json AS profileJson,
      retry_at AS retryAt, verified_at AS verifiedAt`)
      .bind(...keyValues(key), lease.tokenDigest, lease.expiresAt, now).first<DiscoveryRow>();
    if (row?.leaseTokenHash === lease.tokenDigest) return { ...publicState(row, now), leaseGranted: true };
    return publicState(await this.row(key), now);
  }

  async propose(input: PublicDiscoveryProposal, tokenDigest: string, proposalDigest: string, now: string): Promise<boolean> {
    const retryAt = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    const result = await this.database.prepare(`UPDATE public_discovery_claims SET
      state = 'PENDING_VERIFICATION', references_json = ?5, proposal_digest = ?6,
      lease_token_hash = NULL, lease_until = NULL, retry_at = ?7, updated_at = ?8
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state = 'PENDING_SEARCH' AND lease_token_hash = ?9 AND lease_until > ?8
      RETURNING fingerprint`)
      .bind(...keyValues(input.key), JSON.stringify(input.references), proposalDigest, retryAt, now, tokenDigest)
      .first<{ fingerprint: string }>();
    return result !== null;
  }

  async listPending(limit: number) {
    const rows = await this.database.prepare(`SELECT fingerprint, media_kind AS mediaKind,
      parser_version AS parserVersion, rules_version AS siteRulesVersion,
      references_json AS referencesJson, proposal_digest AS proposalDigest
      FROM public_discovery_claims WHERE state = 'PENDING_VERIFICATION'
      ORDER BY updated_at, fingerprint LIMIT ?1`).bind(limit).all<{
        fingerprint: string; mediaKind: string; parserVersion: string; proposalDigest: string;
        referencesJson: string; siteRulesVersion: string;
    }>();
    return rows.results.map((row) => ({
      key: publicDiscoveryKeySchema.parse({
        fingerprint: row.fingerprint,
        mediaKind: row.mediaKind,
        parserVersion: row.parserVersion,
        siteRulesVersion: row.siteRulesVersion,
      }),
      proposalDigest: row.proposalDigest,
      references: publicDiscoveryReferenceSchema.array().max(5).parse(JSON.parse(row.referencesJson)),
    }));
  }

  async promote(promotions: readonly PublicDiscoveryPromotion[]) {
    let promoted = 0;
    let replayed = 0;
    for (const promotion of promotions) {
      const profileJson = JSON.stringify(publicDiscoveryProfileSchema.parse(promotion.profile));
      const current = await this.database.prepare(`SELECT state, proposal_digest AS proposalDigest,
        profile_json AS profileJson, references_json AS referencesJson
        FROM public_discovery_claims
        WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4 LIMIT 1`)
        .bind(...keyValues(promotion.key)).first<{ profileJson: string | null; proposalDigest: string | null; referencesJson: string; state: string }>();
      if (current?.state === 'VERIFIED' && current.proposalDigest === promotion.proposalDigest && current.profileJson === profileJson) {
        replayed += 1;
        continue;
      }
      if (current?.state !== 'PENDING_VERIFICATION' || current.proposalDigest !== promotion.proposalDigest) throw new Error('stale-public-discovery-promotion');
      const proposed = publicDiscoveryReferenceSchema.array().max(5).parse(JSON.parse(current.referencesJson));
      if (!promotion.profile.references.some((reference) => proposed.some((candidate) => candidate.provider === reference.provider && candidate.externalId === reference.externalId))) {
        throw new Error('unproposed-public-discovery-reference');
      }
      for (const reference of promotion.profile.references) {
        const conflict = await this.database.prepare('SELECT work_id AS workId FROM catalogue_external_references WHERE provider = ?1 AND external_id = ?2 LIMIT 1')
          .bind(reference.provider, reference.externalId).first<{ workId: string }>();
        if (conflict && conflict.workId !== promotion.profile.workId) throw new Error('public-discovery-reference-conflict');
      }
      const revision = Math.max(1, Date.parse(promotion.verifiedAt));
      const statements: Statement[] = [
        this.database.prepare('INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(revision, promotion.verifiedAt),
        this.database.prepare(`INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)
          ON CONFLICT(work_id) DO UPDATE SET media_kind = excluded.media_kind,
          preferred_title = excluded.preferred_title, revision = excluded.revision`).bind(promotion.profile.workId, promotion.profile.mediaKind, promotion.profile.preferredTitle, revision),
        ...promotion.profile.officialTitles.map((title) => this.database.prepare('INSERT OR IGNORE INTO catalogue_titles(work_id, locale, title) VALUES (?1, ?2, ?3)').bind(promotion.profile.workId, title.locale, title.title)),
        ...promotion.profile.references.map((reference) => this.database.prepare('INSERT OR IGNORE INTO catalogue_external_references(provider, external_id, work_id) VALUES (?1, ?2, ?3)').bind(reference.provider, reference.externalId, promotion.profile.workId)),
        this.database.prepare(`UPDATE public_discovery_claims SET state = 'VERIFIED', profile_json = ?5,
          work_id = ?6, verified_at = ?7, retry_at = ?7, updated_at = ?7
          WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
            AND state = 'PENDING_VERIFICATION' AND proposal_digest = ?8`)
          .bind(...keyValues(promotion.key), profileJson, promotion.profile.workId, promotion.verifiedAt, promotion.proposalDigest),
      ];
      await this.database.batch(statements);
      promoted += 1;
    }
    return { promoted, replayed };
  }
}
