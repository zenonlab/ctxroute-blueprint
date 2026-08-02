import { createHash, randomBytes } from 'node:crypto';

export const MEDIA_URL = /(?:manga|manhwa|manhua|anime|episode|chapter|volume|watch|read|scan)/i;
export const MAX_BATCH_ITEMS = 250;
export const STORAGE_BUDGET_BYTES = 4.5 * 1024 * 1024;

export type BookmarkInput = { id:string; parentId?:string; title:string; url?:string; dateAdded?:number; dateGroupModified?:number };
export type MediaBookmark = { id:string; parentId:string|null; title:string; url:string; dateAdded:number|null; dateGroupModified:number|null; fingerprint:string; event:'created'|'changed'|'moved'|'removed' };

export function installationId(bytes: Uint8Array = randomBytes(16)) { return `inst_${base64Url(bytes)}`; }
export function pairingCode(bytes: Uint8Array = randomBytes(5)) { const n = Number((BigInt(`0x${Buffer.from(bytes).toString('hex')}`) % 100000000n).toString()); return n.toString().padStart(8,'0'); }
export function hashPairingCode(code:string, salt:string) { return createHash('sha256').update(`${salt}:${code}`).digest('hex'); }
export function fingerprintBookmark(bookmark: Pick<BookmarkInput,'url'|'title'>) { return createHash('sha256').update(`${canonicalUrl(bookmark.url ?? '')}\n${bookmark.title.trim()}`).digest('hex'); }
export function canonicalUrl(value:string) { try { const u=new URL(value); u.hash=''; u.hostname=u.hostname.toLowerCase(); return u.toString(); } catch { return value.trim(); } }
export function isMediaBookmark(bookmark:BookmarkInput) { return Boolean(bookmark.url && /^https?:$/i.test(new URL(bookmark.url).protocol) && (MEDIA_URL.test(bookmark.url) || MEDIA_URL.test(bookmark.title))); }
export function toMediaBookmark(bookmark:BookmarkInput, event:MediaBookmark['event']='created'):MediaBookmark|null { if (!isMediaBookmark(bookmark)) return null; return {id:bookmark.id,parentId:bookmark.parentId??null,title:bookmark.title.trim(),url:canonicalUrl(bookmark.url!),dateAdded:bookmark.dateAdded??null,dateGroupModified:bookmark.dateGroupModified??null,fingerprint:fingerprintBookmark(bookmark),event}; }
export function chunk<T>(items:T[], size=MAX_BATCH_ITEMS) { const result:T[][]=[]; for(let i=0;i<items.length;i+=size) result.push(items.slice(i,i+size)); return result; }
export function base64Url(bytes:Uint8Array) { return Buffer.from(bytes).toString('base64url'); }
export function byteSize(value:unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
