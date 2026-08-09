import type {Task} from 'graphile-worker';
import {CONNECTOR_VERSIONS} from '@favlib/config';
import {collectiveTitleKey,FAVORITE_IDENTITY_PARSER_VERSION,FAVORITE_PARSER_ID,PROVIDER_TITLE_MATCHER_VERSION,parseFavorite,sourceDispositionFromUrl,sourceIdentityFromUrl} from '@favlib/metadata';

async function repairOldParserArtifacts(h:any,batch:number){
  const stale=await h.query(`SELECT i.user_id,i.installation_id,i.bookmark_id,i.payload->>'title' AS title,i.payload->>'url' AS url,
      (SELECT review.id FROM favorite_review review WHERE review.user_id=i.user_id AND review.installation_id=i.installation_id AND review.bookmark_id=i.bookmark_id AND review.status='PENDING' AND review.decision IS NULL ORDER BY review.created_at LIMIT 1) AS review_id,
      (SELECT review.provider FROM favorite_review review WHERE review.user_id=i.user_id AND review.installation_id=i.installation_id AND review.bookmark_id=i.bookmark_id AND review.status='PENDING' AND review.decision IS NULL ORDER BY review.created_at LIMIT 1) AS provider
    FROM bookmark_import_item i
    WHERE i.event<>'removed'
      AND COALESCE(i.parser_version,0)<$1
      AND NOT EXISTS(SELECT 1 FROM favorite_parser_repair l WHERE l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id AND l.parser_id=$2 AND l.matcher_version=$3)
    ORDER BY i.created_at,i.user_id,i.installation_id,i.bookmark_id LIMIT $4`,[FAVORITE_IDENTITY_PARSER_VERSION,FAVORITE_PARSER_ID,PROVIDER_TITLE_MATCHER_VERSION,batch]);
  for(const row of stale.rows??[]){
    const source=sourceIdentityFromUrl(String(row.url??''));
    const artifact=parseFavorite({title:String(row.title??''),url:String(row.url??''),source});
    await h.query(`UPDATE bookmark_import_item SET parse_artifact=$1::jsonb,parser_id=$2,parser_version=$3,parser_fingerprint=$4,parse_status=$5
      WHERE user_id=$6 AND installation_id=$7 AND bookmark_id=$8 AND COALESCE(parser_version,0)<$3`,[JSON.stringify(artifact),artifact.parser,artifact.version,artifact.fingerprint,artifact.status,row.user_id,row.installation_id,row.bookmark_id]);
    if(!source){
      const disposition=sourceDispositionFromUrl(String(row.url??''));
      if(disposition.status==='excluded'){
        await h.query("UPDATE bookmark_import_item SET classification_status='excluded',classification_reason=$1 WHERE user_id=$2 AND installation_id=$3 AND bookmark_id=$4",[disposition.reason,row.user_id,row.installation_id,row.bookmark_id]);
        await h.query("UPDATE bookmark_media_link SET status='removed',evidence=evidence||$1::jsonb WHERE user_id=$2 AND installation_id=$3 AND bookmark_id=$4",[JSON.stringify({source:'parser-repair',reason:disposition.reason,parserId:FAVORITE_PARSER_ID}),row.user_id,row.installation_id,row.bookmark_id]);
        await h.query("DELETE FROM favorite_review WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status='PENDING' AND decision IS NULL",[row.user_id,row.installation_id,row.bookmark_id]);
      }
    }
    const cleanTitle=artifact.identity?.title??artifact.displayTitle;
    if(source&&cleanTitle&&row.review_id&&row.provider){
      const mediaType=row.provider==='anilist'?'ANIME':'MANGA';
      const key=collectiveTitleKey({provider:row.provider,mediaType,parsedTitle:cleanTitle});
      const cluster=await h.query(`INSERT INTO review_title_cluster(cluster_key,provider,media_type,parsed_title,raw_title_sample)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(cluster_key) DO UPDATE SET updated_at=now() RETURNING id`,[key,row.provider,mediaType,cleanTitle,row.title]);
      await h.query(`UPDATE favorite_review SET favorite_title=$1,cluster_id=$2,reason='PARSER_REASSESSMENT'
        WHERE id=$3 AND status='PENDING' AND decision IS NULL`,[cleanTitle,cluster.rows[0]?.id,row.review_id]);
      await h.query('DELETE FROM favorite_review_candidate WHERE review_id=$1',[row.review_id]);
    }
    await h.query(`INSERT INTO favorite_parser_repair(user_id,installation_id,bookmark_id,parser_id,matcher_version,status)
      VALUES($1,$2,$3,$4,$5,'COMPLETED') ON CONFLICT DO NOTHING`,[row.user_id,row.installation_id,row.bookmark_id,FAVORITE_PARSER_ID,PROVIDER_TITLE_MATCHER_VERSION]);
    if(row.review_id){
      const media=await h.query(`SELECT media_id FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND status IN ('matched','accepted','review')`,[row.user_id,row.installation_id,row.bookmark_id]);
      // Parser repair updates the durable raw artifact only. It deliberately
      // does not enqueue source resolution, which could move or merge a
      // personal bookmark without a user decision.
    }
  }
  return stale.rowCount??stale.rows?.length??0;
}

/** Requeues provider-owned clusters in bounded batches. Provider workers rebuild
 * aliases with the shared parser/matcher and remain behind the global waitlist.
 * The ledger makes identical cluster/provider/version runs idempotent. */
