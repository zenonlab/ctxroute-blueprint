import { createHash } from 'node:crypto';
import type { Task } from 'graphile-worker';
import { compactTitleKey, fetchPageMetadata, normalizeTitle, prepareTitleCandidates, sourceIdentityFromUrl, suspiciousPageMetadata, titleCandidateFromBookmark, type PageMetadata } from '@favlib/metadata';
import { circuitAllows, closeCircuit, normalizedError, openCircuit } from '../enrichment-state.js';
import { operationalValue } from '../settings.js';
import { markFavoriteUnresolved, resolveLocalFavorite } from '../favorite-resolution.js';

type Payload={userId:string;mediaId:string;title:string;url:string;pageMetadata?:PageMetadata};
type Helpers=Parameters<Task>[1];
const mediaIdFor=(key:string)=>`source:${createHash('sha256').update(key).digest('hex').slice(0,40)}`;
const similarTitle=(a:string,b:string)=>{const x=normalizeTitle(a),y=normalizeTitle(b);if(x===y||x.includes(y)||y.includes(x))return true;const left=new Set(x.split(' ')),right=new Set(y.split(' '));return [...left].filter(token=>right.has(token)).length/Math.max(left.size,right.size)>=.6};
export function inferFavoriteMediaType(sourceType: string, _bookmarkTitle: string) {
  // The URL parser is the identity authority. A release marker in a Chrome
  // label must never override an explicit /manga, /manhwa or /manhua path.
  return sourceType;
}
const task:Task=async(raw,helpers)=>{
  const input=raw as Payload;
  const source=sourceIdentityFromUrl(input.url);
  if(!source){await markFavoriteUnresolved(helpers.query,input.mediaId,'URL_IDENTITY_UNRESOLVED');await helpers.query("INSERT INTO metadata_attempt(user_id,media_id,input_url,provider,status,error) VALUES($1,$2,$3,'source','IGNORED','URL_IDENTITY_UNRESOLVED')",[input.userId,input.mediaId,input.url]);return}
  const mediaType=inferFavoriteMediaType(source.type,input.title);
  const preparation=prepareTitleCandidates({bookmarkTitle:input.title,url:input.url,source});
  const sourceTitle=preparation.sourceTitle??source.title;
  const sourceSlug=preparation.stableSlug??source.slug;
  const local=await resolveLocalFavorite(helpers.query,{mediaId:input.mediaId,userId:input.userId,type:mediaType,aliases:preparation.sourceAliases.map(normalizeTitle).filter(Boolean)});
  if(local?.resolved){
    // Preserve the raw bookmark and its cleaned provenance on the shared work,
    // then converge this user's link without touching a provider.
    if(local.mediaId!==input.mediaId) await helpers.query("UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb WHERE user_id=$3 AND media_id=$4",[local.mediaId,JSON.stringify({resolution:'local-exact',sourceUrl:source.canonicalUrl}),input.userId,input.mediaId]);
    await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[local.mediaId,input.title,normalizeTitle(input.title),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:true,sourceUrl:source.canonicalUrl}]);
    if(preparation.personal) await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[local.mediaId,preparation.personal,normalizeTitle(preparation.personal),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:false,role:'cleaned-personal-title'}]);
    if(preparation.year) await helpers.query("UPDATE media SET season_year=COALESCE(season_year,$2),updated_at=now() WHERE id=$1",[local.mediaId,preparation.year]);
    return;
  }
  let page=input.pageMetadata;
  if(page&&suspiciousPageMetadata(page))page=undefined;
  if(!page){const domain=new URL(input.url).hostname.toLowerCase();if(await circuitAllows(helpers,domain))try{page=await fetchPageMetadata(input.url);await closeCircuit(helpers,domain)}catch(error){const code=normalizedError(error);await openCircuit(helpers,domain,code,300,86400);await helpers.query("INSERT INTO metadata_attempt(user_id,media_id,input_url,provider,status,error,next_retry_at) VALUES($1,$2,$3,'source-page','FAILED',$4,now()+interval '5 minutes')",[input.userId,input.mediaId,input.url,code])}}
  const mediaId=mediaIdFor(source.key);
  const pageTitle=page?.title&&titleCandidateFromBookmark(page.title);
  const personal=preparation.personal;
  const opaqueSource=/^(?:manga\s+)?[a-z]{1,3}\d{4,}$/i.test(sourceTitle);
  const punctuationTitle = preparation.alignedSourceTitle ?? (preparation.personal && compactTitleKey(preparation.personal) === compactTitleKey(sourceTitle) ? preparation.personal : undefined);
  const canonicalTitle=(opaqueSource ? pageTitle||punctuationTitle||personal : punctuationTitle||sourceTitle)||sourceTitle;
  await helpers.query("INSERT INTO media(id,type,season_year,format) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET type=excluded.type,season_year=COALESCE(excluded.season_year,media.season_year),format=COALESCE(excluded.format,media.format),updated_at=now()",[mediaId,mediaType,page?.year??preparation.year??null,page?.format??null]);
  await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','official','source-url',.98,$4) ON CONFLICT DO NOTHING",[mediaId,canonicalTitle,normalizeTitle(canonicalTitle),{sourceUrl:source.canonicalUrl,originalTitle:preparation.original,cleanedTitle:preparation.personal,rawUrlSlug:preparation.rawSlug,stableUrlSlug:sourceSlug,release:source.release,releaseSuffix:source.releaseSuffix,selectedSegment:preparation.selectedSegment,sourceMatchMethod:preparation.sourceMatchMethod,evidence:source.evidence,transformations:preparation.transformations,opaqueSource:opaqueSource?sourceTitle:undefined}]);
  for(const sourceAlias of new Set(preparation.sourceAliases.filter(value=>normalizeTitle(value)!==normalizeTitle(canonicalTitle))))
    await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','alias','source-url',.9,$4) ON CONFLICT DO NOTHING",[mediaId,sourceAlias,normalizeTitle(sourceAlias),{sourceUrl:source.canonicalUrl,role:'parsed-source-alias',rawUrlSlug:preparation.rawSlug,stableUrlSlug:sourceSlug,selectedSegment:preparation.selectedSegment,sourceMatchMethod:preparation.sourceMatchMethod}]);
  if(pageTitle&&similarTitle(pageTitle,canonicalTitle)&&normalizeTitle(pageTitle)!==normalizeTitle(canonicalTitle))await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','alias','source-page',.85,$4) ON CONFLICT DO NOTHING",[mediaId,pageTitle,normalizeTitle(pageTitle),{sourceUrl:page?.canonicalUrl}]);
  if(input.title.trim())await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[mediaId,input.title,normalizeTitle(input.title),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:true}]);
  // Keep the raw bookmark as an alias, but append the cleaned matching title
  // so the existing newest-personal display policy resolves Re:Monster rather
  // than the noisy browser label.
  if(preparation.personal)await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[mediaId,preparation.personal,normalizeTitle(preparation.personal),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:false,role:'cleaned-personal-title',urlSlug:source.slug}]);
  await helpers.query("UPDATE bookmark_media_link SET media_id=$1,status='review',evidence=$2 WHERE user_id=$3 AND media_id=$4",[mediaId,{source:'source-url',canonicalUrl:source.canonicalUrl},input.userId,input.mediaId]);
  if(pageTitle&&page&&similarTitle(pageTitle,sourceTitle))await helpers.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence) VALUES($1,'title',$2,'source-page',$3,.85) ON CONFLICT DO NOTHING",[mediaId,JSON.stringify(pageTitle),page.canonicalUrl]);
  if(page?.image)await helpers.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence) VALUES($1,'sourceImageHint',$2,'source-page',$3,.2) ON CONFLICT DO NOTHING",[mediaId,JSON.stringify(page.image),page.canonicalUrl]);
  await helpers.query("INSERT INTO media_metadata(media_id,provider,source_url,status,updated_at) VALUES($1,'source-page',$2,'FALLBACK',now()) ON CONFLICT(media_id) DO NOTHING",[mediaId,page?.canonicalUrl??source.canonicalUrl]);
  const fp=createHash('sha256').update(`${mediaId}:${normalizeTitle(canonicalTitle)}:${mediaType}`).digest('hex');
  const task=mediaType==='ANIME'?'anilist-enrichment':['MANGA','MANHWA','MANHUA'].includes(mediaType)?'mangaupdates-enrichment':null;
  if(task){
    // A synchronization is also a repair pass: reopen incomplete enrichment.
    await helpers.query("UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND purpose='metadata' AND provider=$2 AND status<>'SUCCESS' AND NOT EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=$1 AND mm.status='ACTIVE')",[mediaId,mediaType==='ANIME'?'anilist':'mangaupdates']);
    await helpers.query("UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND purpose='cover' AND status<>'SUCCESS' AND NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=$1 AND c.status='ACTIVE')",[mediaId]);
    await helpers.query("SELECT graphile_worker.add_job($1,$2,max_attempts := 3,priority := $3)",[task,JSON.stringify({mediaId}),task==='anilist-enrichment'?-10:0]);
  const cover=await helpers.query("SELECT 1 FROM media_cover WHERE media_id=$1 AND status='ACTIVE' LIMIT 1",[mediaId]);
  if(!cover.rows[0]){const task=mediaType==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment';await helpers.query("SELECT graphile_worker.add_job($1,$2,max_attempts := 3,priority := $3)",[task,JSON.stringify({mediaId,cover:true}),task==='anilist-enrichment'?-10:0]);}
  }
};
export default task;
