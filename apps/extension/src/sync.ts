import { State, Event, Bookmark, PROTOCOL, chunks, inventoryDigest, isMedia, webBookmark, type DebugReport } from './core.js';
import { mediaSites, mergeSites } from './sites.js';
import { saveState, updateState } from './storage.js';
import { API } from './api.js';
import { apiFetch as fetch } from './api-fetch.js';
import { parseFavorite, progressionFromFavorite } from '@favlib/metadata/bookmark-parser';

export { API } from './api.js';

export function progressionFrom(title: string, url: string) {
  const parsed = progressionFromFavorite({ title, url });
  return parsed ? { position: parsed.raw, kind: parsed.kind } : null;
}

export async function reportBookmarkProgression(state: State, bookmark: Bookmark, event: Event['type']) {
  if (!state.deviceToken || !['created', 'changed'].includes(event)) return;
  const progression = progressionFrom(bookmark.title, bookmark.url);
  if (!progression) return;
  const provenance = progressionFromFavorite({ title: bookmark.title, url: bookmark.url })?.provenance;
  const response = await fetch(`${API}/extension/progression`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.deviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarkId: bookmark.id, url: bookmark.url, title: bookmark.title, ...progression, provenance, confidence: 'high', consented: true })
  });
  if (response.status === 401) throw new Error('DEVICE_REVOKED');
  if (response.status === 426) throw new Error('PROTOCOL_UNSUPPORTED');
  if (!response.ok && ![400, 404, 409].includes(response.status)) throw new Error(`PROGRESSION_${response.status}`);
}

export type UnresolvedFavorite={bookmarkId:string;title:string|null;url:string|null;mediaId?:string|null;status:string;reason?:string|null;candidates?:unknown};
type Diagnostic={protocol:number;minimumProtocol:number;inventoryTotal:number;recognizedCount:number;reviewCount:number;excludedCount:number;inventoryDigest:string;lastSyncAt:string|null;verifiedSyncAt?:string|null;unresolvedItems?:UnresolvedFavorite[];debug?:{resolution:unknown[];covers:unknown[]}};

export async function readDiagnostic(state:State):Promise<Diagnostic>{
  const response=await fetch(`${API}/extension/diagnostic`,{headers:{Authorization:`Bearer ${state.deviceToken}`,'X-FavLib-Protocol':String(PROTOCOL)}});
  if(response.status===401)throw new Error('DEVICE_REVOKED');
  if(response.status===426)throw new Error('PROTOCOL_UNSUPPORTED');
  if(!response.ok)throw new Error(`DIAGNOSTIC_${response.status}`);
  const diagnostic=await response.json() as Diagnostic;
  if(diagnostic.unresolvedItems?.length){
    const payload=diagnostic.unresolvedItems.map(item=>({bookmarkId:item.bookmarkId,title:item.title,url:item.url,mediaId:item.mediaId??null,status:item.status,reason:item.reason??null,candidates:item.candidates??[]}));
    console.log(`[FavLib] ${payload.length} favori(s) non résolu(s). Rapport détaillé :`,JSON.stringify(payload,null,2));
    for(const item of payload)console.log('[FavLib][UNRESOLVED_FAVORITE]',item);
  }
  const recognized=diagnostic.recognizedCount??0,review=diagnostic.reviewCount??0,excluded=diagnostic.excludedCount??0;
  console.groupCollapsed(`[FavLib][DEBUG] inventaire=${diagnostic.inventoryTotal} reconnu=${recognized} review=${review} exclu=${excluded}`);
  console.info('Collection', {total:diagnostic.inventoryTotal, recognized, review, excluded, unresolved:diagnostic.unresolvedItems?.length??0});
  console.table(diagnostic.debug?.resolution??[]);
  console.table(diagnostic.debug?.covers??[]);
  console.groupEnd();
  return diagnostic;
}

