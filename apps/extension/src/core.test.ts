import { describe, expect, it, vi } from 'vitest';
import { chunks, code, fingerprint, isMedia } from './core.js';
import { emptyState, updateState } from './storage.js';
describe('extension bookmark inventory primitives',()=>{
  it('serializes concurrent storage updates so neither queued favorite is lost',async()=>{
    let stored=emptyState();
    let releaseFirst!:()=>void;
    const firstWrite=new Promise<void>(resolve=>{releaseFirst=resolve});
    let writes=0;
    vi.stubGlobal('chrome',{storage:{local:{get:vi.fn(async()=>({favlibState:stored})),set:vi.fn(async({favlibState})=>{writes++;if(writes===1)await firstWrite;stored=favlibState})}}});
    const add=(id:string)=>updateState(state=>({...state,queue:[...state.queue,{id:`event-${id}`,type:'created' as const,bookmark:{id,parentId:null,title:`Synthetic ${id}`,url:`https://example.test/${id}`,dateAdded:null,dateGroupModified:null,fingerprint:`fingerprint-${id}`},createdAt:1,attempts:0}]}));
    const first=add('one'),second=add('two');releaseFirst();await Promise.all([first,second]);
    expect(stored.queue.map(item=>item.bookmark.id)).toEqual(['one','two']);
    vi.unstubAllGlobals();
  });
  it('keeps the lexical signal as a hint rather than an upload gate',()=>{expect(isMedia('Documentation','https://example.test/docs')).toBe(false);expect(isMedia('Anime episode 12','https://example.test/watch/12')).toBe(true)});
  it('fingerprints canonically and chunks bounded batches',async()=>{expect(await fingerprint({title:' A ',url:'https://EXAMPLE.test/a#tracking'})).toBe(await fingerprint({title:'A',url:'https://example.test/a'}));expect(chunks([1,2,3],2)).toEqual([[1,2],[3]])});
  it('generates eight digit pairing codes',()=>expect(code()).toMatch(/^\d{8}$/));
});
