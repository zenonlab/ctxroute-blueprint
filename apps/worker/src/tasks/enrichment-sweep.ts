import type { Task } from 'graphile-worker';
import { ENRICHMENT_VERSION } from '../enrichment-state.js';
import { MANGAUPDATES_ENRICHMENT_VERSION } from './mangaupdates-enrichment.js';
import { operationalValue } from '../settings.js';

type Helpers=Parameters<Task>[1];

const task:Task=async(_payload,helpers:Helpers)=>{
  const [batch,maxAttempts]=await Promise.all([operationalValue(helpers,'admin.actionBatchSize'),operationalValue(helpers,'metadata.maxAttempts')]);
  const cycle=Math.floor(Date.now()/600000);
  const due=await helpers.query(`SELECT m.id AS "mediaId",m.type
    FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.status IN ('matched','accepted','review')
    LEFT JOIN media_metadata mm ON mm.media_id=m.id AND mm.status='ACTIVE'
    WHERE m.type IN ('ANIME','MANGA','MANHWA','MANHUA') AND mm.media_id IS NULL
      AND (
        NOT EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata')
        OR EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata' AND es.connector_version<>CASE WHEN m.type='ANIME' THEN $2::text ELSE $3::text END)
        OR EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata' AND es.connector_version=CASE WHEN m.type='ANIME' THEN $2::text ELSE $3::text END AND (es.invalidated_at IS NOT NULL OR (es.status IN ('PENDING','FAILED','NO_MATCH') AND es.attempt_count<$4::int AND (es.next_attempt_at IS NULL OR es.next_attempt_at<=now()))))
      )
    ORDER BY m.updated_at LIMIT $1`,[batch,ENRICHMENT_VERSION,MANGAUPDATES_ENRICHMENT_VERSION,maxAttempts]);
  for(const row of due.rows){const task=row.type==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment';await helpers.query("SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3,priority := $4)",[task,JSON.stringify({mediaId:row.mediaId,syncCycle:cycle}),`${task}:${row.mediaId}:metadata:${cycle}`,task==='anilist-enrichment'?-10:0]);}
  const covers=await helpers.query(`SELECT DISTINCT m.id AS "mediaId",m.type
    FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.status IN ('matched','accepted','review')
    LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE'
    WHERE c.media_id IS NULL AND m.type IN ('ANIME','MANGA','MANHWA','MANHUA')
    ORDER BY m.id LIMIT $1`,[batch]);
  for(const row of covers.rows){const task=row.type==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment';await helpers.query("UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND purpose='cover' AND status<>'SUCCESS' AND NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=$1 AND c.status='ACTIVE')",[row.mediaId]);await helpers.query("SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3)",[task,JSON.stringify({mediaId:row.mediaId,cover:true,syncCycle:cycle}),`${task}:${row.mediaId}:cover:${cycle}`]);}
};
export default task;