export async function verifyInventory(state:State):Promise<State>{
  if(!state.deviceToken)return {...state,syncStatus:'unpaired'};
  const attemptedAt=Date.now();
  const diagnostic=await readDiagnostic(state);
  let equal=state.queue.length===0&&diagnostic.inventoryTotal===state.inventory.totalWeb&&diagnostic.inventoryDigest===state.inventory.digest;
  let verifiedAt:number|null=null;
  if(equal){const response=await fetch(`${API}/extension/reconcile`,{method:'POST',headers:{Authorization:`Bearer ${state.deviceToken}`,'Content-Type':'application/json','X-FavLib-Protocol':String(PROTOCOL)},body:JSON.stringify({inventoryTotal:state.inventory.totalWeb,inventoryDigest:state.inventory.digest})});if(response.status===401)throw new Error('DEVICE_REVOKED');if(response.status===426)throw new Error('PROTOCOL_UNSUPPORTED');if(response.status===409)equal=false;else if(!response.ok)throw new Error(`RECONCILE_${response.status}`);else{const body=await response.json() as {verifiedSyncAt:string};verifiedAt=Date.parse(body.verifiedSyncAt)}}
  const debugReport:DebugReport={at:attemptedAt,collection:{total:diagnostic.inventoryTotal,recognized:diagnostic.recognizedCount??0,review:diagnostic.reviewCount??0,excluded:diagnostic.excludedCount??0,unresolved:diagnostic.unresolvedItems?.length??0},unresolvedItems:diagnostic.unresolvedItems??[],resolution:diagnostic.debug?.resolution??[],covers:diagnostic.debug?.covers??[]};
  return {...state,progressCatchupPending:equal?false:state.progressCatchupPending,lastSyncAt:equal?attemptedAt:state.lastSyncAt,syncStatus:equal?'verified':'diverged',debugReport,serverReceipt:{inventoryTotal:diagnostic.inventoryTotal,recognizedCount:diagnostic.recognizedCount,reviewCount:diagnostic.reviewCount,excludedCount:diagnostic.excludedCount,inventoryDigest:diagnostic.inventoryDigest,serverSyncedAt:diagnostic.lastSyncAt?Date.parse(diagnostic.lastSyncAt):null,attemptedAt,verifiedAt:equal?(verifiedAt||attemptedAt):null}};
}

export function sameQueuedEvent(left:Event,right:Event){
  return left.id===right.id&&left.type===right.type&&left.bookmark.fingerprint===right.bookmark.fingerprint;
}

export function acknowledgeEvents(state:State,acknowledged:Event[],cursor:string):State{
  return {...state,queue:state.queue.filter(event=>!acknowledged.some(item=>sameQueuedEvent(event,item))),cursor,syncStatus:'pending'};
}

export function mergeReconciledState(current:State,reconciled:State):State{
  const queued=new Map(reconciled.queue.map(event=>[event.bookmark.id,event]));
  for(const event of current.queue)queued.set(event.bookmark.id,event);
  const known=new Map(reconciled.knownBookmarks.map(bookmark=>[bookmark.id,bookmark]));
  for(const event of current.queue){if(event.type==='removed')known.delete(event.bookmark.id);else known.set(event.bookmark.id,event.bookmark)}
  const queue=[...queued.values()];
  return {...current,...reconciled,queue,knownBookmarks:[...known.values()],syncStatus:!current.deviceToken?'unpaired':queue.length?'pending':reconciled.syncStatus};
}

type PersistAcknowledgement=(acknowledged:Event[],cursor:string)=>Promise<State>;

export async function upload(state: State,persistAcknowledgement:PersistAcknowledgement=(acknowledged,cursor)=>updateState(current=>acknowledgeEvents(current,acknowledged,cursor))): Promise<State> {
  if (!state.deviceToken) return {...state,syncStatus:'unpaired'};
  const groups = chunks(state.queue);
  let cursor = state.cursor;
  for (const group of groups) {
    const response = await fetch(`${API}/extension/import-batches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.deviceToken}`, 'Content-Type': 'application/json', 'X-FavLib-Protocol': String(PROTOCOL), 'Idempotency-Key': group[0].id },
      body: JSON.stringify({ batchId: group[0].id, installationId: state.installationId, protocol: PROTOCOL, cursor, items: group.map(event => ({ ...event.bookmark, parsedTitle: parseFavorite({title:event.bookmark.title,url:event.bookmark.url}).displayTitle, event: event.type })) })
    });
    if (response.status === 426) throw new Error('PROTOCOL_UNSUPPORTED');
    if (response.status === 401) throw new Error('DEVICE_REVOKED');
    if (!response.ok) throw new Error(`SYNC_${response.status}`);
    const body = await response.json() as { cursor: string;receipt?:{inventoryTotal:number;recognizedCount:number;reviewCount:number;excludedCount:number;inventoryDigest:string;serverSyncedAt:string} };
    cursor = body.cursor;

    // The import is acknowledged first. Optional progression enrichment must never
    // keep an already accepted batch in the offline queue.
    state = await persistAcknowledgement(group,cursor);
    if(body.receipt)state={...state,lastSyncAt:Date.now(),syncStatus:'verified',serverReceipt:{...body.receipt,serverSyncedAt:Date.parse(body.receipt.serverSyncedAt),attemptedAt:Date.now(),verifiedAt:Date.now()}};
  }
  return state;
}

