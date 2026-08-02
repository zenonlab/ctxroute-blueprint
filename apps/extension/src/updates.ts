import { BookmarkUpdate, State } from './core.js';

export type NextSequence={url:string,title:string,confidence:'clear'|'ambiguous'};
export function proposeFavoriteUpdate(current:{id:string,url:string,title:string},next:NextSequence,state:State):BookmarkUpdate|null {
  if(!state.autoUpdateFavorites||next.confidence!=='clear'||current.url===next.url&&current.title===next.title)return null;
  return {id:current.id,oldUrl:current.url,oldTitle:current.title,newUrl:next.url,newTitle:next.title,createdAt:Date.now()};
}
export async function applyFavoriteUpdate(update:BookmarkUpdate):Promise<void>{await chrome.bookmarks.update(update.id,{url:update.newUrl,title:update.newTitle})}
export async function undoFavoriteUpdate(update:BookmarkUpdate):Promise<void>{await chrome.bookmarks.update(update.id,{url:update.oldUrl,title:update.oldTitle})}
export async function undoLoggedUpdate(state:State,index:number):Promise<State>{const update=state.updates[index];if(!update||update.undoneAt)return state;await undoFavoriteUpdate(update);const next={...state,updates:state.updates.map((entry,i)=>i===index?{...entry,undoneAt:Date.now()}:entry)};return next}
