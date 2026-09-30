import {
  publicDiscoveryClaimedRequestSchema,
  publicDiscoveryKeyV3Schema,
  publicDiscoveryRequestSchema,
  publicDiscoveryResultBatchSchema,
  publicDiscoverySearchProgressSchema,
  publicDiscoveryTerminalResolutionSchema,
  publicDiscoveryVerifiedProfileSchema,
  type PublicDiscoveryClaimBatch,
  type PublicDiscoveryClaimedRequest,
  type PublicDiscoveryCandidate,
  type PublicDiscoveryKeyV3,
  type PublicDiscoveryReadState,
  type PublicDiscoveryRequest,
  type PublicDiscoveryResult,
  type PublicDiscoveryResultBatch,
  type PublicDiscoverySearchProgress,
  type PublicDiscoveryVerifiedProfile,
} from '@tobirink/public-discovery';
import { favoriteTitlePreparationVersion, normalizeFavoriteTitle } from '@tobirink/application';

export const publicDiscoveryPendingLimit = 5_000;
const failedRetentionMilliseconds = 30 * 86_400_000;
const negativeResultFreshnessMilliseconds = 7 * 86_400_000;
const nonceRetentionMilliseconds = 7 * 86_400_000;
const queueSignalLeaseMilliseconds = 60_000;
const continuationOwnershipMilliseconds = 15 * 60_000;
const refreshFreshnessMilliseconds = 7 * 86_400_000;

type SqlValue = null | number | string;
interface Statement {
  all<TResult>(): Promise<{ results: TResult[] }>;
  bind(...values: SqlValue[]): Statement;
  first<TResult>(): Promise<TResult | null>;
}
interface StatementResult {
  meta: { changes: number };
  success: boolean;
}
export interface PublicDiscoveryV3D1Database {
  batch(statements: Statement[]): Promise<readonly StatementResult[]>;
  prepare(query: string): Statement;
}
interface DiscoveryRow {
  attemptCount: number;
  claimTokenHash: string | null;
  failureReason: 'ATTEMPT_LIMIT' | null;
  leaseUntil: string | null;
  requestDigest: string;
  requestJson: string;
  searchProgressJson: string | null;
  refreshAttemptCount: number;
  refreshState: 'IDLE' | 'PENDING' | 'PROCESSING';
  nextRefreshAt: string | null;
  resultExpiresAt: string | null;
  resultJson: string | null;
  retryAt: string;
  state: 'PENDING' | 'PROCESSING' | 'FAILED' | 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS';
  verifiedAt: string | null;
}
export type PublicDiscoveryAdmission =
  | { outcome: 'created' | 'existing'; state: PublicDiscoveryReadState }
  | { outcome: 'saturated' };
export type PublicDiscoveryRefreshAdmission = {
  outcome: 'created' | 'existing';
  requestDigest: string;
  state: Extract<PublicDiscoveryReadState, { state: 'VERIFIED' }>;
};
interface CanonicalFacts {
  mediaKind: 'anime' | 'manga';
  normalizedTitles: readonly string[];
  workId: string;
}
export interface PublicDiscoveryV3Port {
  claimBatch(input: { claimToken: string; continuationTokenDigest?: string; key?: PublicDiscoveryKeyV3; leaseUntil: string; limit: number; now: string; tokenDigest: string }): Promise<PublicDiscoveryClaimBatch>;
  deferClaim(request: PublicDiscoveryClaimedRequest, tokenDigest: string, retryAt: string, now: string, searchProgress?: PublicDiscoverySearchProgress): Promise<void>;
  confirmQueueSignal(key: PublicDiscoveryKeyV3, requestDigest: string, now: string): Promise<void>;
  publishBatch(batch: PublicDiscoveryResultBatch, tokenDigest: string, resultDigest: string, now: string): Promise<{ published: number; replayed: number }>;
  read(key: PublicDiscoveryKeyV3, now: string): Promise<PublicDiscoveryReadState>;
  readMany?(keys: readonly PublicDiscoveryKeyV3[], now: string): Promise<readonly { key: PublicDiscoveryKeyV3; state: PublicDiscoveryReadState }[]>;
  requestRefresh(key: PublicDiscoveryKeyV3, now: string, admissionTokenDigest?: string): Promise<PublicDiscoveryRefreshAdmission>;
  releaseQueueSignal(key: PublicDiscoveryKeyV3, requestDigest: string, now: string): Promise<void>;
  request(request: PublicDiscoveryRequest, now: string, admissionTokenDigest?: string): Promise<PublicDiscoveryAdmission>;
  nextPendingAt?(continuationTokenDigest?: string): Promise<string | undefined>;
}

function keyValues(key: PublicDiscoveryKeyV3): [string, string, string, string] {
  return [key.fingerprint, key.mediaKind, key.parserVersion, key.siteRulesVersion];
}
function futureIso(now: string, milliseconds: number): string {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new TypeError('invalid-public-discovery-time');
  return new Date(timestamp + milliseconds).toISOString();
}
function stateFromRow(row: DiscoveryRow | null, now: string): PublicDiscoveryReadState {
  if (!row) return { state: 'MISS' };
  if ((row.state === 'NOT_FOUND' || row.state === 'AMBIGUOUS') && row.resultExpiresAt !== null && row.resultExpiresAt <= now) {
    return { state: 'MISS' };
  }
  if (row.state === 'FAILED') {
    if (row.failureReason !== 'ATTEMPT_LIMIT') throw new Error('invalid-failed-public-discovery');
    return { reason: row.failureReason, state: 'UNAVAILABLE' };
  }
  if (row.state === 'PENDING' || row.state === 'PROCESSING') {
    return { retryAt: row.leaseUntil !== null && row.leaseUntil > row.retryAt ? row.leaseUntil : row.retryAt, state: 'PENDING' };
  }
  if (!row.resultJson || !row.verifiedAt) throw new Error('invalid-terminal-public-discovery');
  const resolution = publicDiscoveryTerminalResolutionSchema.parse(JSON.parse(row.resultJson));
  if (resolution.state === 'VERIFIED') {
    if (!row.nextRefreshAt) throw new Error('invalid-verified-refresh-time');
    return { nextRefreshAt: row.nextRefreshAt, profile: resolution.profile, state: 'VERIFIED', verifiedAt: row.verifiedAt };
  }
  if (resolution.state === 'NOT_FOUND') return { reason: resolution.reason, state: 'NOT_FOUND', verifiedAt: row.verifiedAt };
  return { candidates: resolution.candidates, reason: resolution.reason, state: 'AMBIGUOUS', verifiedAt: row.verifiedAt };
}

