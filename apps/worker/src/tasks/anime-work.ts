import {buildLinearAnimeChain} from '@favlib/progression';
import type {AniListMedia} from '@favlib/metadata';
import {CONNECTOR_VERSIONS} from '@favlib/config';

type Queryable={query:(sql:string,values?:unknown[])=>Promise<any>};
type Helpers=Queryable&{withPgClient?:<T>(callback:(client:Queryable)=>Promise<T>)=>Promise<T>};
const allowed=new Set(['TV','TV_SHORT','ONA']);

async function reconcileAnimeWork(h:Queryable,mediaId:string,item:AniListMedia,payloadHash:string){
  for(const relation of item.relations.filter(value=>value.type==='ANIME'&&value.relationType)){
    const relationType=relation.relationType!;
    const mainSequence=['PREQUEL','SEQUEL'].includes(relationType)&&allowed.has(String(relation.format??'').toUpperCase());
    const childId=`anilist:${relation.id}`;
    await h.query("INSERT INTO media(id,type,format) VALUES($1,'ANIME',$2) ON CONFLICT(id) DO UPDATE SET format=COALESCE(media.format,excluded.format)",[childId,relation.format??null]);
    await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'anilist',$2,$3::jsonb) ON CONFLICT(provider,external_id) DO NOTHING",[childId,String(relation.id),JSON.stringify({provider:'anilist',relationFrom:item.id,relationType:relation.relationType,payloadHash})]);
    await h.query("INSERT INTO media_relation(media_id,target_media_id,kind,provenance) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(media_id,target_media_id,kind) DO UPDATE SET provenance=excluded.provenance",[mediaId,childId,relationType,JSON.stringify({provider:'anilist',anilistId:item.id,targetAniListId:relation.id,payloadHash})]);
    const enrichment=await h.query(`SELECT
      EXISTS(SELECT 1 FROM provider_payload payload WHERE payload.media_id=$1 AND payload.provider='anilist' AND payload.is_current) AS "payloadReady",
      EXISTS(SELECT 1 FROM media_cover cover WHERE cover.media_id=$1 AND cover.status='ACTIVE' AND (cover.data IS NOT NULL OR cover.asset_sha256 IS NOT NULL)) AS "coverReady"`,[childId]);
    if(!enrichment.rows[0]?.payloadReady)
      await h.query("SELECT graphile_worker.add_job('anilist-enrichment',$1::json,job_key := $2,max_attempts := 3,priority := -15,job_key_mode := 'preserve_run_at')",[JSON.stringify({mediaId:childId,animeRelationDiscovery:true,forceRefresh:true}),`anilist-relation:${CONNECTOR_VERSIONS.anilistMetadata}:${relation.id}`]);
    else if(!enrichment.rows[0]?.coverReady)
      await h.query("SELECT graphile_worker.add_job('anilist-cover',$1::json,job_key := $2,max_attempts := 3,priority := -15,job_key_mode := 'preserve_run_at')",[JSON.stringify({mediaId:childId,source:'anilist-relation'}),`anilist-relation-cover:${CONNECTOR_VERSIONS.anilistCover}:${relation.id}`]);
  }
  const component=await h.query(`WITH RECURSIVE component(id) AS (
    SELECT $1::text UNION
    SELECT CASE WHEN r.media_id=c.id THEN r.target_media_id ELSE r.media_id END FROM component c JOIN media_relation r ON r.media_id=c.id OR r.target_media_id=c.id WHERE r.kind IN ('PREQUEL','SEQUEL')
  ) SELECT m.id,m.format,e.external_id AS anilist_id,
    (SELECT (a.value#>>'{}')::int FROM metadata_assertion a WHERE a.media_id=m.id AND a.provider='anilist' AND a.field='episodes' AND jsonb_typeof(a.value)='number' ORDER BY a.asserted_at DESC LIMIT 1) AS episode_total,
    EXISTS(SELECT 1 FROM provider_payload p WHERE p.media_id=m.id AND p.provider='anilist' AND p.is_current) AS payload_ready,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',CASE WHEN r.media_id=m.id THEN r.target_media_id ELSE r.media_id END,'kind',CASE WHEN r.media_id=m.id THEN r.kind WHEN r.kind='PREQUEL' THEN 'SEQUEL' ELSE 'PREQUEL' END)) FROM media_relation r WHERE (r.media_id=m.id OR r.target_media_id=m.id) AND r.kind IN ('PREQUEL','SEQUEL')),'[]'::jsonb) relations
    FROM component c JOIN media m ON m.id=c.id JOIN media_external_id e ON e.media_id=m.id AND e.provider='anilist'`,[mediaId]);
  if(component.rows.some((row:any)=>!row.payload_ready))return {status:'incomplete' as const};
  const result=buildLinearAnimeChain(component.rows.map((row:any)=>({id:row.id,format:row.format,episodeTotal:row.episode_total===null?null:Number(row.episode_total),relations:row.relations})),mediaId);
  if(result.status==='ambiguous'){
    await h.query(`WITH affected AS (
      SELECT DISTINCT l.user_id,l.installation_id,l.bookmark_id,i.payload->>'title' AS title,i.payload->>'url' AS url
      FROM bookmark_media_link l JOIN bookmark_import_item i USING(user_id,installation_id,bookmark_id)
      WHERE l.media_id=ANY($1::text[]) AND l.status IN ('matched','accepted') AND i.event<>'removed'
    ) INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason)
      SELECT user_id,installation_id,bookmark_id,COALESCE(title,''),url,'anilist-chain','PENDING','ANIME_CHAIN_AMBIGUOUS' FROM affected
      ON CONFLICT(user_id,installation_id,bookmark_id,provider) DO UPDATE SET reason=excluded.reason
      WHERE favorite_review.status='PENDING'`,[component.rows.map((row:any)=>row.id)]);
    await h.query(`DELETE FROM favorite_review_candidate candidate USING favorite_review review
      WHERE candidate.review_id=review.id AND review.provider='anilist-chain' AND review.status='PENDING'
        AND EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id AND link.media_id=ANY($1::text[]))`,[component.rows.map((row:any)=>row.id)]);
    await h.query(`INSERT INTO favorite_review_candidate(review_id,provider_id,canonical_title,url,payload,media_id)
      SELECT review.id,row.id,COALESCE((SELECT value#>>'{}' FROM metadata_assertion WHERE media_id=row.id AND field='title' ORDER BY asserted_at DESC LIMIT 1),row.id),
        'https://anilist.co/anime/'||row.anilist_id,jsonb_build_object('reason',$2::text,'mediaId',row.id,'anilistId',row.anilist_id,'payloadHash',$3::text),row.id
      FROM favorite_review review CROSS JOIN LATERAL (
        SELECT c.id,c.anilist_id FROM jsonb_to_recordset($1::jsonb) AS c(id text,anilist_id text) LIMIT 5
      ) row WHERE review.provider='anilist-chain' AND review.status='PENDING'
        AND EXISTS(SELECT 1 FROM bookmark_media_link link WHERE link.user_id=review.user_id AND link.installation_id=review.installation_id AND link.bookmark_id=review.bookmark_id AND link.media_id=ANY($4::text[]))
      ON CONFLICT(review_id,provider_id) DO UPDATE SET payload=excluded.payload,media_id=excluded.media_id`,[JSON.stringify(component.rows.filter((row:any)=>result.candidates.includes(row.id)).slice(0,5).map((row:any)=>({id:row.id,anilist_id:row.anilist_id}))),result.reason,payloadHash,component.rows.map((row:any)=>row.id)]);
    return result;
  }
  await h.query('DELETE FROM anime_work_member WHERE media_id=ANY($1::text[])',[result.members.map(member=>member.id)]);
  for(const member of result.members){
    const row=component.rows.find((value:any)=>value.id===member.id);
    await h.query("INSERT INTO anime_work_member(root_media_id,media_id,anilist_id,member_order,episode_total,cumulative_offset,status,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",[result.rootId,member.id,row.anilist_id,member.order,member.episodeTotal,member.offset,member.offset===null?'INCOMPLETE':'PROVED',JSON.stringify({provider:'anilist',evidence:'linear-prequel-sequel',payloadHash})]);
  }
  const chainVersion=result.members.map(member=>`${member.id}:${member.episodeTotal??'unknown'}:${member.offset??'blocked'}`).join('|');
  const implied=await h.query(`INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,season,local_position_number,global_position_number,materialization_key,provenance,confidence,consented,observed_at)
    SELECT l.user_id,$1::text,'anilist-season-chain','episode',w.cumulative_offset+COALESCE(max(c.position_number),0),
      (w.cumulative_offset+COALESCE(max(c.position_number),0))::text,w.member_order+1,max(c.position_number),w.cumulative_offset+COALESCE(max(c.position_number),0),
      encode(digest(concat_ws(':',l.user_id::text,$1,w.media_id,COALESCE(max(c.position_number),0)::text,w.cumulative_offset::text,$2::text),'sha256'),'hex'),
      jsonb_build_object('provider','anilist','evidence',CASE WHEN max(c.position_number) IS NULL THEN 'prior-seasons-implied-watched' ELSE 'season-local-plus-proved-offset' END,'seasonMediaId',w.media_id,'offset',w.cumulative_offset,'parserEvidence',jsonb_agg(c.evidence) FILTER(WHERE c.id IS NOT NULL)),
      'high',true,now()
    FROM bookmark_media_link l JOIN anime_work_member w ON w.media_id=l.media_id
    LEFT JOIN favorite_progress_candidate c ON c.user_id=l.user_id AND c.installation_id=l.installation_id AND c.bookmark_id=l.bookmark_id AND c.position_kind='episode'
    JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id AND i.event<>'removed'
    WHERE w.root_media_id=$1 AND w.member_order>0 AND w.cumulative_offset IS NOT NULL AND l.status IN ('matched','accepted')
    GROUP BY l.user_id,w.media_id,w.member_order,w.cumulative_offset
    ON CONFLICT(materialization_key) WHERE materialization_key IS NOT NULL DO UPDATE SET provenance=progression_observation.provenance
    RETURNING id,user_id,position_number,position_raw,season,local_position_number,global_position_number`,[result.rootId,chainVersion]);
  for(const observation of implied.rows)await h.query(`INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id,season,local_position_number,global_position_number)
    VALUES($1,$2,'episode',$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,media_id,position_kind) DO UPDATE SET
    position_number=CASE WHEN favorite_progress.position_number::numeric<=excluded.position_number::numeric THEN excluded.position_number ELSE favorite_progress.position_number END,
    position_raw=CASE WHEN favorite_progress.position_number::numeric<=excluded.position_number::numeric THEN excluded.position_raw ELSE favorite_progress.position_raw END,
    observation_id=CASE WHEN favorite_progress.position_number::numeric<=excluded.position_number::numeric THEN excluded.observation_id ELSE favorite_progress.observation_id END,
    season=CASE WHEN favorite_progress.position_number::numeric<=excluded.position_number::numeric THEN excluded.season ELSE favorite_progress.season END,
    local_position_number=CASE WHEN favorite_progress.position_number::numeric<=excluded.position_number::numeric THEN excluded.local_position_number ELSE favorite_progress.local_position_number END,
    global_position_number=GREATEST(COALESCE(favorite_progress.global_position_number,favorite_progress.position_number::numeric),excluded.global_position_number),updated_at=now()`,[observation.user_id,result.rootId,observation.position_number,observation.position_raw,observation.id,observation.season,observation.local_position_number,observation.global_position_number]);
  await h.query(`WITH aggregate AS (SELECT max(w.cumulative_offset+pp.available_position_number) AS global_number FROM anime_work_member w JOIN provider_progress pp ON pp.media_id=w.media_id AND pp.provider='anilist' AND pp.status='ACTIVE' WHERE w.root_media_id=$1 AND w.cumulative_offset IS NOT NULL AND pp.available_position_number IS NOT NULL)
    UPDATE provider_progress root SET global_position_number=aggregate.global_number,available_position_number=aggregate.global_number,available_position_raw=aggregate.global_number::text,available_position_provenance=root.available_position_provenance||jsonb_build_object('animeWorkRootId',$1::text,'evidence','season-availability-plus-proved-offset'),updated_at=now() FROM aggregate WHERE root.media_id=$1 AND root.provider='anilist' AND aggregate.global_number IS NOT NULL`,[result.rootId]);
  // Card grouping changes only the personal link. Child media and provider IDs remain untouched.
  await h.query("UPDATE bookmark_media_link l SET media_id=$1,evidence=l.evidence||jsonb_build_object('animeSeasonMediaId',l.media_id,'animeWorkRootId',$1::text) WHERE l.media_id=ANY($2::text[]) AND l.media_id<>$1 AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)",[result.rootId,result.members.map(member=>member.id)]);
  return result;
}

export async function recordAndReconcileAnimeWork(h:Helpers,mediaId:string,item:AniListMedia,payloadHash:string){
  if(!h.withPgClient)return reconcileAnimeWork(h,mediaId,item,payloadHash);
  return h.withPgClient(async client=>{
    await client.query('BEGIN');
    try{
      const result=await reconcileAnimeWork(client,mediaId,item,payloadHash);
      await client.query('COMMIT');
      return result;
    }catch(error){
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