const task:Task=async(raw,helpers)=>{
  const h=helpers as any;
  const batch=Math.min(100,Math.max(1,Number((raw as any)?.batch??25)));
  const parserRepairs=await repairOldParserArtifacts(h,batch);
  if(parserRepairs>=batch) await h.query("SELECT graphile_worker.add_job('reassess-favorite-reviews',$1::json,job_key := $2,max_attempts := 3,priority := -100,job_key_mode := 'replace')",[JSON.stringify({batch}),`favorite-parser-repair:drain:${FAVORITE_PARSER_ID}:${PROVIDER_TITLE_MATCHER_VERSION}`]);
  const completed=await h.query(`WITH outcome AS (
    SELECT a.cluster_id,a.provider,
      NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.decision IS NULL) AS resolved,
      EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.reason='AMBIGUOUS') AS ambiguous,
      EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.reason IN ('NO_RESULT','LOW_CONFIDENCE')) AS no_result
    FROM review_matcher_reassessment a WHERE a.matcher_version=$1 AND a.status='QUEUED'
  ) UPDATE review_matcher_reassessment a SET status='COMPLETED',completed_at=now(),updated_at=now(),
    resolved_count=CASE WHEN o.resolved THEN 1 ELSE 0 END,ambiguity_count=CASE WHEN o.ambiguous THEN 1 ELSE 0 END,no_result_count=CASE WHEN o.no_result THEN 1 ELSE 0 END
    FROM outcome o WHERE a.cluster_id=o.cluster_id AND a.provider=o.provider AND a.matcher_version=$1 AND (o.resolved OR o.ambiguous OR o.no_result)
    RETURNING a.resolved_count,a.ambiguity_count,a.no_result_count`,[PROVIDER_TITLE_MATCHER_VERSION]);
  const errored=await h.query(`WITH failures AS (
    SELECT a.cluster_id,a.provider,(SELECT e.error_code FROM media_enrichment_state e JOIN bookmark_media_link l ON l.media_id=e.media_id JOIN favorite_review r ON r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id WHERE r.cluster_id=a.cluster_id AND e.provider=a.provider AND e.purpose='metadata' AND e.status IN ('FAILED','TERMINAL') ORDER BY e.updated_at DESC LIMIT 1) AS error_code
    FROM review_matcher_reassessment a WHERE a.matcher_version=$1 AND a.status='QUEUED'
  ) UPDATE review_matcher_reassessment a SET status='ERROR',last_error_code=f.error_code,
    completed_at=now(),updated_at=now()
    FROM failures f WHERE a.cluster_id=f.cluster_id AND a.provider=f.provider AND a.matcher_version=$1 AND f.error_code IS NOT NULL
    `,[PROVIDER_TITLE_MATCHER_VERSION]);
  const rows=await h.query(`SELECT cl.id,cl.provider,array_agg(DISTINCT l.media_id) FILTER(WHERE l.media_id IS NOT NULL) AS media_ids
    FROM review_title_cluster cl JOIN favorite_review r ON r.cluster_id=cl.id AND r.status='PENDING' AND r.decision IS NULL
    LEFT JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
    WHERE cl.provider IN ('anilist','mangaupdates') AND NOT EXISTS(SELECT 1 FROM review_matcher_reassessment a WHERE a.cluster_id=cl.id AND a.provider=cl.provider AND a.matcher_version=$1 AND a.status IN ('QUEUED','COMPLETED'))
    GROUP BY cl.id,cl.provider ORDER BY cl.id LIMIT $2`,[PROVIDER_TITLE_MATCHER_VERSION,batch]);
  for(const row of rows.rows??[]){
    await h.query(`INSERT INTO review_matcher_reassessment(cluster_id,provider,matcher_version,status,examined_count)
      VALUES($1,$2,$3,'QUEUED',1) ON CONFLICT(cluster_id,provider,matcher_version) DO UPDATE SET status='QUEUED',attempt_count=review_matcher_reassessment.attempt_count+1,last_error_code=NULL,updated_at=now()`,[row.id,row.provider,PROVIDER_TITLE_MATCHER_VERSION]);
    const connector=row.provider==='anilist'?CONNECTOR_VERSIONS.anilistMetadata:CONNECTOR_VERSIONS.mangaUpdatesMetadata;
    for(const mediaId of row.media_ids??[])
      await h.query("SELECT graphile_worker.add_job($1,$2::json,job_key := $3,max_attempts := 3,job_key_mode := 'replace')",[`${row.provider}-enrichment`,JSON.stringify({mediaId,forceRefresh:true,reassessment:{clusterId:row.id,matcherVersion:PROVIDER_TITLE_MATCHER_VERSION}}),`review-reassess:${row.provider}:${connector}:${PROVIDER_TITLE_MATCHER_VERSION}:${row.id}:${mediaId}`]);
  }
  const totals=(completed.rows??[]).reduce((sum:any,row:any)=>({resolved:sum.resolved+Number(row.resolved_count??0),ambiguities:sum.ambiguities+Number(row.ambiguity_count??0),noResults:sum.noResults+Number(row.no_result_count??0)}),{resolved:0,ambiguities:0,noResults:0});
  h.logger.info(`[review-reassessment] ${JSON.stringify({parserId:FAVORITE_PARSER_ID,matcherVersion:PROVIDER_TITLE_MATCHER_VERSION,parserRepairs,clustersExamined:rows.rows?.length??0,completed:completed.rowCount??0,errors:errored.rowCount??0,...totals,queueReducedBy:(completed.rowCount??0)+(errored.rowCount??0)})}`);
};
export default task;
