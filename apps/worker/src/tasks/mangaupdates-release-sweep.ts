import { createHash } from "node:crypto";
import type { Task } from "graphile-worker";
import { withProviderRequest } from "@favlib/database/provider-queue";
import {
  fetchMangaUpdatesReleases,
  normalizeTitle,
  type MangaUpdatesRelease,
} from "@favlib/metadata";
import {
  blockProviderUntil,
  normalizedError,
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";
import { normalizeSerializationStatus, position } from "@favlib/progression";

type Helpers = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount?: number | null }>;
  logger?: { warn: (message: string) => void };
};
type MediaRow = {
  mediaId: string;
  type: string;
  year?: number;
  country?: string;
  format?: string;
  muId?: string;
  titles: string[];
};
const LEASE = "mangaupdates-release-sweep";
const OWNER = `mangaupdates-${process.pid}-${Math.random().toString(36).slice(2)}`;
async function providerCall<T>(h: Helpers, call: () => Promise<T>): Promise<T> {
  return withProviderRequest(h,{provider:'mangaupdates',kind:'global-release-feed',priority:90,scopeKey:'global',spacingMs:1000},call);
}

export function mangaUpdatesReleaseKey(
  mediaId: string,
  release: MangaUpdatesRelease,
) {
  const chapter =
    normalizeTitle(release.chapter ?? "unknown").replace(/\s+/g, "-") ||
    "unknown";
  const volume =
    normalizeTitle(release.volume ?? "").replace(/\s+/g, "-") || "none";
  // A language or a group is an origin attribute, not a distinct logical
  // release. This keeps one calendar event per chapter/volume (ADR 0020).
  return `${mediaId}|chapter|${chapter}|${volume}|default`;
}
async function acquireLease(h: Helpers) {
  const result = await h.query(
    `INSERT INTO source_check_lease(scope_key,owner,expires_at) VALUES($1,$2,now()+interval '4 minutes') ON CONFLICT(scope_key) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at,acquired_at=now() WHERE source_check_lease.expires_at<now() RETURNING owner`,
    [LEASE, OWNER],
  );
  return Boolean(result.rowCount);
}
async function heartbeat(h: Helpers) {
  await h.query(
    `INSERT INTO service_heartbeat(service,observed_at) VALUES('mangaupdates',now()) ON CONFLICT(service) DO UPDATE SET observed_at=excluded.observed_at`,
  );
  await h.query(
    `UPDATE source_check_lease SET expires_at=now()+interval '4 minutes' WHERE scope_key=$1 AND owner=$2`,
    [LEASE, OWNER],
  );
}
async function releaseLease(h: Helpers) {
  await h.query(
    "DELETE FROM source_check_lease WHERE scope_key=$1 AND owner=$2",
    [LEASE, OWNER],
  );
}
async function mediaRows(h: Helpers): Promise<MediaRow[]> {
  const result =
    await h.query(`SELECT m.id AS "mediaId",m.type,m.season_year AS year,m.country_of_origin AS country,m.format,
  (SELECT e.external_id FROM media_external_id e WHERE e.media_id=m.id AND e.provider='mangaupdates' LIMIT 1) AS "muId",
  COALESCE((SELECT json_agg(t.text ORDER BY t.kind,t.text) FROM media_title t WHERE t.media_id=m.id AND t.kind<>'personal'),'[]'::json) AS titles
  FROM media m WHERE m.type IN ('MANGA','MANHWA','MANHUA') ORDER BY m.id`);
  return result.rows.map((row) => ({
    ...row,
    titles: Array.isArray(row.titles) ? row.titles : [],
  }));
}
function findMedia(release: MangaUpdatesRelease, rows: MediaRow[]) {
  if (release.seriesId) {
    const byId = rows.find((row) => row.muId === release.seriesId);
    if (byId) return { row: byId, method: "KNOWN_MANGAUPDATES_ID" };
  }
  const aliases = [
    release.title,
    release.seriesTitle,
    ...(release.titles ?? []),
  ].filter((x): x is string => Boolean(x));
  const normalized = new Set(aliases.map(normalizeTitle).filter(Boolean));
  const row = rows.find((item) =>
    item.titles.some((title) => normalized.has(normalizeTitle(title))),
  );
  return row ? { row, method: "TITLE_EXACT" } : null;
}
export async function storeMangaUpdatesCalendarIdentifier(release:MangaUpdatesRelease,h:Helpers){
  if(!release.seriesId)return;
  const title=release.seriesTitle??release.title;
  if(!title)return;
  const raw=release.raw??release;
  const hash=createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const titles=[...new Set([title,release.title,...(release.titles??[])].filter((value):value is string=>Boolean(value)))];
  await h.query("INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,status,image,url,payload) VALUES('mangaupdates',$1,$2,$3,$4,'UNKNOWN','RELEASE_OBSERVED',NULL,$5,$6) ON CONFLICT(provider,provider_id,payload_hash) DO UPDATE SET last_seen_at=now()",[release.seriesId,hash,title,titles,release.url??null,raw]);
  const mediaId=`mangaupdates:${release.seriesId}`;
  await h.query("INSERT INTO media(id,type) VALUES($1,'MANGA') ON CONFLICT(id) DO NOTHING",[mediaId]);
  await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangaupdates',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",[mediaId,release.seriesId,{provider:'mangaupdates',source:'release-search',rawIdentifier:release.seriesId}]);
  for(const value of titles)await h.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,$4,'supplier','associated','mangaupdates',1,$5) ON CONFLICT DO NOTHING",[mediaId,value,normalizeTitle(value),release.language??'und',{provider:'mangaupdates',seriesId:release.seriesId,source:'release-search',rawTitle:value}]);
  // Keep calendar imports on the same priority lane for both providers. The
  // shared provider queue still enforces each API's own rate/concurrency gate.
  await h.query("SELECT graphile_worker.add_job('mangaupdates-enrichment',$1,job_key := $2,max_attempts := 3,priority := -20,job_key_mode := 'replace')",[JSON.stringify({mediaId,forceRefresh:true,providerId:release.seriesId}),`calendar-import:mangaupdates:${release.seriesId}`]);
}

