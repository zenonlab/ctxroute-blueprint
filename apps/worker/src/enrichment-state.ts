import { createHash, randomUUID } from "node:crypto";
import { CONNECTOR_VERSIONS } from "@favlib/config";

// Bump when resolution semantics change so old terminal decisions are retried.
export const ENRICHMENT_VERSION = CONNECTOR_VERSIONS.anilistMetadata;
export type EnrichmentStatus =
  "PENDING" | "SUCCESS" | "NO_MATCH" | "FAILED" | "TERMINAL";
type Query = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows?: any[]; rowCount?: number | null }>;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).sort().join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function enrichmentFingerprint(value: unknown) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function normalizedError(error: unknown) {
  const raw =
    error instanceof Error
      ? `${(error as NodeJS.ErrnoException).code ?? ""} ${error.message}`
      : String(error);
  if (/ENOTFOUND|EAI_AGAIN|dns/i.test(raw)) return "DNS_UNAVAILABLE";
  if (/429/.test(raw)) return "RATE_LIMITED";
  if (/AbortError|timeout|aborted/i.test(raw)) return "TIMEOUT";
  if (/IMAGE_HTTP_403/.test(raw)) return "IMAGE_FORBIDDEN";
  if (/IMAGE_MIME_INVALID/.test(raw)) return "IMAGE_MIME_INVALID";
  if (/IMAGE_(?:DECODE|DIMENSIONS|RATIO|ANIMATED|MIME_MISMATCH)/.test(raw))
    return "IMAGE_REJECTED";
  if (/RESPONSE_TOO_LARGE/.test(raw)) return "RESPONSE_TOO_LARGE";
  if (/AMBIGUOUS/i.test(raw)) return "MATCH_AMBIGUOUS";
  return (
    raw
      .replace(/[^A-Za-z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 100) || "UNKNOWN_ERROR"
  );
}
export function retryableProviderError(code: string) {
  return /^(?:TIMEOUT|RATE_LIMITED|HTTP_429|HTTP_5\d\d|MANGAUPDATES_HTTP_5\d\d|ANILIST_HTTP_5\d\d)$/u.test(code) || /(?:TIMEOUT|HTTP_429|HTTP_5\d\d|503)/u.test(code);
}

export async function canonicalEnrichmentInput(db: Query, mediaId: string) {
  const result = await db.query(
    `SELECT m.type,m.season_year AS year,m.format,
    COALESCE((SELECT json_agg(q.normalized_text ORDER BY q.priority,q.normalized_text) FROM (SELECT lower(t.normalized_text) AS normalized_text,MIN(CASE t.kind WHEN 'official' THEN 0 WHEN 'source' THEN 1 WHEN 'synonym' THEN 2 ELSE 3 END) AS priority FROM media_title t WHERE t.media_id=m.id AND t.kind<>'personal' GROUP BY lower(t.normalized_text)) q),'[]'::json) AS titles,
    COALESCE((SELECT json_agg(jsonb_build_object('provider',e.provider,'id',e.external_id) ORDER BY e.provider,e.external_id) FROM media_external_id e WHERE e.media_id=m.id),'[]'::json) AS ids,
    EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE') AS "hasActiveCover"
    FROM media m WHERE m.id=$1`,
    [mediaId],
  );
  return result.rows?.[0] ?? null;
}

export async function waitProviderGate(
  db: Query,
  provider: string,
  spacingMs = 600,
) {
  await db.query(
    `INSERT INTO provider_request_gate(provider,next_allowed_at) VALUES($1,now()) ON CONFLICT(provider) DO NOTHING`,
    [provider],
  );
  const result = await db.query(
    `UPDATE provider_request_gate SET next_allowed_at=GREATEST(next_allowed_at,now())+($2::double precision*interval '1 millisecond'),updated_at=now() WHERE provider=$1 RETURNING next_allowed_at-($2::double precision*interval '1 millisecond') AS "allowedAt"`,
    [provider, spacingMs],
  );
  const allowedAt = new Date(
      result.rows?.[0]?.allowedAt ?? Date.now(),
    ).getTime(),
    wait = allowedAt - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}
export async function acquireProviderSlot(
  db: Query,
  provider: string,
  waitMs = 50,
) {
  await db.query(
    `INSERT INTO provider_request_gate(provider,next_allowed_at)
     VALUES($1,now()) ON CONFLICT(provider) DO NOTHING`,
    [provider],
  );
  for (;;) {
    const result = await db.query(
      `UPDATE provider_request_gate SET in_flight=in_flight+1,updated_at=now() WHERE provider=$1 AND (blocked_until IS NULL OR blocked_until<=now()) AND in_flight<max_in_flight RETURNING provider`,
      [provider],
    );
    if (result.rowCount)
      return async () => {
        await db.query(
          "UPDATE provider_request_gate SET in_flight=GREATEST(0,in_flight-1),updated_at=now() WHERE provider=$1",
          [provider],
        );
      };
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}
export async function blockProviderUntil(
  db: Query,
  provider: string,
  until: number,
) {
  await db.query(
    `INSERT INTO provider_request_gate(provider,next_allowed_at,blocked_until) VALUES($1,to_timestamp($2::double precision/1000),to_timestamp($2::double precision/1000)) ON CONFLICT(provider) DO UPDATE SET next_allowed_at=GREATEST(provider_request_gate.next_allowed_at,excluded.next_allowed_at),blocked_until=GREATEST(provider_request_gate.blocked_until,excluded.blocked_until),updated_at=now()`,
    [provider, until],
  );
}

export async function claimEnrichment(
  db: Query,
  input: {
    mediaId: string;
    provider: string;
    purpose: string;
    version: string;
    fingerprint: string;
    maxAttempts: number;
    owner?: string;
  },
) {
  const owner = input.owner ?? `worker_${randomUUID()}`;
  await db.query(
    `INSERT INTO media_enrichment_state(media_id,provider,purpose,connector_version,input_fingerprint,status)
    VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT DO NOTHING`,
    [
      input.mediaId,
      input.provider,
      input.purpose,
      input.version,
      input.fingerprint,
    ],
  );
  const result = await db.query(
    `UPDATE media_enrichment_state SET
      input_fingerprint=$5,status='PENDING',attempt_count=CASE WHEN input_fingerprint<>$5 OR invalidated_at IS NOT NULL THEN 1 ELSE attempt_count+1 END,
      next_attempt_at=NULL,error_code=NULL,locked_at=now(),locked_by=$6,invalidated_at=NULL,updated_at=now()
    WHERE media_id=$1 AND provider=$2 AND purpose=$3 AND connector_version=$4
      AND (locked_at IS NULL OR locked_at<now()-interval '10 minutes')
      AND (input_fingerprint<>$5 OR invalidated_at IS NOT NULL OR (
        status IN ('PENDING','FAILED','NO_MATCH') AND (next_attempt_at IS NULL OR next_attempt_at<=now()) AND attempt_count<$7
      ))
    RETURNING attempt_count,external_id AS "externalId",locked_by AS owner`,
    [
      input.mediaId,
      input.provider,
      input.purpose,
      input.version,
      input.fingerprint,
      owner,
      input.maxAttempts,
    ],
  );
  return result.rows?.[0] ?? null;
}

export async function finishEnrichment(
  db: Query,
  input: {
    mediaId: string;
    provider: string;
    purpose: string;
    version: string;
    owner: string;
    status: EnrichmentStatus;
    errorCode?: string | null;
    externalId?: string | null;
    retryHours?: number | null;
    retrySeconds?: number | null;
    resolutionCode?: string | null;
  },
) {
  await db.query(
    `UPDATE media_enrichment_state SET status=$6,error_code=$7,external_id=COALESCE($8,external_id),
      next_attempt_at=CASE WHEN $9::int IS NOT NULL THEN now()+make_interval(hours=>$9) WHEN $10::int IS NOT NULL THEN now()+make_interval(secs=>$10) ELSE NULL END,
      resolution_code=COALESCE($11,resolution_code),locked_at=NULL,locked_by=NULL,updated_at=now()
    WHERE media_id=$1 AND provider=$2 AND purpose=$3 AND connector_version=$4 AND locked_by=$5`,
    [
      input.mediaId,
      input.provider,
      input.purpose,
      input.version,
      input.owner,
      input.status,
      input.errorCode ?? null,
      input.externalId ?? null,
      input.retryHours ?? null,
      input.retrySeconds ?? null,
      input.resolutionCode ?? null,
    ],
  );
}

export async function circuitAllows(db: Query, domain: string) {
  const result = await db.query(
    "SELECT status,blocked_until FROM provider_domain_circuit WHERE domain=$1",
    [domain],
  );
  const row = result.rows?.[0];
  return (
    !row ||
    row.status !== "OPEN" ||
    !row.blocked_until ||
    new Date(row.blocked_until).getTime() <= Date.now()
  );
}
export async function openCircuit(
  db: Query,
  domain: string,
  errorCode: string,
  backoffSeconds: number,
  maxBackoffSeconds = backoffSeconds,
) {
  await db.query(
    `INSERT INTO provider_domain_circuit(domain,status,failure_count,blocked_until,error_code) VALUES($1,'OPEN',1,now()+make_interval(secs=>$3),$2) ON CONFLICT(domain) DO UPDATE SET status='OPEN',failure_count=provider_domain_circuit.failure_count+1,blocked_until=now()+make_interval(secs=>LEAST($4,$3*power(2,provider_domain_circuit.failure_count)::int)),error_code=$2,updated_at=now()`,
    [domain, errorCode, backoffSeconds, maxBackoffSeconds],
  );
}
export async function closeCircuit(db: Query, domain: string) {
  await db.query(
    `INSERT INTO provider_domain_circuit(domain,status,failure_count,blocked_until,error_code) VALUES($1,'CLOSED',0,NULL,NULL) ON CONFLICT(domain) DO UPDATE SET status='CLOSED',failure_count=0,blocked_until=NULL,error_code=NULL,updated_at=now()`,
    [domain],
  );
}
