import { loadState, updateState } from '../src/storage.js';
import { initialImport, upload } from '../src/sync.js';
import { mediaBookmark } from '../src/core.js';
declare function defineBackground(main:()=>void): unknown;
export default defineBackground(()=>{const sync=async()=>{try{let state=await loadState();if(!state.deviceToken)return;state=await upload(state);await chrome.storage.local.set({favlibDiagnostic:{status:'ok',lastError:null,queue:state.queue.length}})}catch(error){const message=String(error);const status=message.includes('PROTOCOL')?'protocol':message.includes('REVOKED')?'revoked':message.includes('QUOTA')?'quota':'offline';await chrome.storage.local.set({favlibDiagnostic:{status,lastError:message,queue:(await loadState()).queue.length}})}};
chrome.runtime.onMessage.addListener((message)=>{if(message?.type==='sync')void sync()});
chrome.runtime.onInstalled.addListener(async()=>{const state=await loadState();await updateState(s=>s);if(!state.deviceToken){const next=await initialImport(state);await updateState(()=>next)}await sync()});
for(const [event,type] of [[chrome.bookmarks.onCreated,'created'],[chrome.bookmarks.onChanged,'changed'],[chrome.bookmarks.onMoved,'moved'],[chrome.bookmarks.onRemoved,'removed']] as const)event.addListener(async(id)=>{const node=await chrome.bookmarks.get(id).catch(()=>[] as chrome.bookmarks.BookmarkTreeNode[]);if(!node[0])return;const bookmark=await mediaBookmark(node[0],type);if(!bookmark)return;await updateState(s=>({...s,queue:[...s.queue,{id:crypto.randomUUID(),type,bookmark,createdAt:Date.now(),attempts:0}]}));await sync()});
chrome.alarms.create('favlib-sync',{periodInMinutes:15});chrome.alarms.onAlarm.addListener(sync);});