export async function processMangaUpdatesReleases(
  releases: MangaUpdatesRelease[],
  h: Helpers,
  searchSeries?: (query: string) => Promise<any[]>,
) {
  const rows = await mediaRows(h);
  let announcements = 0,
    progress = 0,
    review = 0;
  for (const release of releases) {
    let found = findMedia(release, rows);
    // The global feed is observational. It must never trigger one provider
    // search per unknown release or select the first search result. Identity is
    // resolved beforehand by the dedicated, durable enrichment queue.
    if (!found) {
      await storeMangaUpdatesCalendarIdentifier(release,h);
      review++;
      continue;
    }
    if (release.seriesId) {
      const owner = await h.query(
        "SELECT media_id FROM media_external_id WHERE provider='mangaupdates' AND external_id=$1 LIMIT 1",
        [release.seriesId],
      );
      if (owner.rows[0]?.media_id && owner.rows[0].media_id !== found.row.mediaId) {
        h.logger?.warn?.(
          `[provider-collision] provider=mangaupdates externalId=${release.seriesId} existingMedia=${owner.rows[0].media_id} candidateMedia=${found.row.mediaId} source=release-sweep`,
        );
        review++;
        continue;
      }
      await h.query(
        "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangaupdates',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",
        [
          found.row.mediaId,
          release.seriesId,
          { provider: "mangaupdates", source: "global-release-feed" },
        ],
      );
    }
    const key = mangaUpdatesReleaseKey(found.row.mediaId, release);
    const releaseDate = release.releaseDate ?? null;
    const raw = release.raw ?? release;
    const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
    const provenance = {
      provider: "mangaupdates",
      seriesId: release.seriesId ?? null,
      release: raw,
      match: { method: found.method },
      observedAt: new Date().toISOString(),
    };
    await h.query(
      "INSERT INTO provider_payload(media_id,provider,connector_version,collected_at,payload_hash,payload,provenance,validity_status,is_current) VALUES($1,'mangaupdates','release-v1',now(),$2,$3,$4,'VALID',true) ON CONFLICT(media_id,provider,connector_version,payload_hash) DO UPDATE SET is_current=true",
      [
        found.row.mediaId,
        hash,
        JSON.stringify(raw),
        JSON.stringify({
          source: "global-release-feed",
          seriesId: release.seriesId ?? null,
        }),
      ],
    );
    await h.query(
      "UPDATE provider_payload SET is_current=false WHERE media_id=$1 AND provider='mangaupdates' AND connector_version='release-v1' AND payload_hash<>$2",
      [found.row.mediaId, hash],
    );
    for (const title of [
      ...new Set(
        [release.seriesTitle, release.title, ...(release.titles ?? [])].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ])
      await h.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,$4,NULL,'alias','translation','mangaupdates',$5,$6) ON CONFLICT DO NOTHING",
        [
          found.row.mediaId,
          title,
          normalizeTitle(title),
          release.language ?? "und",
          1,
          {
            provider: "mangaupdates",
            seriesId: release.seriesId ?? null,
            payloadHash: hash,
          },
        ],
      );
    await h.query(
      "INSERT INTO provider_sync_state(media_id,provider,connector_version,last_payload_hash,last_collected_at,last_success_at,status,attempt_count,error,updated_at) VALUES($1,'mangaupdates','release-v1',$2,now(),now(),'SUCCESS',1,NULL,now()) ON CONFLICT(media_id,provider,connector_version) DO UPDATE SET last_payload_hash=excluded.last_payload_hash,last_collected_at=excluded.last_collected_at,last_success_at=excluded.last_success_at,status='SUCCESS',attempt_count=provider_sync_state.attempt_count+1,error=NULL,updated_at=now()",
      [found.row.mediaId, hash],
    );
    const groups = release.group ? [release.group] : [];
    const languages = release.language ? [release.language] : [];
    await h.query(
      "INSERT INTO mangaupdates_release_observation(media_id,provider_release_key,series_id,chapter,volume,release_date,groups,languages,raw_title,payload_id,observed_at,payload_hash,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT id FROM provider_payload WHERE media_id=$1 AND provider='mangaupdates' AND payload_hash=$10 LIMIT 1),now(),$10,$11) ON CONFLICT(media_id,provider_release_key,payload_hash) DO NOTHING",
      [
        found.row.mediaId,
        key,
        release.seriesId ?? null,
        release.chapter ?? null,
        release.volume ?? null,
        releaseDate,
        groups,
        languages,
        release.title ?? release.seriesTitle ?? null,
        hash,
        JSON.stringify(provenance),
      ],
    );
    await h.query(
      `INSERT INTO release_announcement(media_id,release_key,provider,status,announced_at,provenance) VALUES($1,$2,'mangaupdates','ANNOUNCED',COALESCE($3::timestamptz,now()),$4) ON CONFLICT(provider,release_key) DO UPDATE SET announced_at=COALESCE($3::timestamptz,release_announcement.announced_at),provenance=release_announcement.provenance || excluded.provenance`,
      [
        found.row.mediaId,
        key,
        releaseDate,
        JSON.stringify(provenance),
      ],
    );
    announcements++;
    const releasePosition=release.chapter?position(release.chapter,'chapter'):undefined;
    await h.query(
      `INSERT INTO provider_progress(media_id,provider,serialization_status,latest_chapter,latest_volume,available_position_kind,available_position_number,available_position_raw,available_position_provenance,latest_release_at,last_checked_at,status,last_error,provenance,updated_at) VALUES($1,'mangaupdates',$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,now()),now(),'ACTIVE',NULL,$10,now()) ON CONFLICT(media_id,provider) DO UPDATE SET serialization_status=COALESCE(excluded.serialization_status,provider_progress.serialization_status),latest_chapter=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.latest_chapter ELSE provider_progress.latest_chapter END,latest_volume=COALESCE(excluded.latest_volume,provider_progress.latest_volume),available_position_kind=COALESCE(excluded.available_position_kind,provider_progress.available_position_kind),available_position_number=CASE WHEN excluded.available_position_number IS NULL OR provider_progress.available_position_number>excluded.available_position_number THEN provider_progress.available_position_number ELSE excluded.available_position_number END,available_position_raw=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_raw ELSE provider_progress.available_position_raw END,available_position_provenance=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_provenance ELSE provider_progress.available_position_provenance END,latest_release_at=GREATEST(provider_progress.latest_release_at,excluded.latest_release_at),last_checked_at=now(),status='ACTIVE',last_error=NULL,provenance=provider_progress.provenance || excluded.provenance,updated_at=now()`,
      [
        found.row.mediaId,
        normalizeSerializationStatus(release.status) ?? null,
        release.chapter ?? null,
        release.volume ?? null,
        releasePosition?.number===undefined?null:'chapter',
        releasePosition?.number??null,
        release.chapter??null,
        releasePosition?.number===undefined?null:{provider:'mangaupdates',evidence:'global-release',releaseKey:key},
        releaseDate,
        JSON.stringify(provenance),
      ],
    );
    progress++;
  }
  return {
    status: "OK",
    releases: releases.length,
    announcements,
    progress,
    review,
  };
}

const task: Task = async (_payload, helpers) => {
  const h = helpers as unknown as Helpers;
  if (!(await acquireLease(h))) return;
  try {
    await heartbeat(h);
    const now=new Date();
    const monday=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate()-((monday.getUTCDay()+6)%7));
    const end=new Date(now.getTime()+14*86_400_000);
    // MangaUpdates release search has no API-key contract. Keep this request
    // deliberately unauthenticated and never log provider response payloads.
    const options = {startDate:monday.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10)};
    const releases = await providerCall(h, () =>
      fetchMangaUpdatesReleases(options),
    );
    await processMangaUpdatesReleases(releases, h);
    await heartbeat(h);
  } catch (error) {
    const code = normalizedError(error);
    if (code.includes("429"))
      await blockProviderUntil(h, "mangaupdates", Date.now() + 60_000);
    h.logger?.warn(`MangaUpdates sweep failed: ${code}`);
    throw error;
  } finally {
    await releaseLease(h);
  }
};
export default task;
