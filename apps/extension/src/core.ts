export const PROTOCOL=1, MAX_BATCH=250, STORAGE_BUDGET=4.5*1024*1024;
export type Bookmark={id:string,parentId:string|null,title:string,url:string,dateAdded:number|null,dateGroupModified:number|null,fingerprint:string};
export type Event={id:string,type:'created'|'changed'|'moved'|'removed',bookmark:Bookmark,createdAt:number,attempts:number};
export type Pairing={challengeId:string,code:string,expiresAt:string,status:'pending'|'activated'|'expired'|'consumed'|'revoked'|'error',error?:string};
export type ApprovedSite={id:string,domain:string,source:'bookmark'|'manual',approvedAt:number,permissionGranted:boolean};
export type LinkCheck={url:string,status:'accessible'|'needs_review'|'offline'|'unknown',checkedAt:number|null,error?:string,failures:number};
export type BookmarkUpdate={id:string,oldUrl:string,oldTitle:string,newUrl:string,newTitle:string,createdAt:number,undoneAt?:number,requiresConfirmation?:boolean};
export type Inventory={totalWeb:number,likelyMedia:number,ambiguous:number,digest:string|null,updatedAt:number|null};
export type ServerReceipt={inventoryTotal:number,recognizedCount:number,reviewCount:number,excludedCount:number,inventoryDigest:string,serverSyncedAt:number|null,attemptedAt:number,verifiedAt:number|null};
export type ProposalResult={id:string,result:'APPLIED'|'CANCELLED'|'STALE'|'FAILED',code?:string};
export type SyncStatus='unpaired'|'pending'|'verified'|'diverged'|'offline'|'revoked'|'protocol'|'quota'|'error';
export type DebugReport={at:number;collection:{total:number;recognized:number;review:number;excluded:number;unresolved:number};unresolvedItems:UnresolvedDebugItem[];resolution:unknown[];covers:unknown[]};
export type UnresolvedDebugItem={bookmarkId:string;title:string|null;url:string|null;mediaId?:string|null;status:string;reason?:string|null;candidates?:unknown};
export type ReimportState={status:'idle'|'running'|'completed'|'failed';processed:number;total:number;startedAt?:number;finishedAt?:number;error?:string};
export type State={version:6,progressCatchupPending:boolean,installationId:string,deviceToken?:string,pairing?:Pairing,queue:Event[],cursor:string|null,lastSyncAt:number|null,sites:ApprovedSite[],checks:LinkCheck[],autoUpdateFavorites:boolean,observeNavigation:boolean,syncMinutes:number,availableVersion:string|null,accountRole?:'admin'|'member',reimport?:ReimportState,updates:BookmarkUpdate[],pendingProposalResults:ProposalResult[],knownBookmarks:Bookmark[],inventory:Inventory,serverReceipt?:ServerReceipt,syncStatus:SyncStatus,debugReport?:DebugReport,diagnostic?:{status:'ok'|'offline'|'quota'|'revoked'|'protocol'|'error',lastError?:string}};
const media=/(manga|manhwa|manhua|anime|episode|chapter|volume|watch|read|scan)/i;
export function canonicalUrl(value:string){try{const u=new URL(value);u.hash='';u.hostname=u.hostname.toLowerCase();return u.toString()}catch{return value.trim()}}
export function isMedia(title:string,url?:string){if(!url)return false;try{if(!/^https?:$/i.test(new URL(url).protocol))return false;return media.test(title)||media.test(url)}catch{return false}}
export function hostnameFor(value:string){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'')}catch{return null}}
export function isApprovedDomain(domain:string){return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain.trim().toLowerCase().replace(/^www\./,''))}
export function domainMatches(hostname:string,domain:string){const h=hostnameFor(`https://${hostname}`);const d=domain.toLowerCase().replace(/^www\./,'');return Boolean(h&&isApprovedDomain(d)&&(h===d||h.endsWith(`.${d}`)))}
export async function sha256(value:string){const data=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function fingerprint(b:Pick<Bookmark,'title'|'url'>){return sha256(`${canonicalUrl(b.url)}\n${b.title.trim()}`)}
// The server computes the same digest from PostgreSQL rows. Use code-point
// ordering, never localeCompare: database collations may order bookmark IDs
// differently from the browser locale while the inventory count still matches.
export async function inventoryDigest(bookmarks:Pick<Bookmark,'id'|'fingerprint'>[]){return sha256([...bookmarks].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(bookmark=>`${bookmark.id}\0${bookmark.fingerprint}\n`).join(''))}
export function id(){return crypto.randomUUID()}
export function code(){const bytes=new Uint8Array(4);crypto.getRandomValues(bytes);return (new DataView(bytes.buffer).getUint32(0)%100000000).toString().padStart(8,'0')}
export function chunks<T>(items:T[],size=MAX_BATCH){const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));return result}
export function bytes(value:unknown){return new TextEncoder().encode(JSON.stringify(value)).byteLength}
export async function webBookmark(node:chrome.bookmarks.BookmarkTreeNode,cached?:Bookmark):Promise<Bookmark|null>{if(!node.url)return null;try{if(!/^https?:$/i.test(new URL(node.url).protocol))return null}catch{return null}const title=node.title.trim(),url=canonicalUrl(node.url),parentId=node.parentId??null;if(cached&&cached.id===node.id&&cached.parentId===parentId&&cached.title===title&&cached.url===url)return cached;return {id:node.id,parentId,title,url,dateAdded:node.dateAdded??null,dateGroupModified:node.dateGroupModified??null,fingerprint:await fingerprint({title,url})}}
export function uniqueById<T extends {id:string}>(items:T[]):T[]{const seen=new Set<string>();return items.filter(item=>{if(seen.has(item.id))return false;seen.add(item.id);return true})}
