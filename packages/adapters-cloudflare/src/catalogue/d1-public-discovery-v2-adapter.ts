import {
  publicDiscoveryClaimedRequestSchema,
  publicDiscoveryRequestSchema,
  publicDiscoveryResultBatchSchema,
  publicDiscoveryTerminalResolutionSchema,
  publicDiscoveryVerifiedProfileSchema,
  type PublicDiscoveryClaimBatch,
  type PublicDiscoveryKeyV2,
  type PublicDiscoveryReadState,
  type PublicDiscoveryRequest,
  type PublicDiscoveryResult,
  type PublicDiscoveryResultBatch,
  type PublicDiscoveryVerifiedProfile,
} from '@tobirink/public-discovery';

type SqlValue = null | number | string;
interface Statement {
  all<TResult>(): Promise<{ results: TResult[] }>;
  bind(...values: SqlValue[]): Statement;
  first<TResult>(): Promise<TResult | null>;
}
export interface PublicDiscoveryV2D1Database {
  batch(statements: Statement[]): Promise<readonly { success: boolean }[]>;
  prepare(query: string): Statement;
}
interface DiscoveryRow {
  attemptCount: number;
  claimTokenHash: string | null;
  requestDigest: string;
  requestJson: string;
  resultJson: string | null;
  retryAt: string;
  state: 'PENDING' | 'PROCESSING' | 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS';
  verifiedAt: string | null;
}
export interface PublicDiscoveryV2Port {
  claimBatch(input: { claimToken: string; leaseUntil: string; limit: number; now: string; tokenDigest: string }): Promise<PublicDiscoveryClaimBatch>;
  publishBatch(batch: PublicDiscoveryResultBatch, tokenDigest: string, resultDigest: string): Promise<{ published: number; replayed: number }>;
  read(key: PublicDiscoveryKeyV2, now: string): Promise<PublicDiscoveryReadState>;
  request(request: PublicDiscoveryRequest, now: string): Promise<PublicDiscoveryReadState>;
}

function keyValues(key: PublicDiscoveryKeyV2): [string, string, string, string] {
  return [key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion];
}
function stateFromRow(row: DiscoveryRow | null, now: string): PublicDiscoveryReadState {
  if (!row) return { state: 'MISS' };
  if (row.state === 'PENDING' || row.state === 'PROCESSING') {
    const floor = new Date(Date.parse(now) + 60_000).toISOString();
    return { retryAt: Date.parse(row.retryAt) > Date.parse(now) ? row.retryAt : floor, state: 'PENDING' };
  }
  if (!row.resultJson || !row.verifiedAt) throw new Error('invalid-terminal-public-discovery');
  const resolution = publicDiscoveryTerminalResolutionSchema.parse(JSON.parse(row.resultJson));
  if (resolution.state === 'VERIFIED') return { profile: resolution.profile, state: 'VERIFIED', verifiedAt: row.verifiedAt };
  if (resolution.state === 'NOT_FOUND') return { reason: resolution.reason, state: 'NOT_FOUND', verifiedAt: row.verifiedAt };
  return { candidates: resolution.candidates, reason: resolution.reason, state: 'AMBIGUOUS', verifiedAt: row.verifiedAt };
}

export class D1PublicDiscoveryV2Adapter implements PublicDiscoveryV2Port {
  constructor(private readonly database: PublicDiscoveryV2D1Database) {}

  private row(key: PublicDiscoveryKeyV2): Promise<DiscoveryRow | null> {
    return this.database.prepare(`SELECT attempt_count AS attemptCount, claim_token_hash AS claimTokenHash,
      request_digest AS requestDigest, request_json AS requestJson, result_json AS resultJson,
      retry_at AS retryAt, state, verified_at AS verifiedAt FROM public_discovery_requests_v2
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4 LIMIT 1`)
      .bind(...keyValues(key)).first<DiscoveryRow>();
  }

  async read(key: PublicDiscoveryKeyV2, now: string): Promise<PublicDiscoveryReadState> {
    return stateFromRow(await this.row(key), now);
  }

  async request(input: PublicDiscoveryRequest, now: string): Promise<PublicDiscoveryReadState> {
    const request = publicDiscoveryRequestSchema.parse(input);
    await this.database.prepare(`INSERT INTO public_discovery_requests_v2(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, retry_at, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'PENDING', ?7, ?7, ?7)
    ON CONFLICT(fingerprint, media_kind, parser_version, rules_version) DO NOTHING`)
      .bind(...keyValues(request.key), request.requestDigest, JSON.stringify(request), now).first();
    const row = await this.row(request.key);
    if (!row || row.requestDigest !== request.requestDigest) throw new Error('public-discovery-request-conflict');
    return stateFromRow(row, now);
  }

