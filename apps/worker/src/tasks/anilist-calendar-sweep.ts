import type { Task } from "graphile-worker";
import { fetchAniList, type AniListMedia } from "@favlib/metadata";
import { aniListHooks } from "../anilist-gate.js";
import { normalizedError } from "../enrichment-state.js";

type Helpers = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: any[]; rowCount?: number | null }>;
};
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const TERMINAL_STATUSES = new Set(["FINISHED", "CANCELLED"]);

export function aniListCalendarPollPlan(item: AniListMedia, now = Date.now()) {
  const status = item.status ?? "UNKNOWN";
  const nextAiringAt = item.nextAiringEpisode?.airingAt
    ? item.nextAiringEpisode.airingAt * 1000
    : undefined;
  if (TERMINAL_STATUSES.has(status))
    return { priority: 0, nextCheckAt: null, reason: status };
  if (nextAiringAt) {
    const until = nextAiringAt - now;
    const delay = until <= 2 * DAY ? 6 * HOUR : Math.min(DAY, Math.max(6 * HOUR, until - DAY));
    return {
      priority: until <= 2 * DAY ? 100 : 80,
      nextCheckAt: new Date(now + delay),
      reason: status === "HIATUS" ? "HIATUS_RESUME_SCHEDULED" : "NEXT_AIRING_KNOWN",
    };
  }
  if (status === "HIATUS")
    return { priority: 10, nextCheckAt: new Date(now + 30 * DAY), reason: "HIATUS_WITHOUT_DATE" };
  if (status === "NOT_YET_RELEASED")
    return { priority: 30, nextCheckAt: new Date(now + 7 * DAY), reason: "START_NOT_SCHEDULED" };
  if (status === "RELEASING")
    return { priority: 70, nextCheckAt: new Date(now + 12 * HOUR), reason: "RELEASING_WITHOUT_NEXT_AIRING" };
  return { priority: 20, nextCheckAt: new Date(now + 14 * DAY), reason: "STATUS_RECHECK" };
}
export async function processAniListCalendar(
  items: AniListMedia[],
  h: Helpers,
) {
  let saved = 0;
  for (const item of items) {
    const media = await h.query(
      "SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider='anilist' AND external_id=$1 LIMIT 1",
      [String(item.id)],
    );
    if (!media.rowCount) continue;
    const mediaId = media.rows[0].mediaId;
    const pollPlan = aniListCalendarPollPlan(item);
    const schedule = [
      ...(item.nextAiringEpisode ? [item.nextAiringEpisode] : []),
      ...(item.airingSchedule ?? []),
    ].filter((x) => x.airingAt && x.episode);
    const currentEpisodes=[...new Set(schedule.map(airing=>airing.episode!))];
    const currentReleaseKeys=currentEpisodes.map(episode=>`${mediaId}|episode|${episode}|none|default`);
    for (const airing of schedule) {
      const key = `${mediaId}|episode|${airing.episode}|none|default`;
      await h.query(
        `INSERT INTO release_announcement(media_id,release_key,provider,status,announced_at,provenance) VALUES($1,$2,'anilist','SCHEDULED',to_timestamp($3),$4) ON CONFLICT(provider,release_key) DO UPDATE SET status='SCHEDULED',announced_at=excluded.announced_at,provenance=excluded.provenance`,
        [
          mediaId,
          key,
          airing.airingAt,
          {
            provider: "anilist",
            anilistId: item.id,
            airingAt: airing.airingAt,
            kind: "anime-calendar",
          },
        ],
      );
      await h.query(
        `INSERT INTO media_airing(media_id,provider,episode,airing_at_utc,source_local_time,source_timezone,precision,schedule_status,last_verified_at,provenance)
         VALUES($1,'anilist',$2,to_timestamp($3),'','UTC','INSTANT','SCHEDULED',now(),$4)
         ON CONFLICT(media_id,provider,episode) DO UPDATE SET airing_at_utc=excluded.airing_at_utc,last_verified_at=now(),schedule_status='SCHEDULED',provenance=excluded.provenance`,
        [
          mediaId,
          airing.episode,
          airing.airingAt,
          { provider: "anilist", anilistId: item.id, airingAt: airing.airingAt, kind: "anime-calendar" },
        ],
      );
      saved++;
    }
    await h.query(`UPDATE media_airing SET schedule_status=$3,last_verified_at=now(),provenance=provenance||$4::jsonb
      WHERE media_id=$1 AND provider='anilist' AND airing_at_utc>now() AND NOT (episode=ANY($2::int[]))`,[
      mediaId,currentEpisodes,TERMINAL_STATUSES.has(item.status??'')?'CANCELLED':'STALE',JSON.stringify({provider:'anilist',reason:TERMINAL_STATUSES.has(item.status??'')?'MEDIA_TERMINAL':'ABSENT_FROM_CURRENT_SCHEDULE'})
    ]);
    await h.query("DELETE FROM release_announcement WHERE media_id=$1 AND provider='anilist' AND status='SCHEDULED' AND announced_at>now() AND NOT (release_key=ANY($2::text[]))",[mediaId,currentReleaseKeys]);
    await h.query(
      "INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,'nextAiringEpisode',$2,'anilist',$3,1,'AniList') ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,asserted_at=now()",
      [
        mediaId,
        JSON.stringify(item.nextAiringEpisode ?? null),
        item.siteUrl ?? `https://anilist.co/anime/${item.id}`,
      ],
    );
    await h.query(
      `INSERT INTO provider_progress(media_id,provider,serialization_status,last_checked_at,next_attempt_at,status,last_error,provenance,updated_at)
       VALUES($1,'anilist',$2,now(),$3,'ACTIVE',NULL,$4,now())
       ON CONFLICT(media_id,provider) DO UPDATE SET serialization_status=excluded.serialization_status,last_checked_at=now(),next_attempt_at=excluded.next_attempt_at,status='ACTIVE',last_error=NULL,provenance=excluded.provenance,updated_at=now()`,
      [mediaId,item.status ?? null,pollPlan.nextCheckAt,{provider:'anilist',calendarPriority:pollPlan.priority,pollReason:pollPlan.reason,nextAiringAt:item.nextAiringEpisode?.airingAt ?? null}],
    );
  }
  return { status: "OK", saved };
}
const task: Task = async (_payload, helpers) => {
  const h = helpers as unknown as Helpers;
  const due = await h.query(
    `SELECT DISTINCT e.external_id AS "externalId",
       COALESCE((p.provenance->>'calendarPriority')::int,50) AS priority
       FROM media_external_id e
       JOIN media m ON m.id=e.media_id
       LEFT JOIN provider_progress p ON p.media_id=m.id AND p.provider='anilist'
      WHERE e.provider='anilist' AND m.type='ANIME'
        AND EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.media_id=m.id AND link.status IN ('matched','accepted'))
        AND COALESCE(p.serialization_status,'') NOT IN ('FINISHED','CANCELLED')
        AND NOT EXISTS(SELECT 1 FROM metadata_assertion assertion WHERE assertion.media_id=m.id AND assertion.provider='anilist' AND assertion.field='status' AND upper(assertion.value#>>'{}') IN ('FINISHED','CANCELLED'))
        AND (p.next_attempt_at IS NULL OR p.next_attempt_at<=now())
      ORDER BY priority DESC,e.external_id
      LIMIT 100`,
  );
  if (!due.rowCount) return;
  // fetchAniList coalesces simultaneous IDs into GraphQL batches of 50. With
  // 100 due entries this creates at most two concurrent, provider-gated calls.
  const settled = await Promise.allSettled(due.rows.map((row) =>
    fetchAniList(Number(row.externalId), { hooks: aniListHooks(h,{kind:'calendar-batch',priority:Number(row.priority),scopeKey:String(row.externalId)}), cache:false }),
  ));
  for(let index=0;index<settled.length;index++)if(settled[index].status==='rejected'){
    const error=normalizedError((settled[index] as PromiseRejectedResult).reason);
    await h.query(`INSERT INTO provider_progress(media_id,provider,last_checked_at,next_attempt_at,status,last_error,provenance,updated_at)
      SELECT e.media_id,'anilist',now(),now()+interval '1 hour','FAILED',$2,jsonb_build_object('provider','anilist','calendarPriority',60,'pollReason','RETRY_AFTER_ERROR'),now()
      FROM media_external_id e WHERE e.provider='anilist' AND e.external_id=$1
      ON CONFLICT(media_id,provider) DO UPDATE SET next_attempt_at=excluded.next_attempt_at,status='FAILED',last_error=excluded.last_error,provenance=provider_progress.provenance||excluded.provenance,updated_at=now()`,[String(due.rows[index].externalId),error]);
  }
  const items = settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[]);
  await processAniListCalendar(items, h);
};
export default task;
