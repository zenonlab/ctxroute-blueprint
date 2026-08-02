export const PROTOCOL=1, MAX_BATCH=250, STORAGE_BUDGET=4.5*1024*1024;
export type Bookmark={id:string,parentId:string|null,title:string,url:string,dateAdded:number|null,dateGroupModified:number|null};
export type Event={id:string,type:'created'|'changed'|'moved'|'removed',bookmark:Bookmark,createdAt:number,attempts:number};
export type Pairing={challengeId:string,code:string,expiresAt:string,status?:'pending'|'activated'|'expired'|'consumed',error?:string};
export type ApprovedSite={id:string,domain:string,source:'bookmark'|'manual',approvedAt:number,permissionGranted:boolean};
export type LinkCheck={url:string,status:'accessible'|'needs_review'|'offline'|'unknown',checkedAt:number|null,error?:string,failures:number};
export type BookmarkUpdate={id:string,oldUrl:string,oldTitle:string,newUrl:string,newTitle:string,createdAt:number,undoneAt?:number,requiresConfirmation?:boolean};
export type State={version:2,installationId:string,deviceToken?:string,pairing?:Pairing,queue:Event[],cursor:string|null,lastSyncAt:number|null,sites:ApprovedSite[],checks:LinkCheck[],autoUpdateFavorites:boolean,updates:BookmarkUpdate[],diagnostic?:{status:'ok'|'offline'|'quota'|'revoked'|'protocol'|'error',lastError?:string}};
const media=/(manga|manhwa|manhua|anime|episode|chapter|volume|watch|read|scan)/i;
export function canonicalUrl(value:string){try{const u=new URL(value);u.hash='';u.hostname=u.hostname.toLowerCase();return u.toString()}catch{return value.trim()}}
export function isMedia(title:string,url?:string){if(!url)return false;try{if(!/^https?:$/i.test(new URL(url).protocol))return false;return media.test(title)||media.test(url)}catch{return false}}
export function hostnameFor(value:string){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'')}catch{return null}}
export function isApprovedDomain(domain:string){return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)}
export function domainMatches(hostname:string,domain:string){const h=hostnameFor(`https://${hostname}`);const d=domain.toLowerCase().replace(/^www\./,'');return Boolean(h&&isApprovedDomain(d)&&(h===d||h.endsWith(`.${d}`)))}
export async function sha256(value:string){const data=new TextEncoder().encode(value),digest=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function fingerprint(b:Pick<Bookmark,'title'|'url'>){return sha256(`${canonicalUrl(b.url)}\n${b.title.trim()}`)}
export function id(){return crypto.randomUUID()}
export function code(){const bytes=new Uint8Array(4);crypto.getRandomValues(bytes);return (new DataView(bytes.buffer).getUint32(0)%100000000).toString().padStart(8,'0')}
export function chunks<T>(items:T[],size=MAX_BATCH){const result:T[][]=[];for(let i=0;i<items.length;i+=size)result.push(items.slice(i,i+size));return result}
export function bytes(value:unknown){return new TextEncoder().encode(JSON.stringify(value)).byteLength}
export async function mediaBookmark(node:chrome.bookmarks.BookmarkTreeNode,type:Event['type']='created'):Promise<Bookmark&{fingerprint:string}|null>{if(!node.url||!isMedia(node.title,node.url))return null;return {id:node.id,parentId:node.parentId??null,title:node.title.trim(),url:canonicalUrl(node.url),dateAdded:node.dateAdded??null,dateGroupModified:node.dateGroupModified??null,fingerprint:await fingerprint({title:node.title,url:node.url}),event:type} as Bookmark&{fingerprint:string}}