  async claimBatch(input: { claimToken: string; leaseUntil: string; limit: number; now: string; tokenDigest: string }): Promise<PublicDiscoveryClaimBatch> {
    const rows = await this.database.prepare(`UPDATE public_discovery_requests_v2 SET
      state = 'PROCESSING', claim_token_hash = ?1, lease_until = ?2,
      attempt_count = attempt_count + 1, retry_at = ?2, updated_at = ?3
      WHERE rowid IN (SELECT rowid FROM public_discovery_requests_v2
        WHERE ((state = 'PENDING' AND retry_at <= ?3) OR (state = 'PROCESSING' AND lease_until <= ?3))
          AND attempt_count < 8 ORDER BY updated_at, fingerprint LIMIT ?4)
      RETURNING request_json AS requestJson, attempt_count AS attemptCount`)
      .bind(input.tokenDigest, input.leaseUntil, input.now, input.limit)
      .all<{ attemptCount: number; requestJson: string }>();
    const requests = rows.results.map((row) => {
      const request = publicDiscoveryRequestSchema.parse(JSON.parse(row.requestJson));
      return publicDiscoveryClaimedRequestSchema.parse({ ...request, attempt: row.attemptCount });
    });
    return { claimToken: input.claimToken, requests, schemaVersion: 2 };
  }

  private async catalogueStatements(profile: PublicDiscoveryVerifiedProfile, verifiedAt: string): Promise<Statement[]> {
    for (const reference of profile.references) {
      const conflict = await this.database.prepare('SELECT work_id AS workId FROM catalogue_external_references WHERE provider = ?1 AND external_id = ?2 LIMIT 1')
        .bind(reference.provider, reference.externalId).first<{ workId: string }>();
      if (conflict && conflict.workId !== profile.workId) throw new Error('public-discovery-reference-conflict');
    }
    const revision = Math.max(1, Date.parse(verifiedAt));
    const candidate = profile.candidate;
    return [
      this.database.prepare('INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(revision, verifiedAt),
      this.database.prepare(`INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(work_id) DO UPDATE SET media_kind = excluded.media_kind,
        preferred_title = excluded.preferred_title, revision = excluded.revision`)
        .bind(profile.workId, candidate.mediaKind === 'ANIME' ? 'anime' : 'manga', candidate.displayTitle ?? candidate.titles[0] ?? candidate.externalId, revision),
      ...candidate.titles.map((title) => this.database.prepare('INSERT OR IGNORE INTO catalogue_titles(work_id, locale, title) VALUES (?1, ?2, ?3)').bind(profile.workId, 'und', title)),
      ...profile.references.map((reference) => this.database.prepare('INSERT OR IGNORE INTO catalogue_external_references(provider, external_id, work_id) VALUES (?1, ?2, ?3)').bind(reference.provider, reference.externalId, profile.workId)),
    ];
  }

  private async publishOne(result: PublicDiscoveryResult, tokenDigest: string, verifiedAt: string): Promise<'published' | 'replayed'> {
    const row = await this.row(result.key);
    const resultJson = JSON.stringify(result.resolution);
    if (row && row.state === result.resolution.state && row.requestDigest === result.requestDigest && row.resultJson === resultJson) return 'replayed';
    if (!row || row.state !== 'PROCESSING' || row.claimTokenHash !== tokenDigest || row.requestDigest !== result.requestDigest) throw new Error('stale-public-discovery-result');
    const statements = result.resolution.state === 'VERIFIED'
      ? await this.catalogueStatements(publicDiscoveryVerifiedProfileSchema.parse(result.resolution.profile), verifiedAt)
      : [];
    statements.push(this.database.prepare(`UPDATE public_discovery_requests_v2 SET
      state = ?5, result_json = ?6, verified_at = ?7, retry_at = ?7,
      claim_token_hash = NULL, lease_until = NULL, updated_at = ?7
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state = 'PROCESSING' AND claim_token_hash = ?8 AND request_digest = ?9`)
      .bind(...keyValues(result.key), result.resolution.state, resultJson, verifiedAt, tokenDigest, result.requestDigest));
    await this.database.batch(statements);
    return 'published';
  }

  async publishBatch(input: PublicDiscoveryResultBatch, tokenDigest: string, resultDigest: string) {
    const batch = publicDiscoveryResultBatchSchema.parse(input);
    const nonce = await this.database.prepare('SELECT result_digest AS resultDigest FROM public_discovery_result_nonces_v2 WHERE nonce = ?1 LIMIT 1')
      .bind(batch.nonce).first<{ resultDigest: string }>();
    if (nonce) {
      if (nonce.resultDigest !== resultDigest) throw new Error('public-discovery-nonce-conflict');
      return { published: 0, replayed: batch.results.length };
    }
    let published = 0;
    let replayed = 0;
    for (const result of batch.results) {
      if (await this.publishOne(result, tokenDigest, batch.verifiedAt) === 'published') published += 1;
      else replayed += 1;
    }
    await this.database.prepare('INSERT INTO public_discovery_result_nonces_v2(nonce, result_digest, created_at) VALUES (?1, ?2, ?3)')
      .bind(batch.nonce, resultDigest, batch.verifiedAt).first();
    return { published, replayed };
  }
}
