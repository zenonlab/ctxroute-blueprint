import { createHash } from 'node:crypto';
import { OPERATIONAL_DEFAULTS } from '@favlib/config';
import { withProviderRequest } from '@favlib/database/provider-queue';
import { fetchAniList, fetchMangaUpdatesSeries } from '@favlib/metadata';

type Payload={reviewId:string;userId:string;provider:'anilist'|'mangaupdates';providerId:string};
type Helpers={query:(sql:string,values?:unknown[])=>Promise<{rowCount?:number|null;rows:any[]}>};

export default async function manualReviewProvider(payload:unknown,h:Helpers){
  const {reviewId,userId,provider,providerId}=payload as Payload;
  const owned=await h.query("SELECT 1 FROM favorite_review WHERE id=$1 AND user_id=$2 AND provider=$3 AND status='PENDING'",[reviewId,userId,provider]);
  if(!owned.rowCount)return;
  const record:any=await withProviderRequest<any>(h,{provider,kind:'manual-review',priority:100,scopeKey:`${reviewId}:${providerId}`,spacingMs:provider==='anilist'?2100:350},()=>provider==='anilist'?fetchAniList(Number(providerId),{timeoutMs:OPERATIONAL_DEFAULTS['timeouts.providerMs'],cache:false}):fetchMangaUpdatesSeries(providerId,{timeoutMs:OPERATIONAL_DEFAULTS['timeouts.providerMs']}));
  const stillOwned=await h.query("SELECT 1 FROM favorite_review WHERE id=$1 AND user_id=$2 AND provider=$3 AND status='PENDING'",[reviewId,userId,provider]);
  if(!stillOwned.rowCount)return;
  const canonicalTitle=provider==='anilist'?(record.title?.userPreferred??record.title?.romaji??record.title?.english??record.title?.native??`AniList ${providerId}`):(record.title??record.titles?.[0]??`MangaUpdates ${providerId}`);
  const associatedTitles=provider==='anilist'?[record.title?.romaji,record.title?.english,record.title?.native,...(record.synonyms??[])].filter(Boolean):[...(record.titles??[]),...(record.associated??[])].filter(Boolean);
  const rawPayload=JSON.stringify(record),payloadHash=createHash('sha256').update(rawPayload).digest('hex');
  const profile=await h.query(`INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb)
    ON CONFLICT(provider,provider_id,payload_hash) DO UPDATE SET last_seen_at=now() RETURNING id`,[provider,providerId,payloadHash,canonicalTitle,[...new Set(associatedTitles)],record.type??(provider==='anilist'?'ANIME':'MANGA'),record.startYear??record.year??null,JSON.stringify(record.startDate??null),record.status??'UNKNOWN',JSON.stringify(record.authors??[]),record.categories??[],record.genres??[],record.coverImage??record.image??null,record.siteUrl??record.url??null,rawPayload]);
  await h.query(`WITH candidate AS (
      INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id,hit_title)
      SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM favorite_review WHERE id=$1 AND user_id=$5 AND status='PENDING')
      ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id,hit_title=excluded.hit_title RETURNING profile_id
    ) INSERT INTO review_cluster_candidate(cluster_id,profile_id)
      SELECT r.cluster_id,c.profile_id FROM favorite_review r CROSS JOIN candidate c WHERE r.id=$1 AND r.cluster_id IS NOT NULL
      ON CONFLICT DO NOTHING`,[reviewId,profile.rows[0].id,providerId,canonicalTitle,userId]);
  await h.query(`INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id)
    SELECT pending.id,$2,$3 FROM favorite_review source JOIN favorite_review pending ON pending.cluster_id=source.cluster_id
    WHERE source.id=$1 AND pending.status='PENDING'
    ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id`,[reviewId,profile.rows[0].id,providerId]);
}
