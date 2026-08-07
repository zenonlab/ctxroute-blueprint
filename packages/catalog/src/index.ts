import { createHash, createHmac } from 'node:crypto';

export type MediaType='ANIME'|'MANGA'|'MANHWA'|'MANHUA'|'UNKNOWN';
export type TitleKind='official'|'native'|'romaji'|'synonym';
export type CatalogTitle={text:string;language?:string;kind?:TitleKind;connector?:string};
export type DisplayTitleAlias=CatalogTitle&{id?:string;script?:string;titleType?:string;confidence?:number|null};
export type DisplayTitleSelection={title:string|null;referenceTitle:string|null;score:number;alias:DisplayTitleAlias|null;reason:'BEST_MATCH'|'ROMAJI_FALLBACK'|'PROVIDER_STABLE_FALLBACK'|'NO_TITLE'};
export type CatalogMedia={id:string;type:MediaType;seasonYear?:number;countryOfOrigin?:string;format?:string;titles:CatalogTitle[];externalIds?:{provider:string;id:string}[];relations?:{target:string;kind:string}[]};
export type BookmarkCandidate={title:string;url:string;year?:number;type?:MediaType};
export type MatchReason={code:string;weight:number;detail:string};
export type Match={mediaId:string;score:number;reasons:MatchReason[]};
export type Classification={status:'matched'|'review'|'ignored';classifierVersion:string;matches:Match[];fingerprint:string};

