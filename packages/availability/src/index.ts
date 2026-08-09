export type ReleaseSequence={kind:'integer'|'decimal'|'part'|'special';raw:string;number?:number;part?:string};
export type Release={mediaId:string;seasonKey?:string|null;sequence:ReleaseSequence;variant?:string|null;title?:string;url?:string};
export type Origin=Release&{connector:string;checkedAt:string;status:'AVAILABLE'|'STALE'|'ERROR';language?:string|null;languageDetection?:'url-path'|'manifest'|'document'|'content-language'|'og:locale'|'hreflang'|'statistical'|'undetected'|'ambiguous'};
export type Announcement=Release&{announcedAt:string;status:'SCHEDULED'|'ANNOUNCED'};
export type ResolutionStatus='DOWN'|'RETRYABLE'|'UNRESOLVED_IDENTITY'|'UNRESOLVED_CHAPTER'|'AVAILABLE';
export type Snapshot={fetchedAt:string;status:'VALID'|'QUARANTINED'|'NOT_MODIFIED';resolutionStatus?:ResolutionStatus;origins:Origin[];error?:string};
export function resolutionStatus(input:{accessible:boolean;identityResolved:boolean;chapterResolved:boolean;retryable?:boolean}):ResolutionStatus {
  if (!input.accessible) return input.retryable ? 'RETRYABLE' : 'DOWN';
  if (!input.identityResolved) return 'UNRESOLVED_IDENTITY';
  if (!input.chapterResolved) return 'UNRESOLVED_CHAPTER';
  return 'AVAILABLE';
}
export function releaseKey(release:Release){return [release.mediaId,release.seasonKey??'main',release.sequence.kind,release.sequence.raw,release.variant??'default'].join('|')}
export function snapshotCacheKey(input:{scopeKey:string;connector:string;version:string;target:string;locale?:string;region?:string}){return [input.scopeKey,input.connector,input.version,input.target,input.locale??'',input.region??''].join('|')}
export function retryDelay(status:number,attempt:number){if(status===429||status>=500)return Math.min(6*60*60*1000,Math.max(1000,2**Math.min(attempt,10)*1000));return 0;}
export function cacheState(snapshot:Snapshot|null,now:string,ttlMs:number){if(!snapshot)return 'MISS' as const;if(snapshot.status!=='VALID')return 'STALE' as const;return Date.parse(now)-Date.parse(snapshot.fetchedAt)<=ttlMs?'FRESH' as const:'EXPIRED' as const;}
export function diffSnapshots(previous:Snapshot|null,current:Snapshot){if(current.status!=='VALID')return {newReleases:[] as Origin[],preserved:previous?.origins??[],state:'STALE' as const};const old=new Set((previous?.origins??[]).map(releaseKey));return {newReleases:current.origins.filter(origin=>origin.status==='AVAILABLE'&&!old.has(releaseKey(origin))),preserved:current.origins,state:'VALID' as const};}
export function announcementState(announcement:Announcement):Announcement{return {...announcement,status:announcement.status==='SCHEDULED'?'SCHEDULED':'ANNOUNCED'};}
export function mergeOrigins(origins:Origin[]){const map=new Map<string,Origin[]>();for(const origin of origins){const key=releaseKey(origin);map.set(key,[...(map.get(key)??[]),origin]);}return [...map.entries()].map(([key,items])=>({key,origins:items.sort((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))}));}
export function fanOut(release:Origin,users:{userId:string;mediaId:string;muted?:boolean}[]){return users.filter(user=>user.mediaId===release.mediaId&&!user.muted).map(user=>({userId:user.userId,releaseKey:releaseKey(release),dedupeKey:`${user.userId}:${releaseKey(release)}`}));}
export function chooseOrigin(origins:Origin[],preferredConnector?:string){const compatible=origins.filter(origin=>origin.status==='AVAILABLE');return compatible.find(origin=>origin.connector===preferredConnector)??compatible[0]??null;}
export function availabilityState(announcement:Announcement,origins:Origin[]){if(announcement.status==='SCHEDULED')return 'SCHEDULED' as const;if(chooseOrigin(origins))return 'AVAILABLE' as const;return 'ANNOUNCED' as const;}
