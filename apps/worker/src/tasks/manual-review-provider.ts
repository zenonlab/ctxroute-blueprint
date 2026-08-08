import { createHash } from 'node:crypto';
import { OPERATIONAL_DEFAULTS } from '@favlib/config';
import { withProviderRequest } from '@favlib/database/provider-queue';
import { fetchAniList, fetchMangaUpdatesSeries, resolveMangaUpdatesPublicSlug } from '@favlib/metadata';

type Payload={reviewId:string;userId:string;provider:'anilist'|'mangaupdates';providerId:string};
type Helpers={query:(sql:string,values?:unknown[])=>Promise<{rowCount?:number|null;rows:any[]}>};

export default async function manualReviewProvider(payload:unknown,h:Helpers){
  const {reviewId,userId,provider,providerId}=payload as Payload;
  const owned=await h.query(`SELECT review.favorite_title,
      ARRAY(SELECT DISTINCT peer.favorite_title FROM favorite_review peer
        WHERE peer.user_id=review.user_id AND peer.status='PENDING'
          AND COALESCE(peer.cluster_id::text,peer.id::text)=COALESCE(review.cluster_id::text,review.id::text)) AS source_titles
    FROM favorite_review review WHERE review.id=$1 AND review.user_id=$2 AND review.provider=$3 AND review.status='PENDING'`,[reviewId,userId,provider]);
  if(!owned.rowCount)return;
  const sourceTitles=[...(owned.rows[0]?.source_titles??[]),owned.rows[0]?.favorite_title].filter((value):value is string=>typeof value==='string'&&Boolean(value.trim()));
  let identityMethod='provider-id';
  const record:any=await withProviderRequest<any>(h,{provider,kind:'manual-review',priority:100,scopeKey:`${reviewId}:${providerId}`,spacingMs:provider==='anilist'?2100:350},async()=>{
    if(provider==='anilist')return fetchAniList(Number(providerId),{timeoutMs:OPERATIONAL_DEFAULTS['timeouts.providerMs'],cache:false});
    if(/^\d+$/u.test(providerId))return fetchMangaUpdatesSeries(providerId,{timeoutMs:OPERATIONAL_DEFAULTS['timeouts.providerMs']});
    const linked=await resolveMangaUpdatesPublicSlug(providerId,sourceTitles,{timeoutMs:OPERATIONAL_DEFAULTS['timeouts.providerMs']});
    if(!linked)throw new Error('MANGAUPDATES_PUBLIC_SLUG_UNRESOLVED');
    identityMethod=linked.method;
    return linked.series;
  });
  const stillOwned=await h.query("SELECT 1 FROM favorite_review WHERE id=$1 AND user_id=$2 AND provider=$3 AND status='PENDING' AND decision->>'kind'='manual-queued'",[reviewId,userId,provider]);
  if(!stillOwned.rowCount)return;
  const resolvedProviderId=provider==='mangaupdates'?String(record.id??providerId):providerId;
  const canonicalTitle=provider==='anilist'?(record.title?.userPreferred??record.title?.romaji??record.title?.english??record.title?.native??`AniList ${providerId}`):(record.title??record.titles?.[0]??`MangaUpdates ${providerId}`);
  const associatedTitles=provider==='anilist'?[record.title?.romaji,record.title?.english,record.title?.native,...(record.synonyms??[])].filter(Boolean):[...(record.titles??[]),...(record.associated??[])].filter(Boolean);
  const rawPayload=JSON.stringify({...record,_favlibManualIdentity:{rawProviderId:providerId,resolvedProviderId,method:identityMethod}}),payloadHash=createHash('sha256').update(rawPayload).digest('hex');
  const profile=await h.query(`INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb)
    ON CONFLICT(provider,provider_id,payload_hash) DO UPDATE SET last_seen_at=now() RETURNING id`,[provider,resolvedProviderId,payloadHash,canonicalTitle,[...new Set(associatedTitles)],record.type??(provider==='anilist'?'ANIME':'MANGA'),record.startYear??record.year??null,JSON.stringify(record.startDate??null),record.status??'UNKNOWN',JSON.stringify(record.authors??[]),record.categories??[],record.genres??[],record.coverImage??record.image??null,record.siteUrl??record.url??null,rawPayload]);
  await h.query(`WITH candidate AS (
      INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id,hit_title)
      SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM favorite_review WHERE id=$1 AND user_id=$5 AND status='PENDING')
      ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id,hit_title=excluded.hit_title RETURNING profile_id
    ) INSERT INTO review_cluster_candidate(cluster_id,profile_id)
      SELECT r.cluster_id,c.profile_id FROM favorite_review r CROSS JOIN candidate c WHERE r.id=$1 AND r.cluster_id IS NOT NULL
      ON CONFLICT DO NOTHING`,[reviewId,profile.rows[0].id,providerId,canonicalTitle,userId]);
  await h.query(`INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id)
    SELECT DISTINCT ON (pending.id) pending.id,$2,$3 FROM favorite_review source JOIN favorite_review pending ON pending.cluster_id=source.cluster_id
    WHERE source.id=$1 AND pending.status='PENDING' AND (pending.decision IS NULL OR pending.decision->>'kind'='manual-queued')
    ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id`,[reviewId,profile.rows[0].id,resolvedProviderId]);

  const known=await h.query("SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider=$1 AND external_id=$2 LIMIT 1",[provider,resolvedProviderId]);
  const mediaId=known.rows[0]?.mediaId??`${provider}:${resolvedProviderId}`;
  const mediaType=provider==='anilist'?'ANIME':String(record.type??'MANGA').toUpperCase().replace('WEBTOON','MANHWA');
  await h.query("INSERT INTO media(id,type,season_year) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET season_year=COALESCE(excluded.season_year,media.season_year)",[mediaId,['ANIME','MANGA','MANHWA','MANHUA'].includes(mediaType)?mediaType:'MANGA',record.startYear??record.year??null]);
  await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[mediaId,provider,resolvedProviderId,{source:'manual-review-queue',reviewId,rawProviderId:providerId}]);
  await h.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,lower(regexp_replace($2,'[^[:alnum:]]+',' ','g')),NULL,'official','canonical',$3,1,$4) ON CONFLICT DO NOTHING",[mediaId,canonicalTitle,provider,{source:'manual-review-queue',reviewId,providerId:resolvedProviderId}]);
  await h.query("INSERT INTO media_metadata(media_id,provider,external_id,source_url,status,resolved_at,updated_at) VALUES($1,$2,$3,$4,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider=excluded.provider,external_id=excluded.external_id,source_url=excluded.source_url,status='ACTIVE',resolved_at=now(),updated_at=now()",[mediaId,provider,resolvedProviderId,record.siteUrl??record.url??null]);
  if(record.coverImage??record.image)await h.query(
    "SELECT graphile_worker.add_job('provider-profile-cover',$1,job_key := $2,max_attempts := 8,priority := -90,job_key_mode := 'replace')",
    [{profileId:profile.rows[0].id},`provider-profile-cover:${provider}:${resolvedProviderId}`],
  );
  await h.query("UPDATE favorite_review_candidate SET media_id=$1 WHERE profile_id=$2 AND review_id IN (SELECT pending.id FROM favorite_review source JOIN favorite_review pending ON pending.user_id=source.user_id AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text) WHERE source.id=$3)",[mediaId,profile.rows[0].id,reviewId]);
  await h.query(`WITH affected AS (
      SELECT pending.id FROM favorite_review source JOIN favorite_review pending ON pending.user_id=source.user_id
      AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text)
      WHERE source.id=$1 AND source.user_id=$2 AND pending.status='PENDING' AND (pending.decision IS NULL OR pending.decision->>'kind'='manual-queued')
    ), linked AS (
      UPDATE bookmark_media_link l SET media_id=$3,status='matched',evidence=l.evidence||$4::jsonb
      FROM favorite_review r JOIN affected a ON a.id=r.id WHERE l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id RETURNING r.id
    ) UPDATE favorite_review r SET status='RESOLVED',selected_candidate_id=c.id,
      decision=$5::jsonb,resolved_at=now(),reason=NULL FROM affected a JOIN favorite_review_candidate c ON c.review_id=a.id AND c.profile_id=$6
      WHERE r.id=a.id`,[reviewId,userId,mediaId,JSON.stringify({resolution:'manual-review-queue',provider,providerId:resolvedProviderId}),JSON.stringify({kind:'manual',provider,id:resolvedProviderId,rawId:providerId,profileHash:payloadHash}),profile.rows[0].id]);
}