export function createSyncDrain(run:()=>Promise<void>){
  let active:Promise<void>|null=null;
  let requested=false;
  return ()=>{
    requested=true;
    if(active)return active;
    active=(async()=>{try{do{requested=false;await run()}while(requested)}finally{active=null}})();
    return active;
  };
}

function sameBookmark(left:Bookmark,right:Bookmark){return left.url===right.url&&left.title===right.title&&left.parentId===right.parentId&&left.fingerprint===right.fingerprint}

export function inventorySnapshotChanged(before:State,after:State){
  if(before.queue.length!==after.queue.length||before.knownBookmarks.length!==after.knownBookmarks.length)return true;
  const queued=new Map(before.queue.map(event=>[event.bookmark.id,event]));
  if(after.queue.some(event=>{const previous=queued.get(event.bookmark.id);return !previous||!sameQueuedEvent(previous,event)}))return true;
  const known=new Map(before.knownBookmarks.map(bookmark=>[bookmark.id,bookmark]));
  return after.knownBookmarks.some(bookmark=>{const previous=known.get(bookmark.id);return !previous||!sameBookmark(previous,bookmark)});
}

export function reconcileBookmarks(state:State,current:Bookmark[],now=Date.now()):State {
  const previous=new Map(state.knownBookmarks.map(bookmark=>[bookmark.id,bookmark]));
  const currentById=new Map(current.map(bookmark=>[bookmark.id,bookmark]));
  const generated:Event[]=[];
  for(const bookmark of current){const before=previous.get(bookmark.id);if(!before)generated.push({id:crypto.randomUUID(),type:'created',bookmark,createdAt:now,attempts:0});else if(!sameBookmark(before,bookmark))generated.push({id:crypto.randomUUID(),type:before.parentId!==bookmark.parentId&&before.url===bookmark.url&&before.title===bookmark.title?'moved':'changed',bookmark,createdAt:now,attempts:0})}
  for(const bookmark of state.knownBookmarks){if(!currentById.has(bookmark.id))generated.push({id:crypto.randomUUID(),type:'removed',bookmark,createdAt:now,attempts:0})}

  // One pending current-state event per bookmark is sufficient. Preserve unrelated
  // queued work and replace stale payloads instead of growing the offline queue.
  const affected=new Set(generated.map(event=>event.bookmark.id));
  const queue=state.queue.filter(event=>!affected.has(event.bookmark.id));
  for(const event of generated){const pendingCreated=state.queue.find(item=>item.bookmark.id===event.bookmark.id&&item.type==='created');queue.push(pendingCreated&&event.type!=='removed'?{...pendingCreated,bookmark:event.bookmark}:event)}
  const likelyMedia=current.filter(bookmark=>isMedia(bookmark.title,bookmark.url)).length;
  return {...state,queue,knownBookmarks:current,inventory:{totalWeb:current.length,likelyMedia,ambiguous:current.length-likelyMedia,digest:null,updatedAt:now},syncStatus:!state.deviceToken?'unpaired':queue.length?'pending':state.syncStatus};
}

export function rebuildImportQueue(state:State,now=Date.now()):State {
  const queued=new Set(state.queue.map(event=>event.bookmark.id));
  const events=state.knownBookmarks.filter(bookmark=>!queued.has(bookmark.id)).map(bookmark=>({id:crypto.randomUUID(),type:'created' as const,bookmark,createdAt:now,attempts:0}));
  return {...state,queue:[...state.queue,...events]};
}

export async function recoverServerInventory(state:State):Promise<State>{
  if(!state.deviceToken||state.queue.length)return state;
  const diagnostic=await readDiagnostic(state);
  const exact=diagnostic.inventoryTotal===state.inventory.totalWeb&&diagnostic.inventoryDigest===state.inventory.digest;
  return exact?verifyInventory(state):rebuildImportQueue({...state,syncStatus:'diverged'});
}

