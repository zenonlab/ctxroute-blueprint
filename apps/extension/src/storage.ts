import { State, bytes } from './core.js';
export const emptyState=():State=>({version:1,installationId:`inst_${crypto.randomUUID()}`,queue:[],cursor:null,lastSyncAt:null});
export async function loadState():Promise<State>{const {favlibState}=await chrome.storage.local.get('favlibState');return favlibState?.version===1?favlibState:emptyState()}
export async function saveState(state:State){if(bytes(state)>4.5*1024*1024)throw new Error('STORAGE_QUOTA_NEAR');await chrome.storage.local.set({favlibState:state})}
export async function updateState(fn:(state:State)=>State){const state=await loadState(),next=fn(state);await saveState(next);return next}
