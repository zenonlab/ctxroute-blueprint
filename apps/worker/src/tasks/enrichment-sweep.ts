import type { Task } from 'graphile-worker';
import { ENRICHMENT_VERSION } from '../enrichment-state.js';
import { MANGAUPDATES_ENRICHMENT_VERSION } from './mangaupdates-enrichment.js';
import { operationalValue } from '../settings.js';
import { CONNECTOR_VERSIONS } from '@favlib/config';
import { position } from '@favlib/progression';

type Helpers=Parameters<Task>[1];

export async function backfillKnownProviderAvailability(helpers:Pick<Helpers,'query'>,limit:number){
  const known=await helpers.query(`SELECT DISTINCT ON (a.media_id) a.media_id AS "mediaId",a.value#>>'{}' AS raw,a.source_url AS "sourceUrl",a.asserted_at AS "assertedAt",mm.external_id AS "externalId" FROM metadata_assertion a JOIN media_metadata mm ON mm.media_id=a.media_id AND mm.provider='mangaupdates' AND mm.status='ACTIVE' LEFT JOIN provider_progress pp ON pp.media_id=a.media_id AND pp.provider='mangaupdates' WHERE a.provider='mangaupdates' AND a.field='latestChapter' AND pp.available_position_number IS NULL ORDER BY a.media_id,a.asserted_at DESC LIMIT $1`,[limit]);
  let saved=0;
  for(const row of known.rows){const parsed=position(String(row.raw),'chapter');if(parsed.number===undefined)continue;const provenance={provider:'mangaupdates',seriesId:row.externalId,evidence:'metadata-assertion',sourceUrl:row.sourceUrl};await helpers.query(`INSERT INTO provider_progress(media_id,provider,latest_chapter,available_position_kind,available_position_number,available_position_raw,available_position_provenance,last_checked_at,status,last_error,provenance,updated_at) VALUES($1,'mangaupdates',$2,'chapter',$3,$2,$4,COALESCE($5::timestamptz,now()),'ACTIVE',NULL,$4,now()) ON CONFLICT(media_id,provider) DO UPDATE SET latest_chapter=COALESCE(provider_progress.latest_chapter,excluded.latest_chapter),available_position_kind='chapter',available_position_number=CASE WHEN provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number THEN excluded.available_position_number ELSE provider_progress.available_position_number END,available_position_raw=CASE WHEN provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number THEN excluded.available_position_raw ELSE provider_progress.available_position_raw END,available_position_provenance=CASE WHEN provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number THEN excluded.available_position_provenance ELSE provider_progress.available_position_provenance END,status='ACTIVE',last_error=NULL,updated_at=now()`,[row.mediaId,row.raw,parsed.number,provenance,row.assertedAt]);saved++;}
  return saved;
}

export async function reconcileMergedEnrichment(helpers:Pick<Helpers,'query'>){
  // A successful resolution may merge a provisional source identity into an
  // existing canonical identity. Remove only the now-unlinked empty projection
  // so it cannot masquerade as a local work without availability.
  const cleaned=await helpers.query(`DELETE FROM provider_progress stale
    USING media_identity_merge merge
    WHERE stale.media_id=merge.source_media_id AND stale.provider=merge.provider
      AND stale.available_position_number IS NULL
      AND NOT EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.media_id=merge.source_media_id)
      AND EXISTS(SELECT 1 FROM provider_progress current WHERE current.media_id=merge.target_media_id AND current.provider=merge.provider)
    RETURNING stale.media_id`);
  // SUCCESS is not terminal truth: if neither the provisional identity nor its
  // merge target contains the provider projection, invalidate it for the normal
  // bounded retry lane.
  const retried=await helpers.query(`UPDATE media_enrichment_state state SET
      status='FAILED',error_code='SUCCESS_PROJECTION_MISSING',next_attempt_at=now(),invalidated_at=now(),updated_at=now()
    WHERE state.purpose='metadata' AND state.status='SUCCESS' AND state.external_id IS NOT NULL
      AND NOT EXISTS(
        SELECT 1 FROM media_metadata metadata
        WHERE metadata.provider=state.provider AND metadata.external_id=state.external_id AND metadata.status='ACTIVE'
          AND (metadata.media_id=state.media_id OR metadata.media_id IN (
            SELECT merge.target_media_id FROM media_identity_merge merge
            WHERE merge.source_media_id=state.media_id AND merge.provider=state.provider AND merge.external_id=state.external_id
          ))
      )
    RETURNING state.media_id`);
  return {cleaned:cleaned.rowCount??cleaned.rows.length,retried:retried.rowCount??retried.rows.length};
}

