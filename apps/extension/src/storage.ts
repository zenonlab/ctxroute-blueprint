import { State, bytes, fingerprint } from './core.js';

export const emptyState=():State=>({version:6,progressCatchupPending:false,installationId:`inst_${crypto.randomUUID()}`,queue:[],cursor:null,lastSyncAt:null,sites:[],checks:[],autoUpdateFavorites:false,observeNavigation:false,syncMinutes:15,availableVersion:null,updates:[],pendingProposalResults:[],knownBookmarks:[],inventory:{totalWeb:0,likelyMedia:0,ambiguous:0,digest:null,updatedAt:null},syncStatus:'unpaired'});

export function migrateState(value:unknown):State|null {
  const old=value as (Partial<Omit<State,'version'>>&{version?:number})|undefined;
  if(!old||!old.installationId||!Array.isArray(old.queue))return null;
  const pairing=old.pairing&&typeof old.pairing.challengeId==='string'&&typeof old.pairing.code==='string'&&typeof old.pairing.expiresAt==='string'?{...old.pairing,status:old.pairing.status??'pending'}:undefined;
  if(old.version===2||old.version===3||old.version===4||old.version===5||old.version===6){const inventory=old.inventory??{totalWeb:old.knownBookmarks?.length??0,likelyMedia:old.knownBookmarks?.length??0,ambiguous:0,updatedAt:null};const known=old.knownBookmarks??[];const catchup=old.version!==6;const queued=catchup?[...(old.queue??[]),...known.filter(bookmark=>!(old.queue??[]).some(event=>event.bookmark.id===bookmark.id)).map(bookmark=>({id:crypto.randomUUID(),type:'created' as const,bookmark,createdAt:Date.now(),attempts:0}))]:old.queue;return {...emptyState(),...old,version:6,progressCatchupPending:catchup||(old.progressCatchupPending??false),queue:queued,sites:old.sites??[],checks:old.checks??[],updates:old.updates??[],pendingProposalResults:old.pendingProposalResults??[],knownBookmarks:known,inventory:{...inventory,digest:(inventory as State['inventory']).digest??null},autoUpdateFavorites:old.autoUpdateFavorites??false,observeNavigation:old.observeNavigation??false,syncMinutes:old.syncMinutes??15,availableVersion:old.availableVersion??null,accountRole:old.accountRole,reimport:old.reimport,pairing,syncStatus:(old as Partial<State>).syncStatus??(old.deviceToken?'pending':'unpaired')}};
  if(old.version===1)return {...emptyState(),installationId:old.installationId,deviceToken:old.deviceToken,pairing,queue:old.queue,cursor:old.cursor??null,lastSyncAt:old.lastSyncAt??null};
  return null;
}

export async function loadState():Promise<State>{const {favlibState}=await chrome.storage.local.get('favlibState');const state=migrateState(favlibState)??emptyState();const hydrate=async(bookmark:State['knownBookmarks'][number])=>({...bookmark,fingerprint:/^[0-9a-f]{64}$/.test(bookmark.fingerprint??'')?bookmark.fingerprint:await fingerprint(bookmark)});return {...state,knownBookmarks:await Promise.all(state.knownBookmarks.map(hydrate)),queue:await Promise.all(state.queue.map(async event=>({...event,bookmark:await hydrate(event.bookmark)})))}}
export async function saveState(state:State){
  // Chrome storage.local is quota-limited. Diagnostics are deliberately
  // reproducible and must never prevent bookmark synchronization from being
  // persisted.
  const compact={...state,
    debugReport:undefined,
    diagnostic:state.diagnostic?.status==='ok'?undefined:state.diagnostic,
    updates:state.updates.slice(-200),
    pendingProposalResults:state.pendingProposalResults.slice(-200),
    checks:state.checks.slice(-500),
  } as State;
  if(bytes(compact)>4.5*1024*1024)throw new Error('STORAGE_QUOTA_NEAR');
  await chrome.storage.local.set({favlibState:compact});
}
let updateTail:Promise<void>=Promise.resolve();
export function updateState(fn:(state:State)=>State){
  const operation=updateTail.then(async()=>{const state=await loadState(),next=fn(state);await saveState(next);return next});
  updateTail=operation.then(()=>undefined,()=>undefined);
  return operation;
}
