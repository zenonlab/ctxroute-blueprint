import type {Task} from 'graphile-worker';
import {CONNECTOR_VERSIONS} from '@favlib/config';
import {PROVIDER_TITLE_MATCHER_VERSION} from '@favlib/metadata';

/** Requeues provider-owned clusters in bounded batches. Provider workers rebuild
 * aliases with the shared parser/matcher and remain behind the global waitlist.
 * The ledger makes identical cluster/provider/version runs idempotent. */
const task:Task=async(raw,helpers)=>{
  const h=helpers as any;
  const batch=Math.min(100,Math.max(1,Number((raw as any)?.batch??25)));
  const completed=await h.query(`UPDATE review_matcher_reassessment a SET status='COMPLETED',completed_at=now(),updated_at=now(),
    resolved_count=CASE WHEN NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.decision IS NULL) THEN 1 ELSE 0 END,
    ambiguity_count=CASE WHEN EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.reason='AMBIGUOUS') THEN 1 ELSE 0 END,
    no_result_count=CASE WHEN EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.reason IN ('NO_RESULT','LOW_CONFIDENCE')) THEN 1 ELSE 0 END
    WHERE a.matcher_version=$1 AND a.status='QUEUED' AND (NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.decision IS NULL)
      OR EXISTS(SELECT 1 FROM favorite_review r WHERE r.cluster_id=a.cluster_id AND r.status='PENDING' AND r.reason IN ('AMBIGUOUS','NO_RESULT','LOW_CONFIDENCE')))
    RETURNING resolved_count,ambiguity_count,no_result_count`,[PROVIDER_TITLE_MATCHER_VERSION]);
  const errored=await h.query(`UPDATE review_matcher_reassessment a SET status='ERROR',last_error_code=s.error_code,completed_at=now(),updated_at=now()
    FROM LATERAL(SELECT e.error_code FROM media_enrichment_state e JOIN bookmark_media_link l ON l.media_id=e.media_id JOIN favorite_review r ON r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id WHERE r.cluster_id=a.cluster_id AND e.provider=a.provider AND e.purpose='metadata' AND e.status IN ('FAILED','TERMINAL') ORDER BY e.updated_at DESC LIMIT 1)s
    WHERE a.matcher_version=$1 AND a.status='QUEUED' RETURNING a.cluster_id`,[PROVIDER_TITLE_MATCHER_VERSION]);
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
  h.logger.info(`[review-reassessment] ${JSON.stringify({matcherVersion:PROVIDER_TITLE_MATCHER_VERSION,clustersExamined:rows.rows?.length??0,completed:completed.rowCount??0,errors:errored.rowCount??0,...totals,queueReducedBy:(completed.rowCount??0)+(errored.rowCount??0)})}`);
};
export default task;