function mergeProfile(current: PublicDiscoveryVerifiedProfile | undefined, incoming: PublicDiscoveryVerifiedProfile): PublicDiscoveryVerifiedProfile {
  if (current === undefined) return incoming;
  if (current.workId !== incoming.workId || current.candidate.mediaKind !== incoming.candidate.mediaKind) {
    throw new Error('public-discovery-metadata-identity-conflict');
  }
  const references = [...new Map([...current.references, ...incoming.references]
    .map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
  const candidate: PublicDiscoveryCandidate = { ...current.candidate, ...Object.fromEntries(Object.entries(incoming.candidate).filter(([, value]) => value !== undefined)), linkedReferences: incoming.candidate.linkedReferences };
  return publicDiscoveryVerifiedProfileSchema.parse({ candidate, references, workId: incoming.workId });
}

function hasLinkedIdentity(profile: PublicDiscoveryVerifiedProfile, target: PublicDiscoveryVerifiedProfile): boolean {
  const candidate = profile.candidate;
  return (candidate.linkedReferences ?? []).some(reference => {
    const supported = candidate.provider === 'mangadex' && reference.provider === 'mangaupdates'
      || candidate.provider === 'kitsu-anime' && candidate.mediaKind === 'ANIME' && reference.provider === 'anilist';
    return supported && profile.references.some(item => item.provider === reference.provider && item.externalId === reference.externalId)
      && target.candidate.provider === reference.provider && target.candidate.externalId === reference.externalId
      && target.references.some(item => item.provider === reference.provider && item.externalId === reference.externalId);
  });
}

export class D1PublicDiscoveryV3Adapter implements PublicDiscoveryV3Port {
  constructor(private readonly database: PublicDiscoveryV3D1Database, private readonly pendingLimit = publicDiscoveryPendingLimit) {
    if (!Number.isSafeInteger(pendingLimit) || pendingLimit < 1 || pendingLimit > publicDiscoveryPendingLimit) {
      throw new RangeError('public-discovery-pending-limit-out-of-range');
    }
  }

  private row(key: PublicDiscoveryKeyV3): Promise<DiscoveryRow | null> {
    return this.database.prepare(`SELECT attempt_count AS attemptCount, claim_token_hash AS claimTokenHash,
      failure_reason AS failureReason, lease_until AS leaseUntil, request_digest AS requestDigest,
      request_json AS requestJson, search_progress_json AS searchProgressJson, refresh_attempt_count AS refreshAttemptCount,
      refresh_state AS refreshState, next_refresh_at AS nextRefreshAt,
      result_expires_at AS resultExpiresAt, result_json AS resultJson,
      retry_at AS retryAt, state, verified_at AS verifiedAt FROM public_discovery_requests_v3
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4 LIMIT 1`)
      .bind(...keyValues(key)).first<DiscoveryRow>();
  }

  private async metadataProfile(workId: string): Promise<PublicDiscoveryVerifiedProfile | undefined> {
    const row = await this.database.prepare(`SELECT profile_json AS profileJson, editorial_status AS editorialStatus,
      format, start_year AS startYear, end_year AS endYear, episode_total AS episodeCount,
      chapter_total AS chapterCount, volume_total AS volumeCount, cover_url AS coverUrl,
      cover_attribution AS coverAttribution FROM catalogue_current_metadata WHERE work_id = ?1 LIMIT 1`)
      .bind(workId).first<{ profileJson: string; editorialStatus: PublicDiscoveryCandidate['editorialStatus'] | null;
        format: string | null; startYear: number | null; endYear: number | null; episodeCount: number | null;
        chapterCount: number | null; volumeCount: number | null; coverUrl: string | null; coverAttribution: string | null }>();
    if (row === null) return undefined;
    const profile = publicDiscoveryVerifiedProfileSchema.parse(JSON.parse(row.profileJson));
    const candidate: PublicDiscoveryCandidate = { editorialStatus: row.editorialStatus ?? undefined, format: row.format ?? undefined,
      startYear: row.startYear ?? undefined, endYear: row.endYear ?? undefined, episodeCount: row.episodeCount ?? undefined,
      chapterCount: row.chapterCount ?? undefined, volumeCount: row.volumeCount ?? undefined, ...profile.candidate };
    if (candidate.cover === undefined && row.coverUrl != null && row.coverAttribution != null) candidate.cover = { url: row.coverUrl, attribution: row.coverAttribution };
    return publicDiscoveryVerifiedProfileSchema.parse({ ...profile, candidate });
  }

  private async publicationProfile(value: PublicDiscoveryVerifiedProfile): Promise<PublicDiscoveryVerifiedProfile> {
    const incoming = publicDiscoveryVerifiedProfileSchema.parse(value);
    const current = await this.metadataProfile(incoming.workId);
    if (current !== undefined) return mergeProfile(current, incoming);
    const owners = await this.database.prepare(`SELECT DISTINCT existing.work_id AS workId,
      EXISTS (SELECT 1 FROM catalogue_works WHERE work_id = ?2) AS incomingExists
      FROM json_each(?1) AS proposed
      CROSS JOIN catalogue_external_references AS existing INDEXED BY sqlite_autoindex_catalogue_external_references_1
        ON existing.provider = json_extract(proposed.value, '$.provider')
        AND existing.external_id = json_extract(proposed.value, '$.externalId') LIMIT 5`)
      .bind(JSON.stringify(incoming.references), incoming.workId).all<{ workId: string; incomingExists: number }>();
    if (owners.results.length === 0 || owners.results.length === 1 && owners.results[0]!.workId === incoming.workId) return incoming;
    const owner = owners.results[0]!;
    if (owners.results.length !== 1 || owner.incomingExists !== 0) throw new Error('public-discovery-metadata-identity-conflict');
    const canonical = await this.metadataProfile(owner.workId);
    if (canonical === undefined || canonical.candidate.mediaKind !== incoming.candidate.mediaKind
      || !incoming.references.some(reference => reference.provider === incoming.candidate.provider && reference.externalId === incoming.candidate.externalId)
      || !(canonical.candidate.provider === incoming.candidate.provider && canonical.candidate.externalId === incoming.candidate.externalId
        || hasLinkedIdentity(incoming, canonical) || hasLinkedIdentity(canonical, incoming))) {
      throw new Error('public-discovery-metadata-identity-conflict');
    }
    return mergeProfile(canonical, { ...incoming, workId: owner.workId });
  }

  async readMany(keys: readonly PublicDiscoveryKeyV3[], now: string) {
    if (keys.length < 1 || keys.length > 50) throw new RangeError('public-discovery-lookup-limit-out-of-range');
    const parsed = keys.map((key) => publicDiscoveryKeyV3Schema.parse(key));
    if (new Set(parsed.map((key) => JSON.stringify(key))).size !== parsed.length) throw new Error('duplicate-public-discovery-key');
    // A lookup batch is one bounded D1 read, not one request per key.  The
    // JSON1 table-valued function keeps the parameter count constant while
    // preserving the complete four-column identity join.
    const rows = await this.database.prepare(`WITH requested AS (
        SELECT json_extract(value, '$.fingerprint') AS fingerprint,
          json_extract(value, '$.mediaKind') AS mediaKind,
          json_extract(value, '$.parserVersion') AS parserVersion,
          json_extract(value, '$.siteRulesVersion') AS rulesVersion
        FROM json_each(?1)
      )
      SELECT requested.fingerprint, requested.mediaKind, requested.parserVersion,
        requested.rulesVersion AS siteRulesVersion, r.attempt_count AS attemptCount, r.claim_token_hash AS claimTokenHash,
        r.failure_reason AS failureReason, r.lease_until AS leaseUntil, r.request_digest AS requestDigest,
        r.request_json AS requestJson, r.search_progress_json AS searchProgressJson, r.refresh_attempt_count AS refreshAttemptCount,
        r.refresh_state AS refreshState, r.next_refresh_at AS nextRefreshAt,
        r.result_expires_at AS resultExpiresAt, r.result_json AS resultJson,
        r.retry_at AS retryAt, r.state, r.verified_at AS verifiedAt
      FROM requested
      LEFT JOIN public_discovery_requests_v3 AS r INDEXED BY sqlite_autoindex_public_discovery_requests_v3_1
        ON r.fingerprint = requested.fingerprint AND r.media_kind = requested.mediaKind
        AND r.parser_version = requested.parserVersion AND r.rules_version = requested.rulesVersion`).bind(JSON.stringify(parsed)).all<DiscoveryRow & PublicDiscoveryKeyV3>();
    const exhausted = rows.results.filter((row) => row.state === 'PROCESSING' && row.attemptCount >= 8 && row.leaseUntil !== null && row.leaseUntil <= now);
    const exhaustedStates = new Map<string, PublicDiscoveryReadState>();
    if (exhausted.length > 0) await Promise.all(exhausted.map(async (row) => {
      const key = { fingerprint: row.fingerprint, mediaKind: row.mediaKind, parserVersion: row.parserVersion, siteRulesVersion: row.siteRulesVersion };
      await this.failExhaustedKey(key, now);
      exhaustedStates.set(JSON.stringify(key), stateFromRow(await this.row(key), now));
    }));
    const byKey = new Map(rows.results.map((row) => [JSON.stringify({ fingerprint: row.fingerprint, mediaKind: row.mediaKind,
      parserVersion: row.parserVersion, siteRulesVersion: row.siteRulesVersion }), row.state === null ? null : row]));
    return parsed.map((key) => ({ key, state: exhaustedStates.get(JSON.stringify(key)) ?? stateFromRow(byKey.get(JSON.stringify(key)) ?? null, now) }));
  }

  private async failExhaustedKey(key: PublicDiscoveryKeyV3, now: string): Promise<void> {
    await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      state = 'FAILED', failure_reason = 'ATTEMPT_LIMIT', failed_at = ?5,
      claim_token_hash = NULL, lease_until = NULL, retry_at = ?5, updated_at = ?5,
      purge_after = ?6
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state = 'PROCESSING' AND attempt_count >= 8 AND lease_until <= ?5
      RETURNING fingerprint`).bind(...keyValues(key), now, futureIso(now, failedRetentionMilliseconds)).first();
  }

  private async failExhaustedRefreshKey(key: PublicDiscoveryKeyV3, now: string): Promise<void> {
    await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      refresh_state = 'IDLE', refresh_attempt_count = 0,
      claim_token_hash = NULL, lease_until = NULL, updated_at = ?5
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state = 'VERIFIED' AND refresh_state = 'PROCESSING'
        AND refresh_attempt_count >= 8 AND lease_until <= ?5
      RETURNING fingerprint`).bind(...keyValues(key), now).first();
  }

  private async failExhaustedBatch(now: string, limit: number, continuationTokenDigest?: string): Promise<void> {
    if (continuationTokenDigest !== undefined) {
      await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
        state = 'FAILED', failure_reason = 'ATTEMPT_LIMIT', failed_at = ?1,
        claim_token_hash = NULL, lease_until = NULL, retry_at = ?1, updated_at = ?1, purge_after = ?3
        WHERE rowid IN (SELECT rowid FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_continuation
          WHERE claim_token_hash = ?4 AND state = 'PROCESSING' AND attempt_count >= 8 AND lease_until <= ?1
          ORDER BY updated_at, fingerprint LIMIT ?2)
        RETURNING fingerprint`).bind(now, limit, futureIso(now, failedRetentionMilliseconds), continuationTokenDigest).all();
      await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
        refresh_state = 'IDLE', refresh_attempt_count = 0,
        claim_token_hash = NULL, lease_until = NULL, updated_at = ?1
        WHERE rowid IN (SELECT rowid FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_continuation
          WHERE claim_token_hash = ?3 AND state = 'VERIFIED' AND refresh_state = 'PROCESSING'
            AND refresh_attempt_count >= 8 AND lease_until <= ?1
          ORDER BY updated_at, fingerprint LIMIT ?2)
        RETURNING fingerprint`).bind(now, limit, continuationTokenDigest).all();
      return;
    }
    await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      state = 'FAILED', failure_reason = 'ATTEMPT_LIMIT', failed_at = ?1,
      claim_token_hash = NULL, lease_until = NULL, retry_at = ?1, updated_at = ?1,
      purge_after = ?3
      WHERE state IN ('PENDING', 'PROCESSING')
        AND rowid IN (SELECT rowid FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_pending
        WHERE state IN ('PENDING', 'PROCESSING')
          AND state = 'PROCESSING' AND attempt_count >= 8 AND lease_until <= ?1
        ORDER BY updated_at, fingerprint LIMIT ?2)
      RETURNING fingerprint`).bind(now, limit, futureIso(now, failedRetentionMilliseconds)).all();
    await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      refresh_state = 'IDLE', refresh_attempt_count = 0,
      claim_token_hash = NULL, lease_until = NULL, updated_at = ?1
      WHERE state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING')
        AND rowid IN (SELECT rowid FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_refresh_claim
        WHERE state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING') AND refresh_state = 'PROCESSING'
          AND refresh_attempt_count >= 8 AND lease_until <= ?1
        ORDER BY updated_at, fingerprint LIMIT ?2)
      RETURNING fingerprint`).bind(now, limit).all();
  }

  async read(key: PublicDiscoveryKeyV3, now: string): Promise<PublicDiscoveryReadState> {
    await this.failExhaustedKey(key, now);
    const state = stateFromRow(await this.row(key), now);
    if (state.state !== 'VERIFIED') return state;
    const profile = await this.metadataProfile(state.profile.workId);
    return profile === undefined ? state : { ...state, profile };
  }

  async request(input: PublicDiscoveryRequest, now: string, admissionTokenDigest?: string): Promise<PublicDiscoveryAdmission> {
    const request = publicDiscoveryRequestSchema.parse(input);
    await this.failExhaustedKey(request.key, now);
    const priority = request.query.explicitProviderReference !== undefined ? 1 : request.query.mediaKind === 'UNKNOWN' ? 3 : 2;
    const signalLeaseUntil = futureIso(now, queueSignalLeaseMilliseconds);
    const created = await this.database.prepare(`INSERT INTO public_discovery_requests_v3(
      fingerprint, media_kind, parser_version, rules_version, request_digest, request_json,
      state, retry_at, created_at, updated_at, admission_priority,
      queue_signal_state, queue_signal_lease_until, claim_token_hash
    ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, 'PENDING', ?7, ?7, ?7, ?9, 'SENDING', ?10, ?11
    WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state IN ('PENDING', 'PROCESSING'))
      OR (SELECT COUNT(*) FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_pending
        WHERE state IN ('PENDING', 'PROCESSING')) < ?8
    ON CONFLICT(fingerprint, media_kind, parser_version, rules_version) DO UPDATE SET
      state = 'PENDING', claim_token_hash = excluded.claim_token_hash, lease_until = NULL, attempt_count = 0,
      failure_reason = NULL, failed_at = NULL, result_json = NULL, verified_at = NULL,
      result_expires_at = NULL, request_digest = excluded.request_digest,
      request_json = excluded.request_json, search_progress_json = NULL, admission_priority = excluded.admission_priority,
      queue_signal_state = 'SENDING', queue_signal_lease_until = excluded.queue_signal_lease_until,
      retry_at = excluded.retry_at, updated_at = excluded.updated_at, purge_after = NULL
    WHERE public_discovery_requests_v3.request_digest = excluded.request_digest
      AND (public_discovery_requests_v3.state = 'FAILED'
        OR (public_discovery_requests_v3.state IN ('NOT_FOUND', 'AMBIGUOUS')
          AND public_discovery_requests_v3.result_expires_at <= excluded.updated_at))
    RETURNING state`)
      .bind(...keyValues(request.key), request.requestDigest, JSON.stringify(request), now, this.pendingLimit, priority, signalLeaseUntil, admissionTokenDigest ?? null)
      .first<{ state: string }>();
    if (created !== null) {
      return {
        outcome: 'created',
        state: { retryAt: now, state: 'PENDING' },
      };
    }
    const row = await this.row(request.key);
    if (!row) return { outcome: 'saturated' };
    if (row.requestDigest !== request.requestDigest) throw new Error('public-discovery-request-conflict');
    // A terminal row needs a free slot just like a new key. Active replays do not.
    if (row.state === 'FAILED' || ((row.state === 'NOT_FOUND' || row.state === 'AMBIGUOUS')
      && row.resultExpiresAt !== null && row.resultExpiresAt <= now)) return { outcome: 'saturated' };
    const resumedSignal = created === null
      ? await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
          queue_signal_state = 'SENDING', queue_signal_lease_until = ?7, claim_token_hash = ?9, updated_at = ?6
          WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
            AND request_digest = ?5
            AND ((state = 'PENDING' AND retry_at <= ?6) OR (state = 'PROCESSING' AND lease_until <= ?6))
            AND (queue_signal_state = 'UNSENT'
              OR (queue_signal_state = 'SENDING' AND queue_signal_lease_until <= ?6)
              OR (queue_signal_state = 'SENT' AND updated_at <= ?8))
          RETURNING state`)
        .bind(...keyValues(request.key), request.requestDigest, now, signalLeaseUntil, futureIso(now, -queueSignalLeaseMilliseconds), admissionTokenDigest ?? null).first()
      : null;
    return { outcome: created !== null || resumedSignal !== null ? 'created' : 'existing', state: stateFromRow(row, now) };
  }

  async nextPendingAt(continuationTokenDigest?: string): Promise<string | undefined> {
    if (continuationTokenDigest !== undefined) {
      const row = await this.database.prepare(`SELECT MIN(CASE
          WHEN state = 'PROCESSING' OR (state = 'VERIFIED' AND refresh_state = 'PROCESSING')
          THEN lease_until ELSE retry_at END) AS due
        FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_continuation
        WHERE claim_token_hash = ?1 AND (state IN ('PENDING', 'PROCESSING')
          OR (state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING')))`)
        .bind(continuationTokenDigest).first<{ due: string | null }>();
      return row?.due ?? undefined;
    }
    const row = await this.database.prepare(`SELECT MIN(due) AS due FROM (
      SELECT CASE WHEN ?1 IS NULL AND claim_token_hash IS NOT NULL AND state = 'PENDING'
        THEN MAX(CASE WHEN state = 'PROCESSING' THEN lease_until ELSE retry_at END,
          strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, ?2))
        ELSE CASE WHEN state = 'PROCESSING' THEN lease_until ELSE retry_at END END AS due
      FROM public_discovery_requests_v3 WHERE state IN ('PENDING', 'PROCESSING')
        AND (?1 IS NULL OR claim_token_hash = ?1)
      UNION ALL
      SELECT CASE WHEN ?1 IS NULL AND claim_token_hash IS NOT NULL AND refresh_state = 'PENDING'
        THEN MAX(CASE WHEN refresh_state = 'PROCESSING' THEN lease_until ELSE retry_at END,
          strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, ?2))
        ELSE CASE WHEN refresh_state = 'PROCESSING' THEN lease_until ELSE retry_at END END AS due
      FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING')
        AND (?1 IS NULL OR claim_token_hash = ?1)
    )`).bind(continuationTokenDigest ?? null, `+${continuationOwnershipMilliseconds / 1_000} seconds`).first<{ due: string | null }>();
    return row?.due ?? undefined;
  }

  async requestRefresh(key: PublicDiscoveryKeyV3, now: string, admissionTokenDigest?: string): Promise<PublicDiscoveryRefreshAdmission> {
    const signalLeaseUntil = futureIso(now, queueSignalLeaseMilliseconds);
    const nextRefreshAt = futureIso(now, refreshFreshnessMilliseconds);
    const created = await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      refresh_state = 'PENDING', refresh_attempt_count = 0, refresh_requested_at = ?5,
      next_refresh_at = ?6, queue_signal_state = 'SENDING', queue_signal_lease_until = ?7,
      claim_token_hash = ?8, lease_until = NULL, admission_priority = 1, updated_at = ?5
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state = 'VERIFIED' AND refresh_state = 'IDLE' AND next_refresh_at <= ?5
      RETURNING request_digest AS requestDigest`).bind(...keyValues(key), now, nextRefreshAt, signalLeaseUntil, admissionTokenDigest ?? null)
      .first<{ requestDigest: string }>();
    const resumed = created === null
      ? await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
          queue_signal_state = 'SENDING', queue_signal_lease_until = ?6, claim_token_hash = ?8, updated_at = ?5
          WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
            AND state = 'VERIFIED'
            AND ((refresh_state = 'PENDING' AND retry_at <= ?5)
              OR (refresh_state = 'PROCESSING' AND lease_until <= ?5))
            AND (queue_signal_state = 'UNSENT'
              OR (queue_signal_state = 'SENDING' AND queue_signal_lease_until <= ?5)
              OR (queue_signal_state = 'SENT' AND updated_at <= ?7))
          RETURNING request_digest AS requestDigest`)
        .bind(...keyValues(key), now, signalLeaseUntil, futureIso(now, -queueSignalLeaseMilliseconds), admissionTokenDigest ?? null)
        .first<{ requestDigest: string }>()
      : null;
    const row = await this.row(key);
    const state = stateFromRow(row, now);
    if (!row || state.state !== 'VERIFIED') throw new Error('public-discovery-refresh-unavailable');
    return { outcome: created || resumed ? 'created' : 'existing', requestDigest: row.requestDigest, state };
  }

  async confirmQueueSignal(key: PublicDiscoveryKeyV3, requestDigest: string, now: string): Promise<void> {
    const confirmed = await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      queue_signal_state = 'SENT', queue_signal_lease_until = NULL, updated_at = ?6
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND request_digest = ?5 AND queue_signal_state = 'SENDING'
      RETURNING state`).bind(...keyValues(key), requestDigest, now).first();
    if (!confirmed) throw new Error('public-discovery-signal-claim-lost');
  }

  async releaseQueueSignal(key: PublicDiscoveryKeyV3, requestDigest: string, now: string): Promise<void> {
    await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      queue_signal_state = 'UNSENT', queue_signal_lease_until = NULL, updated_at = ?6
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND request_digest = ?5 AND queue_signal_state = 'SENDING'
      RETURNING state`).bind(...keyValues(key), requestDigest, now).first();
  }

  async claimBatch(input: { claimToken: string; continuationTokenDigest?: string; key?: PublicDiscoveryKeyV3; leaseUntil: string; limit: number; now: string; tokenDigest: string }): Promise<PublicDiscoveryClaimBatch> {
    if (input.key === undefined) await this.failExhaustedBatch(input.now, input.limit, input.continuationTokenDigest);
    else {
      await this.failExhaustedKey(input.key, input.now);
      await this.failExhaustedRefreshKey(input.key, input.now);
    }
    const statement = input.key === undefined ? this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      state = CASE WHEN state = 'VERIFIED' THEN state ELSE 'PROCESSING' END,
      refresh_state = CASE WHEN state = 'VERIFIED' THEN 'PROCESSING' ELSE refresh_state END,
      claim_token_hash = ?1, lease_until = ?2,
      attempt_count = CASE WHEN state = 'VERIFIED' THEN attempt_count ELSE attempt_count + 1 END,
      refresh_attempt_count = CASE WHEN state = 'VERIFIED' THEN refresh_attempt_count + 1 ELSE refresh_attempt_count END,
      retry_at = ?2, updated_at = ?3
      WHERE rowid IN (SELECT rowid FROM (
        SELECT rowid, admission_priority, updated_at, fingerprint
        FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_continuation
        WHERE ?5 IS NOT NULL AND claim_token_hash = ?5
          AND (?6 IS NULL OR (fingerprint = ?6 AND media_kind = ?7 AND parser_version = ?8 AND rules_version = ?9))
          AND ((state = 'PENDING' AND attempt_count < 8 AND retry_at <= ?3)
            OR (state = 'PROCESSING' AND attempt_count < 8 AND lease_until <= ?3)
            OR (state = 'VERIFIED' AND refresh_attempt_count < 8
              AND ((refresh_state = 'PENDING' AND retry_at <= ?3) OR (refresh_state = 'PROCESSING' AND lease_until <= ?3))))
        UNION ALL
        SELECT rowid, admission_priority, updated_at, fingerprint
        FROM public_discovery_requests_v3 INDEXED BY sqlite_autoindex_public_discovery_requests_v3_1
        WHERE ?5 IS NULL AND ?6 IS NOT NULL
          AND fingerprint = ?6 AND media_kind = ?7 AND parser_version = ?8 AND rules_version = ?9
          AND ((state = 'PENDING' AND attempt_count < 8 AND retry_at <= ?3)
            OR (state = 'PROCESSING' AND attempt_count < 8 AND lease_until <= ?3)
            OR (state = 'VERIFIED' AND refresh_attempt_count < 8
              AND ((refresh_state = 'PENDING' AND retry_at <= ?3) OR (refresh_state = 'PROCESSING' AND lease_until <= ?3))))
        UNION ALL
        SELECT rowid, admission_priority, updated_at, fingerprint
        FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_claim_priority
        WHERE ?5 IS NULL AND ?6 IS NULL AND state IN ('PENDING', 'PROCESSING') AND attempt_count < 8
          AND ((state = 'PENDING' AND retry_at <= ?3) OR (state = 'PROCESSING' AND lease_until <= ?3))
          AND (?5 IS NULL OR claim_token_hash = ?5)
          AND (?5 IS NOT NULL OR ?6 IS NOT NULL OR state = 'PROCESSING' OR claim_token_hash IS NULL OR updated_at <= ?10)
          AND (?6 IS NULL OR (fingerprint = ?6 AND media_kind = ?7 AND parser_version = ?8 AND rules_version = ?9))
        UNION ALL
        SELECT rowid, admission_priority, updated_at, fingerprint
        FROM public_discovery_requests_v3 INDEXED BY public_discovery_v3_refresh_claim
        WHERE ?5 IS NULL AND ?6 IS NULL AND state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING') AND refresh_attempt_count < 8
          AND ((refresh_state = 'PENDING' AND retry_at <= ?3) OR (refresh_state = 'PROCESSING' AND lease_until <= ?3))
          AND (?5 IS NULL OR claim_token_hash = ?5)
          AND (?5 IS NOT NULL OR ?6 IS NOT NULL OR refresh_state = 'PROCESSING' OR claim_token_hash IS NULL OR updated_at <= ?10)
          AND (?6 IS NULL OR (fingerprint = ?6 AND media_kind = ?7 AND parser_version = ?8 AND rules_version = ?9)))
        ORDER BY admission_priority, updated_at, fingerprint LIMIT ?4)
      RETURNING request_json AS requestJson, search_progress_json AS searchProgressJson, result_json AS resultJson, request_digest AS requestDigest,
        state, attempt_count AS attemptCount, refresh_attempt_count AS refreshAttemptCount,
        admission_priority AS admissionPriority, updated_at AS updatedAt,
        fingerprint, media_kind AS mediaKind, parser_version AS parserVersion, rules_version AS siteRulesVersion`)
      .bind(input.tokenDigest, input.leaseUntil, input.now, input.limit, input.continuationTokenDigest ?? null, null, null, null, null, futureIso(input.now, -continuationOwnershipMilliseconds))
      : this.database.prepare(`UPDATE public_discovery_requests_v3 SET
          state = CASE WHEN state = 'VERIFIED' THEN state ELSE 'PROCESSING' END,
          refresh_state = CASE WHEN state = 'VERIFIED' THEN 'PROCESSING' ELSE refresh_state END,
          claim_token_hash = ?1, lease_until = ?2,
          attempt_count = CASE WHEN state = 'VERIFIED' THEN attempt_count ELSE attempt_count + 1 END,
          refresh_attempt_count = CASE WHEN state = 'VERIFIED' THEN refresh_attempt_count + 1 ELSE refresh_attempt_count END,
          retry_at = ?2, updated_at = ?3
          WHERE fingerprint = ?6 AND media_kind = ?7 AND parser_version = ?8 AND rules_version = ?9
            AND ?4 > 0 AND (?5 IS NULL OR claim_token_hash = ?5)
            AND ((state = 'PENDING' AND attempt_count < 8 AND retry_at <= ?3)
              OR (state = 'PROCESSING' AND attempt_count < 8 AND lease_until <= ?3)
              OR (state = 'VERIFIED' AND refresh_attempt_count < 8
                AND ((refresh_state = 'PENDING' AND retry_at <= ?3) OR (refresh_state = 'PROCESSING' AND lease_until <= ?3))))
          RETURNING request_json AS requestJson, search_progress_json AS searchProgressJson, result_json AS resultJson, request_digest AS requestDigest,
            state, attempt_count AS attemptCount, refresh_attempt_count AS refreshAttemptCount,
            admission_priority AS admissionPriority, updated_at AS updatedAt,
            fingerprint, media_kind AS mediaKind, parser_version AS parserVersion, rules_version AS siteRulesVersion`)
        .bind(input.tokenDigest, input.leaseUntil, input.now, input.limit, input.continuationTokenDigest ?? null,
          input.key.fingerprint, input.key.mediaKind, input.key.parserVersion, input.key.siteRulesVersion);
    const rows = await statement.all<{ admissionPriority: number; attemptCount: number; fingerprint: string; mediaKind: PublicDiscoveryKeyV3['mediaKind']; parserVersion: string; refreshAttemptCount: number; requestDigest: string; requestJson: string; resultJson: string | null; searchProgressJson: string | null; siteRulesVersion: string; state: DiscoveryRow['state']; updatedAt: string }>();
    const ordered = rows.results.sort((left, right) => left.admissionPriority - right.admissionPriority
      || left.updatedAt.localeCompare(right.updatedAt) || left.fingerprint.localeCompare(right.fingerprint));
    const requests = ordered.map((row) => {
      if (row.state !== 'VERIFIED') {
        const request = publicDiscoveryRequestSchema.parse(JSON.parse(row.requestJson));
        const searchProgress = row.searchProgressJson === null ? undefined : publicDiscoverySearchProgressSchema.parse(JSON.parse(row.searchProgressJson));
        return publicDiscoveryClaimedRequestSchema.parse({ ...request, attempt: row.attemptCount, searchProgress });
      }
      if (!row.resultJson) throw new Error('invalid-refresh-profile');
      const resolution = publicDiscoveryTerminalResolutionSchema.parse(JSON.parse(row.resultJson));
      if (resolution.state !== 'VERIFIED') throw new Error('invalid-refresh-profile');
      const candidate = resolution.profile.candidate;
      const titles = [...new Set([candidate.displayTitle, ...candidate.titles].filter((title): title is string => Boolean(title)))].slice(0, 4);
      const exactReference = resolution.profile.references.find((reference) => reference.provider === candidate.provider && reference.externalId === candidate.externalId)
        ?? resolution.profile.references[0];
      return publicDiscoveryClaimedRequestSchema.parse({
        attempt: row.refreshAttemptCount,
        key: { fingerprint: row.fingerprint, mediaKind: row.mediaKind, parserVersion: row.parserVersion, siteRulesVersion: row.siteRulesVersion },
        query: {
          discoveryTitles: titles,
          explicitProviderReference: exactReference,
          mediaKind: candidate.mediaKind,
          preSerialization: candidate.preSerialization,
          season: candidate.season,
          sourceFormat: candidate.format,
          sourceTitles: titles,
        },
        requestDigest: row.requestDigest,
        schemaVersion: 3,
      });
    });
    return { claimToken: input.claimToken, requests, schemaVersion: 3 };
  }

  async deferClaim(request: PublicDiscoveryClaimedRequest, tokenDigest: string, retryAt: string, now: string, searchProgress?: PublicDiscoverySearchProgress): Promise<void> {
    await this.rescheduleClaim(request, tokenDigest, retryAt, now, false, searchProgress);
  }

  async retryTransientClaim(request: PublicDiscoveryClaimedRequest, tokenDigest: string, now: string): Promise<void> {
    if (!Number.isInteger(request.attempt) || request.attempt < 1 || request.attempt > 8) throw new TypeError('invalid-public-discovery-retry-attempt');
    const delay = request.attempt >= 8 ? 86_400_000 : 60_000 * 2 ** (request.attempt - 1);
    await this.rescheduleClaim(request, tokenDigest, futureIso(now, delay), now, true, request.searchProgress);
  }

  private async rescheduleClaim(request: PublicDiscoveryClaimedRequest, tokenDigest: string, retryAt: string, now: string, consumed: boolean, searchProgress?: PublicDiscoverySearchProgress): Promise<void> {
    if (!Number.isFinite(Date.parse(retryAt)) || retryAt <= now) throw new TypeError('invalid-public-discovery-defer-time');
    const result = await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      state = 'PENDING', attempt_count = CASE WHEN ?11 = 0 THEN attempt_count - 1 WHEN attempt_count >= 8 THEN 0 ELSE attempt_count END,
      lease_until = NULL, retry_at = ?8, updated_at = ?9, search_progress_json = ?10
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND request_digest = ?5 AND claim_token_hash = ?6 AND attempt_count = ?7
        AND state = 'PROCESSING' AND (?11 = 0 OR lease_until > ?9) RETURNING fingerprint`)
      .bind(...keyValues(request.key), request.requestDigest, tokenDigest, request.attempt, retryAt, now,
        searchProgress === undefined ? null : JSON.stringify(publicDiscoverySearchProgressSchema.parse(searchProgress)), consumed ? 1 : 0).first();
    if (result) return;
    const refresh = await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      refresh_state = 'PENDING', refresh_attempt_count = CASE WHEN ?10 = 0 THEN refresh_attempt_count - 1 WHEN refresh_attempt_count >= 8 THEN 0 ELSE refresh_attempt_count END,
      lease_until = NULL, retry_at = ?8, updated_at = ?9
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND request_digest = ?5 AND claim_token_hash = ?6 AND refresh_attempt_count = ?7
        AND state = 'VERIFIED' AND refresh_state = 'PROCESSING' AND (?10 = 0 OR lease_until > ?9) RETURNING fingerprint`)
      .bind(...keyValues(request.key), request.requestDigest, tokenDigest, request.attempt, retryAt, now, consumed ? 1 : 0).first();
    if (!refresh) throw new Error('public-discovery-defer-claim-lost');
  }

  private publicationGuardValues(result: PublicDiscoveryResult, profile: PublicDiscoveryVerifiedProfile | undefined, tokenDigest: string, now: string): SqlValue[] {
    return [
      ...keyValues(result.key), tokenDigest, result.requestDigest, now,
      JSON.stringify(profile?.references ?? []), profile?.workId ?? '',
    ];
  }

  private canonicalFacts(profile: PublicDiscoveryVerifiedProfile): CanonicalFacts {
    const normalizedTitles = [...new Set([
      profile.candidate.displayTitle,
      ...profile.candidate.titles,
    ].filter((title): title is string => title !== undefined)
      .map((title) => normalizeFavoriteTitle(title).normalized)
      .filter((title) => title.length > 0))];
    if (normalizedTitles.length === 0) throw new Error('public-discovery-canonical-title-missing');
    return {
      mediaKind: profile.candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
      normalizedTitles,
      workId: profile.workId,
    };
  }

  private async catalogueNeedsPublication(profile: PublicDiscoveryVerifiedProfile, canonical: CanonicalFacts): Promise<boolean> {
    const candidate = profile.candidate;
    const preferredTitle = candidate.displayTitle ?? candidate.titles[0] ?? candidate.externalId;
    const result = await this.database.prepare(`SELECT CASE WHEN
      NOT EXISTS (SELECT 1 FROM catalogue_works
        WHERE work_id = ?1 AND media_kind = ?2 AND preferred_title = ?3)
      OR EXISTS (SELECT 1 FROM json_each(?4) AS proposed
        WHERE NOT EXISTS (SELECT 1 FROM catalogue_titles
          WHERE work_id = ?1 AND locale = 'und' AND title = proposed.value))
      OR EXISTS (SELECT 1 FROM json_each(?5) AS proposed
        WHERE NOT EXISTS (SELECT 1 FROM catalogue_canonical_titles_v1 INDEXED BY sqlite_autoindex_catalogue_canonical_titles_v1_1
          WHERE normalization_version = ?6 AND normalized_title = proposed.value
            AND media_kind = ?2 AND (work_id = ?1 OR ambiguous = 1)))
      OR EXISTS (SELECT 1 FROM json_each(?7) AS proposed
        WHERE NOT EXISTS (SELECT 1 FROM catalogue_external_references INDEXED BY sqlite_autoindex_catalogue_external_references_1
          WHERE provider = json_extract(proposed.value, '$.provider')
            AND external_id = json_extract(proposed.value, '$.externalId') AND work_id = ?1))
      OR NOT EXISTS (SELECT 1 FROM catalogue_current_metadata
        WHERE work_id = ?1 AND profile_json = ?8)
      THEN 1 ELSE 0 END AS needsPublication`)
      .bind(
        profile.workId,
        candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
        preferredTitle,
        JSON.stringify(candidate.titles),
        JSON.stringify(canonical.normalizedTitles),
        favoriteTitlePreparationVersion,
        JSON.stringify(profile.references),
        JSON.stringify(profile),
      ).first<{ needsPublication: number }>();
    return result?.needsPublication === 1;
  }

  private catalogueStatements(profile: PublicDiscoveryVerifiedProfile, canonical: CanonicalFacts, verifiedAt: string, guardValues: SqlValue[]): Statement[] {
    const revision = Math.max(1, Date.parse(verifiedAt));
    const candidate = profile.candidate;
    return [
      this.database.prepare(`INSERT OR IGNORE INTO catalogue_revisions(revision, published_at)
        SELECT ?, ? WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)`).bind(revision, verifiedAt, ...guardValues),
      this.database.prepare(`INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision)
        SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)
        ON CONFLICT(work_id) DO UPDATE SET media_kind = excluded.media_kind,
        preferred_title = excluded.preferred_title, revision = excluded.revision`)
        .bind(profile.workId, candidate.mediaKind === 'ANIME' ? 'anime' : 'manga', candidate.displayTitle ?? candidate.titles[0] ?? candidate.externalId, revision, ...guardValues),
      this.database.prepare(`INSERT OR IGNORE INTO catalogue_titles(work_id, locale, title)
        SELECT ?, 'und', proposed.value FROM json_each(?) AS proposed
        WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)`)
        .bind(profile.workId, JSON.stringify(candidate.titles), ...guardValues),
      this.database.prepare(`UPDATE catalogue_canonical_titles_v1 INDEXED BY sqlite_autoindex_catalogue_canonical_titles_v1_1 SET ambiguous = 1
        WHERE normalization_version = ?1 AND media_kind = ?2 AND work_id <> ?3 AND ambiguous = 0
          AND normalized_title IN (SELECT value FROM json_each(?4))
          AND EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
            fingerprint = ?5 AND media_kind = ?6 AND parser_version = ?7 AND rules_version = ?8
            AND state = 'VERIFIED' AND refresh_state = 'IDLE'
            AND claim_token_hash = ?9 AND request_digest = ?10 AND lease_until > ?11)`)
        .bind(favoriteTitlePreparationVersion, canonical.mediaKind, canonical.workId, JSON.stringify(canonical.normalizedTitles), ...guardValues),
      this.database.prepare(`INSERT INTO catalogue_canonical_titles_v1(
          normalization_version, normalized_title, media_kind, work_id, created_at)
        SELECT ?, proposed.value, ?, ?, ? FROM json_each(?) AS proposed
        WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)
        ON CONFLICT(normalization_version, normalized_title, media_kind) DO NOTHING`)
        .bind(favoriteTitlePreparationVersion, candidate.mediaKind === 'ANIME' ? 'anime' : 'manga', profile.workId, verifiedAt, JSON.stringify(canonical.normalizedTitles), ...guardValues),
      this.database.prepare(`INSERT INTO catalogue_external_references(provider, external_id, work_id)
        SELECT json_extract(proposed.value, '$.provider'), json_extract(proposed.value, '$.externalId'), ?
        FROM json_each(?) AS proposed WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)
        ON CONFLICT(provider, external_id) DO NOTHING`).bind(profile.workId, JSON.stringify(profile.references), ...guardValues),
      this.database.prepare(`INSERT INTO catalogue_current_metadata(
          work_id, profile_json, editorial_status, format, start_year, end_year,
          episode_total, chapter_total, volume_total, cover_url, cover_attribution,
          genres_json, categories_json, content_classification, source_provider,
          source_external_id, value_observed_at, normalization_version, revision)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
          fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
          AND state = 'VERIFIED' AND refresh_state = 'IDLE'
          AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?)
        ON CONFLICT(work_id) DO UPDATE SET
          profile_json = excluded.profile_json,
          editorial_status = excluded.editorial_status,
          format = excluded.format,
          start_year = excluded.start_year,
          end_year = excluded.end_year,
          episode_total = excluded.episode_total,
          chapter_total = excluded.chapter_total,
          volume_total = excluded.volume_total,
          cover_url = excluded.cover_url,
          cover_attribution = excluded.cover_attribution,
          genres_json = excluded.genres_json, categories_json = excluded.categories_json,
          content_classification = excluded.content_classification,
          source_provider = excluded.source_provider, source_external_id = excluded.source_external_id,
          value_observed_at = excluded.value_observed_at,
          normalization_version = excluded.normalization_version, revision = excluded.revision
        WHERE catalogue_current_metadata.profile_json IS NOT excluded.profile_json`)
        .bind(
          profile.workId, JSON.stringify(profile), candidate.editorialStatus ?? null, candidate.format ?? null,
          candidate.startYear ?? null, candidate.endYear ?? null, candidate.episodeCount ?? null,
          candidate.chapterCount ?? null, candidate.volumeCount ?? null, candidate.cover?.url ?? null,
          candidate.cover?.attribution ?? null, JSON.stringify(candidate.genres ?? []),
          JSON.stringify(candidate.categories ?? []), candidate.contentClassification ?? 'unknown',
          candidate.provider, candidate.externalId, verifiedAt, candidate.metadataVersion ?? 1, revision,
          ...guardValues,
        ),
      this.database.prepare(`UPDATE catalogue_release_model SET editorial_status = ?1, revision = ?2, observed_at = ?5, source = ?6,
        exceptions_json = CASE WHEN ?1 = 'CANCELLED' THEN (
          SELECT json_group_array(json(CASE WHEN json_extract(value, '$.state') = 'SCHEDULED'
            AND json_extract(value, '$.occurrence.value') >= CASE WHEN json_extract(value, '$.occurrence.kind') = 'DATE' THEN substr(?5, 1, 10) ELSE ?5 END
            THEN json_set(value, '$.state', 'CANCELLED', '$.provenance.fetchedAt', ?5, '$.provenance.source', ?6)
            ELSE value END)) FROM json_each(exceptions_json)) ELSE exceptions_json END,
        explicit_next_json = CASE WHEN ?1 = 'CANCELLED' AND json_extract(explicit_next_json, '$.state') = 'SCHEDULED'
          AND json_extract(explicit_next_json, '$.occurrence.value') >= CASE WHEN json_extract(explicit_next_json, '$.occurrence.kind') = 'DATE' THEN substr(?5, 1, 10) ELSE ?5 END
          THEN json_set(explicit_next_json, '$.state', 'CANCELLED', '$.provenance.fetchedAt', ?5, '$.provenance.source', ?6)
          ELSE explicit_next_json END
        WHERE work_id = ?3 AND editorial_status IS NOT ?1
          AND EXISTS (SELECT 1 FROM catalogue_current_metadata
            WHERE work_id = ?3 AND profile_json = ?4 AND revision = ?2)
          AND EXISTS (SELECT 1 FROM public_discovery_requests_v3
            WHERE fingerprint = ?7 AND media_kind = ?8 AND parser_version = ?9 AND rules_version = ?10
              AND state = 'VERIFIED' AND refresh_state = 'IDLE'
              AND claim_token_hash = ?11 AND request_digest = ?12 AND lease_until > ?13)`)
        .bind(candidate.editorialStatus ?? 'UNKNOWN', revision, profile.workId, JSON.stringify(profile), verifiedAt, candidate.provider, ...guardValues),
    ];
  }

  private async materializeCanonicalReplay(result: PublicDiscoveryResult, profile: PublicDiscoveryVerifiedProfile, resultJson: string, createdAt: string): Promise<void> {
    const canonical = this.canonicalFacts(profile);
    const guard = [
      ...keyValues(result.key), result.requestDigest, resultJson,
    ];
    const outcomes = await this.database.batch([
      this.database.prepare(`UPDATE catalogue_canonical_titles_v1 INDEXED BY sqlite_autoindex_catalogue_canonical_titles_v1_1 SET ambiguous = 1
        WHERE normalization_version = ?1 AND media_kind = ?2 AND work_id <> ?3 AND ambiguous = 0
          AND normalized_title IN (SELECT value FROM json_each(?4))
          AND EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
            fingerprint = ?5 AND media_kind = ?6 AND parser_version = ?7 AND rules_version = ?8
            AND state = 'VERIFIED' AND request_digest = ?9 AND result_json = ?10)`)
        .bind(favoriteTitlePreparationVersion, canonical.mediaKind, canonical.workId, JSON.stringify(canonical.normalizedTitles), ...guard),
      this.database.prepare(`INSERT INTO catalogue_canonical_titles_v1(
        normalization_version, normalized_title, media_kind, work_id, created_at)
      SELECT ?1, proposed.value, ?2, ?3, ?4 FROM json_each(?5) AS proposed
      WHERE EXISTS (SELECT 1 FROM public_discovery_requests_v3 WHERE
        fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
        AND state = 'VERIFIED' AND request_digest = ? AND result_json = ?)
      ON CONFLICT(normalization_version, normalized_title, media_kind) DO NOTHING`)
        .bind(favoriteTitlePreparationVersion, canonical.mediaKind, canonical.workId, createdAt, JSON.stringify(canonical.normalizedTitles), ...guard),
    ]);
    if (outcomes.some((outcome) => !outcome.success)) throw new Error('public-discovery-batch-failed');
  }

  private async publishOne(result: PublicDiscoveryResult, tokenDigest: string, verifiedAt: string, now: string): Promise<'published' | 'replayed'> {
    const row = await this.row(result.key);
    const profile = result.resolution.state === 'VERIFIED'
      ? await this.publicationProfile(result.resolution.profile)
      : undefined;
    const resolution = profile === undefined ? result.resolution : { profile, state: 'VERIFIED' as const };
    const resultJson = JSON.stringify(resolution);
    const refreshing = row?.state === 'VERIFIED' && row.refreshState === 'PROCESSING';
    if (refreshing && result.resolution.state !== 'VERIFIED') throw new Error('public-discovery-refresh-not-verified');
    if (refreshing && row.resultJson !== null) {
      const previous = publicDiscoveryTerminalResolutionSchema.parse(JSON.parse(row.resultJson));
      if (previous.state !== 'VERIFIED' || previous.profile.workId !== profile?.workId) throw new Error('public-discovery-metadata-identity-conflict');
    }
    if (refreshing && row.resultJson === resultJson && row.claimTokenHash === tokenDigest && row.requestDigest === result.requestDigest) {
      const completed = await this.database.prepare(`UPDATE public_discovery_requests_v3 SET
        verified_at = ?5, next_refresh_at = ?6, refresh_state = 'IDLE', refresh_attempt_count = 0,
        claim_token_hash = NULL, lease_until = NULL, updated_at = ?5
        WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
          AND state = 'VERIFIED' AND refresh_state = 'PROCESSING' AND claim_token_hash = ?7
          AND request_digest = ?8 AND lease_until > ?9
        RETURNING state`).bind(...keyValues(result.key), verifiedAt, futureIso(verifiedAt, refreshFreshnessMilliseconds), tokenDigest, result.requestDigest, now).first();
      if (!completed) throw new Error('stale-public-discovery-result');
      return 'replayed';
    }
    if (row && row.state === result.resolution.state && row.requestDigest === result.requestDigest && row.resultJson === resultJson) {
      if (result.resolution.state === 'VERIFIED') {
        await this.materializeCanonicalReplay(result, publicDiscoveryVerifiedProfileSchema.parse(result.resolution.profile), resultJson, verifiedAt);
      }
      return 'replayed';
    }
    if (!row || (row.state !== 'PROCESSING' && !refreshing) || row.claimTokenHash !== tokenDigest || row.requestDigest !== result.requestDigest) throw new Error('stale-public-discovery-result');
    const canonical = profile ? this.canonicalFacts(profile) : undefined;
    const guardValues = this.publicationGuardValues(result, profile, tokenDigest, now);
    const catalogue = profile && canonical && await this.catalogueNeedsPublication(profile, canonical)
      ? this.catalogueStatements(profile, canonical, verifiedAt, [...keyValues(result.key), tokenDigest, result.requestDigest, now])
      : [];
    const statements: Statement[] = [];
    const resultExpiresAt = result.resolution.state === 'VERIFIED'
      ? null
      : futureIso(verifiedAt, negativeResultFreshnessMilliseconds);
    statements.push(this.database.prepare(`UPDATE public_discovery_requests_v3 SET
      state = ?, result_json = ?, verified_at = ?, retry_at = ?,
      result_expires_at = ?,
      updated_at = ?, request_json = '{}', search_progress_json = NULL, purge_after = NULL,
      next_refresh_at = CASE WHEN ?1 = 'VERIFIED' THEN ?7 ELSE next_refresh_at END,
      refresh_state = 'IDLE', refresh_attempt_count = 0
      WHERE fingerprint = ? AND media_kind = ? AND parser_version = ? AND rules_version = ?
        AND (state = 'PROCESSING' OR (state = 'VERIFIED' AND refresh_state = 'PROCESSING'))
        AND claim_token_hash = ? AND request_digest = ? AND lease_until > ?
          AND NOT EXISTS (SELECT 1 FROM json_each(?) AS proposed
          CROSS JOIN catalogue_external_references AS existing INDEXED BY sqlite_autoindex_catalogue_external_references_1
            ON existing.provider = json_extract(proposed.value, '$.provider')
            AND existing.external_id = json_extract(proposed.value, '$.externalId')
          WHERE existing.work_id <> ?)`)
      .bind(result.resolution.state, resultJson, verifiedAt, verifiedAt, resultExpiresAt, verifiedAt,
        futureIso(verifiedAt, refreshFreshnessMilliseconds), ...guardValues));
    statements.push(...catalogue, this.database.prepare(`UPDATE public_discovery_requests_v3
      SET claim_token_hash = NULL, lease_until = NULL
      WHERE fingerprint = ?1 AND media_kind = ?2 AND parser_version = ?3 AND rules_version = ?4
        AND state IN ('VERIFIED', 'NOT_FOUND', 'AMBIGUOUS') AND refresh_state = 'IDLE'
        AND claim_token_hash = ?5 AND request_digest = ?6 AND lease_until > ?7`)
      .bind(...keyValues(result.key), tokenDigest, result.requestDigest, now));
    const outcomes = await this.database.batch(statements);
    const terminal = outcomes.at(-1);
    if (!terminal?.success || outcomes.some((outcome) => !outcome.success)) throw new Error('public-discovery-batch-failed');
    if (terminal.meta.changes !== 1) {
      const current = await this.row(result.key);
      if (current?.state === result.resolution.state && current.requestDigest === result.requestDigest && current.resultJson === resultJson) return 'replayed';
      throw new Error('stale-public-discovery-result');
    }
    return 'published';
  }

  async publishBatch(input: PublicDiscoveryResultBatch, tokenDigest: string, resultDigest: string, now: string) {
    const batch = publicDiscoveryResultBatchSchema.parse(input);
    const nonce = await this.database.prepare('SELECT result_digest AS resultDigest FROM public_discovery_result_nonces_v3 WHERE nonce = ?1 LIMIT 1')
      .bind(batch.nonce).first<{ resultDigest: string }>();
    if (nonce) {
      if (nonce.resultDigest !== resultDigest) throw new Error('public-discovery-nonce-conflict');
      for (const result of batch.results) await this.publishOne(result, tokenDigest, batch.verifiedAt, now);
      return { published: 0, replayed: batch.results.length };
    }
    let published = 0;
    let replayed = 0;
    for (const result of batch.results) {
      if (await this.publishOne(result, tokenDigest, batch.verifiedAt, now) === 'published') published += 1;
      else replayed += 1;
    }
    await this.database.prepare(`INSERT INTO public_discovery_result_nonces_v3(nonce, result_digest, created_at, purge_after)
      VALUES (?1, ?2, ?3, ?4)`)
      .bind(batch.nonce, resultDigest, batch.verifiedAt, futureIso(now, nonceRetentionMilliseconds)).first();
    return { published, replayed };
  }
}