export async function reconcileInventory(state: State) {
  const tree = await chrome.bookmarks.getTree();
  const nodes:chrome.bookmarks.BookmarkTreeNode[]=[];
  const walk=(items:chrome.bookmarks.BookmarkTreeNode[])=>{for(const node of items){if(node.url)nodes.push(node);if(node.children)walk(node.children)}};
  walk(tree);
  const cached=new Map(state.knownBookmarks.map(bookmark=>[bookmark.id,bookmark]));
  const bookmarks=(await Promise.all(nodes.map(node=>webBookmark(node,cached.get(node.id))))).filter((bookmark):bookmark is Bookmark=>Boolean(bookmark));
  const reconciled=mergeSites(reconcileBookmarks(state,bookmarks),mediaSites(bookmarks));
  return {...reconciled,inventory:{...reconciled.inventory,digest:await inventoryDigest(bookmarks)}};
}

/** Re-send the current Chrome snapshot without ever emitting removals. */
export async function reimportAllInventory(state: State, onProgress?: (processed:number,total:number)=>Promise<void>): Promise<State> {
  if (!state.deviceToken) return {...state, reimport:{status:'failed',processed:0,total:0,error:'UNPAIRED'}};
  const tree = await chrome.bookmarks.getTree();
  const bookmarks: Bookmark[] = [];
  const walk = async (nodes: chrome.bookmarks.BookmarkTreeNode[]) => { for (const node of nodes) { const bookmark=await webBookmark(node); if(bookmark)bookmarks.push(bookmark); if(node.children)await walk(node.children); } };
  await walk(tree);
  const refreshed=mergeSites(reconcileBookmarks({...state,queue:[]},bookmarks),mediaSites(bookmarks));
  const current={...refreshed,inventory:{...refreshed.inventory,digest:await inventoryDigest(bookmarks)},queue:bookmarks.map(bookmark=>({id:crypto.randomUUID(),type:'created' as const,bookmark,createdAt:Date.now(),attempts:0})),reimport:{status:'running' as const,processed:0,total:bookmarks.length,startedAt:Date.now()}};
  await saveState(current);
  let next:State=current;
  while(next.queue.length){
    const group=next.queue.slice(0,250);
    const response=await fetch(`${API}/extension/import-batches/admin-reimport`,{method:'POST',headers:{Authorization:`Bearer ${next.deviceToken}`,'Content-Type':'application/json','X-FavLib-Protocol':String(PROTOCOL),'Idempotency-Key':group[0].id},body:JSON.stringify({batchId:group[0].id,installationId:next.installationId,protocol:PROTOCOL,cursor:next.cursor,items:group.map(event=>({...event.bookmark,parsedTitle:parseFavorite({title:event.bookmark.title,url:event.bookmark.url}).displayTitle,event:event.type}))})});
    if(response.status===401)throw new Error('DEVICE_REVOKED'); if(response.status===403)throw new Error('ADMIN_REQUIRED'); if(response.status===426)throw new Error('PROTOCOL_UNSUPPORTED'); if(!response.ok)throw new Error(`REIMPORT_${response.status}`);
    const body=await response.json() as {cursor:string}; const progress=next.reimport!; next={...next,queue:next.queue.slice(group.length),cursor:body.cursor,reimport:{...progress,processed:progress.processed+group.length}}; await saveState(next); await onProgress?.(next.reimport!.processed,next.reimport!.total);
  }
  next={...next,reimport:{...next.reimport!,status:'completed' as const,finishedAt:Date.now()},syncStatus:'pending'}; await saveState(next); return verifyInventory(next);
}

export async function reportNavigation(state: State, url: string, title: string) {
  if (!state.deviceToken || !state.observeNavigation) return state;
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (!state.sites.some(site => site.permissionGranted && (host === site.domain || host.endsWith(`.${site.domain}`)))) return state;
  const progression = progressionFrom(title, url);
  if (!progression) return state;
  const candidates = state.knownBookmarks.filter(bookmark => {
    try {
      const bookmarkHost = new URL(bookmark.url).hostname.toLowerCase().replace(/^www\./, '');
      return bookmarkHost === host || bookmarkHost.endsWith(`.${host}`);
    } catch { return false; }
  });
  for (const bookmark of candidates) {
    const response = await fetch(`${API}/extension/progression`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.deviceToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarkId: bookmark.id, url, title, ...progression, confidence: 'high', consented: true })
    });
    if (response.status === 401) throw new Error('DEVICE_REVOKED');
    if (response.status === 426) throw new Error('PROTOCOL_UNSUPPORTED');
    if (!response.ok && ![400, 404, 409].includes(response.status)) throw new Error(`PROGRESSION_${response.status}`);
  }
  return state;
}
