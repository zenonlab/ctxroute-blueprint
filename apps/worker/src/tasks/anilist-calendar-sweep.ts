import type { Task } from "graphile-worker";
import { fetchAniList, fetchAniListCalendar, normalizeTitle, type AniListMedia } from "@favlib/metadata";
import { aniListHooks } from "../anilist-gate.js";
import { normalizedError } from "../enrichment-state.js";
import { normalizeSerializationStatus } from "@favlib/progression";

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
export function latestAniListAvailableEpisode(item:AniListMedia,now=Date.now()){
  const status=normalizeSerializationStatus(item.status);
  if(status==='Completed'&&item.episodes&&item.episodes>0)return {episode:item.episodes,evidence:'completed-total' as const};
  const aired=[...(item.airingSchedule??[]),...(item.nextAiringEpisode?[item.nextAiringEpisode]:[])]
    .filter(x=>x.episode!==undefined&&x.airingAt!==undefined&&x.airingAt*1000<=now)
    .map(x=>x.episode!);
  if(aired.length)return {episode:Math.max(...aired),evidence:'aired-calendar' as const};
  const next=item.nextAiringEpisode;
  if(next?.episode&&next.episode>1&&next.airingAt&&next.airingAt*1000>now)return {episode:next.episode-1,evidence:'next-airing-predecessor' as const};
  return null;
}
export async function processAniListCalendar(
  items: AniListMedia[],
  h: Helpers,
  now = Date.now(),
) {
  let saved = 0;
  for (const item of items) {
    const media = await h.query(
      "SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider='anilist' AND external_id=$1 LIMIT 1",
      [String(item.id)],
    );
    if (!media.rowCount) continue;
    const mediaId = media.rows[0].mediaId;
    const pollPlan = aniListCalendarPollPlan(item,now);
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
    const available=latestAniListAvailableEpisode(item,now);
    const availabilityProvenance=available?{provider:'anilist',anilistId:item.id,evidence:available.evidence,observedAt:new Date(now).toISOString()}:null;
    await h.query(
      `INSERT INTO provider_progress(media_id,provider,serialization_status,available_position_kind,available_position_number,available_position_raw,available_position_provenance,last_checked_at,next_attempt_at,status,last_error,provenance,updated_at)
       VALUES($1,'anilist',$2,$3,$4,$5,$6,now(),$7,'ACTIVE',NULL,$8,now())
       ON CONFLICT(media_id,provider) DO UPDATE SET serialization_status=COALESCE(excluded.serialization_status,provider_progress.serialization_status),available_position_kind=COALESCE(excluded.available_position_kind,provider_progress.available_position_kind),available_position_number=CASE WHEN excluded.available_position_number IS NULL OR provider_progress.available_position_number>excluded.available_position_number THEN provider_progress.available_position_number ELSE excluded.available_position_number END,available_position_raw=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_raw ELSE provider_progress.available_position_raw END,available_position_provenance=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_provenance ELSE provider_progress.available_position_provenance END,last_checked_at=now(),next_attempt_at=excluded.next_attempt_at,status='ACTIVE',last_error=NULL,provenance=provider_progress.provenance||excluded.provenance,updated_at=now()`,
      [mediaId,normalizeSerializationStatus(item.status)??null,available?'episode':null,available?.episode??null,available?String(available.episode):null,availabilityProvenance,pollPlan.nextCheckAt,{provider:'anilist',calendarPriority:pollPlan.priority,pollReason:pollPlan.reason,nextAiringAt:item.nextAiringEpisode?.airingAt??null,terminalAvailabilityChecked:TERMINAL_STATUSES.has(item.status??'')}],
    );
  }
  return { status: "OK", saved };
}
export async function ensureAniListCalendarCatalog(items:AniListMedia[],h:Helpers){
  for(const item of items){
    const mediaId=`anilist:${item.id}`;
    await h.query("INSERT INTO media(id,type,season_year,format) VALUES($1,'ANIME',$2,$3) ON CONFLICT(id) DO UPDATE SET season_year=COALESCE(excluded.season_year,media.season_year),format=COALESCE(excluded.format,media.format)",[mediaId,item.seasonYear??null,item.format??null]);
    await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'anilist',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",[mediaId,String(item.id),{provider:'anilist',source:'global-airing-calendar',anilistId:item.id}]);
    const titles=[
      [item.title.romaji,'und','Latn','romaji','romaji'],
      [item.title.english,'en','Latn','translation','english'],
      [item.title.userPreferred,'und',null,'official','userPreferred'],
      [item.title.native,'ja','Jpan','native','native'],
      ...item.synonyms.map(title=>[title,'und',null,'synonym','synonym']),
    ].filter((row):row is [string,string,string|null,string,string]=>Boolean(row[0]));
    for(const [title,language,script,kind,titleType] of titles){
      const provenance={provider:'anilist',source:'global-airing-calendar',anilistId:item.id,titleType};
      await h.query("INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,'anilist',1,$8) ON CONFLICT DO NOTHING",[mediaId,title,normalizeTitle(title),language,script,kind,titleType,provenance]);
    }
    await h.query("INSERT INTO media_metadata(media_id,provider,external_id,source_url,status,resolved_at,updated_at) VALUES($1,'anilist',$2,$3,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider='anilist',external_id=excluded.external_id,source_url=excluded.source_url,status='ACTIVE',updated_at=now()",[mediaId,String(item.id),item.siteUrl??`https://anilist.co/anime/${item.id}`]);
    await h.query("SELECT graphile_worker.add_job('anilist-enrichment',$1,job_key := $2,max_attempts := 3,priority := -20,job_key_mode := 'replace')",[JSON.stringify({mediaId,cover:true}),`calendar-cover:anilist:${item.id}`]);
  }
}
const task: Task = async (_payload, helpers) => {
  const h = helpers as unknown as Helpers;
  const now=Math.floor(Date.now()/1000);
  const globalItems=await fetchAniListCalendar(now-7*24*60*60,now+21*24*60*60,{hooks:aniListHooks(h,{kind:'global-calendar',priority:95,scopeKey:'global-airing-calendar'}),maxPages:20});
  await ensureAniListCalendarCatalog(globalItems,h);
  const due = await h.query(
    `SELECT DISTINCT e.external_id AS "externalId",
       COALESCE((p.provenance->>'calendarPriority')::int,50) AS priority
       FROM media_external_id e
       JOIN media m ON m.id=e.media_id
       LEFT JOIN provider_progress p ON p.media_id=m.id AND p.provider='anilist'
      WHERE e.provider='anilist' AND m.type='ANIME'
        AND EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.media_id=m.id AND link.status IN ('matched','accepted'))
        AND (NOT EXISTS(SELECT 1 FROM metadata_assertion assertion WHERE assertion.media_id=m.id AND assertion.provider='anilist' AND assertion.field='status' AND upper(assertion.value#>>'{}') IN ('FINISHED','CANCELLED')) OR COALESCE(p.provenance->>'terminalAvailabilityChecked','false')<>'true')
        AND (p.next_attempt_at IS NULL OR p.next_attempt_at<=now())
      ORDER BY priority DESC,e.external_id
      LIMIT 100`,
  );
  if (!due.rowCount){await processAniListCalendar(globalItems,h);return;}
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
  const items = [...new Map([...globalItems,...settled.flatMap(result=>result.status==='fulfilled'?[result.value]:[])].map(item=>[item.id,item])).values()];
  await processAniListCalendar(items, h);
};
export default task;
