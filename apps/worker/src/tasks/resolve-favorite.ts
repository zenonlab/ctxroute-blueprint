import { createHash } from 'node:crypto';
import type { Task } from 'graphile-worker';
import { compactTitleKey, fetchPageMetadata, normalizeTitle, prepareTitleCandidates, sourceIdentityFromUrl, suspiciousPageMetadata, titleCandidateFromBookmark, type PageMetadata } from '@favlib/metadata';
import { circuitAllows, closeCircuit, normalizedError, openCircuit } from '../enrichment-state.js';
import { operationalValue } from '../settings.js';

type Payload={userId:string;mediaId:string;title:string;url:string;pageMetadata?:PageMetadata};
type Helpers=Parameters<Task>[1];
const mediaIdFor=(key:string)=>`source:${createHash('sha256').update(key).digest('hex').slice(0,40)}`;
const similarTitle=(a:string,b:string)=>{const x=normalizeTitle(a),y=normalizeTitle(b);if(x===y||x.includes(y)||y.includes(x))return true;const left=new Set(x.split(' ')),right=new Set(y.split(' '));return [...left].filter(token=>right.has(token)).length/Math.max(left.size,right.size)>=.6};
const task:Task=async(raw,helpers)=>{
  const input=raw as Payload;
  const source=sourceIdentityFromUrl(input.url);
  if(!source){await helpers.query("UPDATE bookmark_media_link SET status='review',evidence=$1 WHERE user_id=$2 AND media_id=$3",[{reason:'URL_IDENTITY_UNRESOLVED',url:input.url},input.userId,input.mediaId]);await helpers.query("INSERT INTO metadata_attempt(user_id,media_id,input_url,provider,status,error) VALUES($1,$2,$3,'source','IGNORED','URL_IDENTITY_UNRESOLVED')",[input.userId,input.mediaId,input.url]);return}
  let page=input.pageMetadata;
  if(page&&suspiciousPageMetadata(page))page=undefined;
  if(!page){const domain=new URL(input.url).hostname.toLowerCase();if(await circuitAllows(helpers,domain))try{page=await fetchPageMetadata(input.url);await closeCircuit(helpers,domain)}catch(error){const code=normalizedError(error);await openCircuit(helpers,domain,code,300,86400);await helpers.query("INSERT INTO metadata_attempt(user_id,media_id,input_url,provider,status,error,next_retry_at) VALUES($1,$2,$3,'source-page','FAILED',$4,now()+interval '5 minutes')",[input.userId,input.mediaId,input.url,code])}}
  const mediaId=mediaIdFor(source.key);
  const pageTitle=page?.title&&titleCandidateFromBookmark(page.title);
  const preparation=prepareTitleCandidates({bookmarkTitle:input.title,url:input.url,source});
  const personal=preparation.personal;
  const opaqueSource=/^(?:manga\s+)?[a-z]{1,3}\d{4,}$/i.test(source.title);
  const punctuationTitle = preparation.personal && compactTitleKey(preparation.personal) === compactTitleKey(source.title) ? preparation.personal : undefined;
  const canonicalTitle=(opaqueSource ? pageTitle||punctuationTitle||personal : punctuationTitle||source.title)||source.title;
  await helpers.query("INSERT INTO media(id,type,season_year,format) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET type=excluded.type,season_year=COALESCE(excluded.season_year,media.season_year),format=COALESCE(excluded.format,media.format),updated_at=now()",[mediaId,source.type,page?.year??null,page?.format??null]);
  await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','official','source-url',.98,$4) ON CONFLICT DO NOTHING",[mediaId,canonicalTitle,normalizeTitle(canonicalTitle),{sourceUrl:source.canonicalUrl,originalTitle:preparation.original,cleanedTitle:preparation.personal,urlSlug:source.slug,releaseSuffix:source.releaseSuffix,evidence:source.evidence,transformations:preparation.transformations,opaqueSource:opaqueSource?source.title:undefined}]);
  for(const sourceAlias of new Set([source.title, preparation.personal].filter((value): value is string => Boolean(value && normalizeTitle(value)!==normalizeTitle(canonicalTitle)))))
    await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','alias','source-url',.9,$4) ON CONFLICT DO NOTHING",[mediaId,sourceAlias,normalizeTitle(sourceAlias),{sourceUrl:source.canonicalUrl,role:'url-or-cleaned-title-alias',urlSlug:source.slug}]);
  if(pageTitle&&similarTitle(pageTitle,canonicalTitle)&&normalizeTitle(pageTitle)!==normalizeTitle(canonicalTitle))await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'source','alias','source-page',.85,$4) ON CONFLICT DO NOTHING",[mediaId,pageTitle,normalizeTitle(pageTitle),{sourceUrl:page?.canonicalUrl}]);
  if(input.title.trim())await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[mediaId,input.title,normalizeTitle(input.title),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:true}]);
  // Keep the raw bookmark as an alias, but append the cleaned matching title
  // so the existing newest-personal display policy resolves Re:Monster rather
  // than the noisy browser label.
  if(preparation.personal)await helpers.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'personal','favorite','PERSONAL_ONLY',$4,1,$5) ON CONFLICT DO NOTHING",[mediaId,preparation.personal,normalizeTitle(preparation.personal),`chrome-bookmark:${input.userId}`,{userId:input.userId,official:false,original:false,role:'cleaned-personal-title',urlSlug:source.slug}]);
  await helpers.query("UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=$2 WHERE user_id=$3 AND media_id=$4",[mediaId,{source:'source-url',canonicalUrl:source.canonicalUrl},input.userId,input.mediaId]);
  if(pageTitle&&page&&similarTitle(pageTitle,source.title))await helpers.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence) VALUES($1,'title',$2,'source-page',$3,.85) ON CONFLICT DO NOTHING",[mediaId,JSON.stringify(pageTitle),page.canonicalUrl]);
  if(page?.image)await helpers.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence) VALUES($1,'sourceImageHint',$2,'source-page',$3,.2) ON CONFLICT DO NOTHING",[mediaId,JSON.stringify(page.image),page.canonicalUrl]);
  await helpers.query("INSERT INTO media_metadata(media_id,provider,source_url,status,updated_at) VALUES($1,'source-page',$2,'FALLBACK',now()) ON CONFLICT(media_id) DO NOTHING",[mediaId,page?.canonicalUrl??source.canonicalUrl]);
  const fp=createHash('sha256').update(`${mediaId}:${normalizeTitle(canonicalTitle)}:${source.type}`).digest('hex');
  const task=source.type==='ANIME'?'anilist-enrichment':['MANGA','MANHWA','MANHUA'].includes(source.type)?'mangaupdates-enrichment':null;
  if(task){
    // A synchronization is also a repair pass: reopen incomplete enrichment.
    await helpers.query("UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND purpose='metadata' AND provider=$2 AND status<>'SUCCESS' AND NOT EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=$1 AND mm.status='ACTIVE')",[mediaId,source.type==='ANIME'?'anilist':'mangaupdates']);
    await helpers.query("UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND purpose='cover' AND status<>'SUCCESS' AND NOT EXISTS(SELECT 1 FROM media_cover c WHERE c.media_id=$1 AND c.status='ACTIVE')",[mediaId]);
    await helpers.query("SELECT graphile_worker.add_job($1,$2,max_attempts := 1)",[task,JSON.stringify({mediaId})]);
  const cover=await helpers.query("SELECT 1 FROM media_cover WHERE media_id=$1 AND status='ACTIVE' LIMIT 1",[mediaId]);
  if(!cover.rows[0])await helpers.query("SELECT graphile_worker.add_job($1,$2,max_attempts := 1)",[source.type==='ANIME'?'anilist-enrichment':'mangaupdates-enrichment',JSON.stringify({mediaId,cover:true})]);
  }
};
export default task;