export function normalizeText(value:string){return value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[’']/g,'').replace(/[^\p{Letter}\p{Number}]+/gu,' ').trim().replace(/\s+/g,' ')}
export function tokens(value:string){return new Set(normalizeText(value).split(' ').filter(Boolean))}
export function tokenSimilarity(a:string,b:string){const aa=tokens(a),bb=tokens(b);if(!aa.size||!bb.size)return 0;let common=0;for(const token of aa)if(bb.has(token))common++;return (2*common)/(aa.size+bb.size)}
/**
 * Canonical display-title policy. The page-parsed title is evidence, not a
 * preferred alphabet: every alias competes on the same score. Stable
 * fallbacks are used only when matching cannot decide.
 */
export function selectDisplayTitle(aliases:DisplayTitleAlias[],referenceTitle?:string|null):DisplayTitleSelection{
  const stable=aliases.filter(alias=>alias.text.trim()).map((alias,index)=>({alias,index}));
  if(!stable.length)return {title:null,referenceTitle:referenceTitle?.trim()||null,score:0,alias:null,reason:'NO_TITLE'};
  const reference=referenceTitle?.trim()||null;
  const scored=stable.map(item=>({...item,score:reference?tokenSimilarity(item.alias.text,reference):0}));
  const bestScore=Math.max(...scored.map(item=>item.score));
  const best=scored.filter(item=>item.score===bestScore);
  if(bestScore>0&&best.length===1)return {title:best[0].alias.text,referenceTitle:reference,score:bestScore,alias:best[0].alias,reason:'BEST_MATCH'};
  const romaji=(bestScore>0?best:scored).find(item=>item.alias.titleType==='romaji'||item.alias.script==='Latn'&&item.alias.kind==='native');
  if(romaji)return {title:romaji.alias.text,referenceTitle:reference,score:romaji.score,alias:romaji.alias,reason:'ROMAJI_FALLBACK'};
  const chosen=(bestScore>0?best:scored).sort((a,b)=>a.index-b.index||String(a.alias.id??'').localeCompare(String(b.alias.id??'')))[0];
  return {title:chosen.alias.text,referenceTitle:reference,score:chosen.score,alias:chosen.alias,reason:'PROVIDER_STABLE_FALLBACK'};
}
// Episode/season/chapter are format words shared by several providers. They
// must not decide the medium on their own; only an explicit medium marker may.
export function inferType(value:string):MediaType{const text=normalizeText(value);if(/\bmanhwa\b|webtoon/.test(text))return 'MANHWA';if(/\bmanhua\b/.test(text))return 'MANHUA';if(/\banime\b/.test(text))return 'ANIME';if(/\bmanga\b/.test(text))return 'MANGA';return 'UNKNOWN'}
export function candidateText(bookmark:BookmarkCandidate){return normalizeText(bookmark.title.replace(/(?:^|\s)(?:episode|episodes|épisode|épisodes|ep|chapter|chapitre|chap|ch|volume|vol)\s*[\d.\-a-z]+(?=\s|$)/giu,' '))}
export function classifierFingerprint(bookmark:BookmarkCandidate,key:string,version='catalog-v1'){return createHmac('sha256',key).update(`${version}\n${normalizeText(bookmark.title)}\n${bookmark.url}`).digest('hex')}
export function classify(bookmark:BookmarkCandidate,media:CatalogMedia[],key:string,version='catalog-v1'):Classification{
  const query=candidateText(bookmark), inferred=bookmark.type??inferType(`${bookmark.title} ${bookmark.url}`), matches:Match[]=[];
  for(const item of media){let best=0;const reasons:MatchReason[]=[];for(const title of item.titles){const exact=normalizeText(title.text)===query;const similarity=exact?1:tokenSimilarity(title.text,query);if(exact&&best<1){best=1;reasons.push({code:'EXACT_TITLE',weight:1,detail:`titre ${title.language??'inconnu'} exact`});}else if(similarity>best){best=similarity;reasons.splice(0,reasons.length,{code:'TOKEN_SIMILARITY',weight:similarity,detail:`alias ${title.language??'inconnu'} similaire`});}}
    if(inferred!=='UNKNOWN'&&item.type===inferred){best=Math.min(1,best+0.08);reasons.push({code:'TYPE_MATCH',weight:0.08,detail:`type ${inferred}`});}else if(inferred!=='UNKNOWN'&&item.type!==inferred){best*=0.55;reasons.push({code:'TYPE_CONFLICT',weight:-0.45,detail:`type favori ${inferred}, catalogue ${item.type}`});}
    if(bookmark.year&&item.seasonYear){const delta=Math.abs(bookmark.year-item.seasonYear);if(delta===0){best=Math.min(1,best+0.05);reasons.push({code:'YEAR_MATCH',weight:0.05,detail:'année concordante'});}else if(delta>2){best*=0.7;reasons.push({code:'YEAR_CONFLICT',weight:-0.3,detail:'année éloignée'});}}
    if(best>=0.35)matches.push({mediaId:item.id,score:Number(best.toFixed(4)),reasons});
  }
  matches.sort((a,b)=>b.score-a.score);const top=matches[0], second=matches[1];const status=!top||top.score<0.65?'ignored':second&&top.score-second.score<0.08?'review':top.score>=0.8?'matched':'review';return {status,classifierVersion:version,matches:status==='ignored'?[]:matches.slice(0,5),fingerprint:classifierFingerprint(bookmark,key,version)};
}

export type DatasetManifest={schemaVersion:number;provider:string;release:string;publishedAt:string;policyStatus:string;license:string;synthetic?:boolean;artifacts:{path:string;bytes:number;sha256:string}[]};
export type DatasetRecord={providerRecordId:string;kind:string;titles:CatalogTitle[];year?:number;country?:string;externalIds?:{provider:string;value:string}[]};
export function verifyArtifact(manifest:DatasetManifest,path:string,data:Buffer|string){const artifact=manifest.artifacts.find(item=>item.path===path);if(!artifact)throw new Error('ARTIFACT_NOT_DECLARED');const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);if(buffer.byteLength!==artifact.bytes)throw new Error('ARTIFACT_SIZE_MISMATCH');if(createHash('sha256').update(buffer).digest('hex')!==artifact.sha256)throw new Error('ARTIFACT_CHECKSUM_MISMATCH');return true;}
export function parseNdjson(data:string){const records:DatasetRecord[]=[];for(const [index,line] of data.split(/\r?\n/).entries()){if(!line.trim())continue;let value:unknown;try{value=JSON.parse(line)}catch{throw new Error(`INVALID_NDJSON_LINE_${index+1}`)}const item=value as Partial<DatasetRecord>;if(typeof item.providerRecordId!=='string'||!Array.isArray(item.titles)||!item.titles.length)throw new Error(`INVALID_DATASET_RECORD_${index+1}`);records.push(item as DatasetRecord);}return records;}
export function validateArchiveEntries(entries:{path:string;compressedBytes:number;uncompressedBytes:number}[],maxBytes=100*1024*1024,maxRatio=100){let total=0;for(const entry of entries){if(entry.path.startsWith('/')||entry.path.split('/').includes('..'))throw new Error('ARCHIVE_PATH_TRAVERSAL');if(entry.compressedBytes<0||entry.uncompressedBytes<0||entry.uncompressedBytes>maxBytes)throw new Error('ARCHIVE_ENTRY_TOO_LARGE');total+=entry.uncompressedBytes;if(total>maxBytes)throw new Error('ARCHIVE_TOO_LARGE');if(entry.compressedBytes===0&&entry.uncompressedBytes>0||entry.compressedBytes>0&&entry.uncompressedBytes/entry.compressedBytes>maxRatio)throw new Error('ARCHIVE_RATIO_EXCEEDED');}return true;}
export type ImportStatus='STAGED'|'ACTIVE'|'ROLLED_BACK'|'REJECTED';
export class CatalogStore {private active=new Map<string,CatalogMedia>();private batches=new Map<string,{previous:CatalogMedia[];status:ImportStatus;records:CatalogMedia[]}>();
  get media(){return [...this.active.values()]}
  stage(manifest:DatasetManifest,data:string|Buffer){if(manifest.policyStatus!=='AUTHORIZED')throw new Error('PROVIDER_POLICY_NOT_AUTHORIZED');verifyArtifact(manifest,manifest.artifacts[0]?.path??'',data);const records=parseNdjson(Buffer.isBuffer(data)?data.toString('utf8'):data);const mapped=records.map(record=>({id:`${manifest.provider}:${record.providerRecordId}`,type:record.kind.includes('manhwa')?'MANHWA':record.kind.includes('manhua')?'MANHUA':record.kind.includes('anime')?'ANIME':'MANGA',seasonYear:record.year,countryOfOrigin:record.country,titles:record.titles,externalIds:(record.externalIds??[]).map(id=>({provider:id.provider,id:id.value}))} as CatalogMedia));const id=`${manifest.provider}:${manifest.release}`;this.batches.set(id,{previous:this.media,status:'STAGED',records:mapped});return id;}
  activate(batchId:string){const batch=this.batches.get(batchId);if(!batch||batch.status==='ROLLED_BACK')throw new Error('IMPORT_BATCH_NOT_STAGED');for(const item of batch.records)this.active.set(item.id,item);batch.status='ACTIVE';return this.media;}
  rollback(batchId:string){const batch=this.batches.get(batchId);if(!batch)throw new Error('IMPORT_BATCH_NOT_FOUND');this.active=new Map(batch.previous.map(item=>[item.id,item]));batch.status='ROLLED_BACK';return this.media;}
}