const task:Task=async(_payload,helpers:Helpers)=>{
  const [batch,maxAttempts]=await Promise.all([operationalValue(helpers,'admin.actionBatchSize'),operationalValue(helpers,'metadata.maxAttempts')]);
  await reconcileMergedEnrichment(helpers);
  await backfillKnownProviderAvailability(helpers,Math.max(batch,2_000));
  const cycle=Math.floor(Date.now()/600000);
  const due=await helpers.query(`SELECT m.id AS "mediaId",m.type
    FROM media m
    WHERE m.type IN ('ANIME','MANGA','MANHWA','MANHUA')
      AND EXISTS(SELECT 1 FROM bookmark_media_link l WHERE l.media_id=m.id AND l.status IN ('matched','accepted','review'))
      AND (
        NOT EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata')
        OR EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata' AND es.connector_version<>CASE WHEN m.type='ANIME' THEN $2::text ELSE $3::text END)
        OR EXISTS (SELECT 1 FROM media_enrichment_state es WHERE es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='metadata' AND es.connector_version=CASE WHEN m.type='ANIME' THEN $2::text ELSE $3::text END AND (es.invalidated_at IS NOT NULL OR (es.status IN ('PENDING','FAILED','NO_MATCH') AND es.attempt_count<$4::int AND (es.next_attempt_at IS NULL OR es.next_attempt_at<=now()))))
      )
    ORDER BY m.updated_at LIMIT $1`,[batch,ENRICHMENT_VERSION,MANGAUPDATES_ENRICHMENT_VERSION,maxAttempts]);
  for(const row of due.rows){const task=row.type==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment';await helpers.query("SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3,priority := $4)",[task,JSON.stringify({mediaId:row.mediaId,syncCycle:cycle}),`${task}:${row.mediaId}:metadata:${cycle}`,task==='anilist-enrichment'?-10:0]);}
  const covers=await helpers.query(`SELECT m.id AS "mediaId",m.type
    FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.status IN ('matched','accepted','review')
    LEFT JOIN media_cover c ON c.media_id=m.id AND c.status='ACTIVE'
    LEFT JOIN media_enrichment_state es ON es.media_id=m.id AND es.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND es.purpose='cover' AND es.connector_version=CASE WHEN m.type='ANIME' THEN $2::text ELSE $3::text END
    WHERE c.media_id IS NULL AND m.type IN ('ANIME','MANGA','MANHWA','MANHUA')
      AND EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE' AND mm.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END AND mm.external_id IS NOT NULL)
      AND (es.media_id IS NULL OR es.status IN ('PENDING','FAILED','NO_MATCH') AND es.attempt_count<$4::int AND (es.next_attempt_at IS NULL OR es.next_attempt_at<=now()))
    GROUP BY m.id,m.type ORDER BY md5(m.id || $5::text),m.id LIMIT $1`,[batch,CONNECTOR_VERSIONS.anilistCover,CONNECTOR_VERSIONS.mangaUpdatesCover,maxAttempts,cycle]);
  for(const row of covers.rows){const task=row.type==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment';await helpers.query("SELECT graphile_worker.add_job($1,$2,job_key := $3,max_attempts := 3)",[task,JSON.stringify({mediaId:row.mediaId,cover:true,syncCycle:cycle}),`${task}:${row.mediaId}:cover:${cycle}`]);}
};
export default task;
