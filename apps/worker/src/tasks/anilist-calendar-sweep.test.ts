import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { aniListCalendarPollPlan, ensureAniListCalendarCatalog, latestAniListAvailableEpisode, processAniListCalendar } from './anilist-calendar-sweep.js';

describe('AniList calendar sweep',()=>{
  it('stores global calendar identifiers without creating favorites',async()=>{
    const sql:string[]=[];const h={query:async(query:string)=>{sql.push(query);return {rows:[],rowCount:1}}};
    await ensureAniListCalendarCatalog([{id:700,type:'ANIME',status:'RELEASING',title:{romaji:'Synthetic Airing'},synonyms:[],airingSchedule:[],externalLinks:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]}],h);
    expect(sql.some(query=>query.includes('media_external_id'))).toBe(true);
    expect(sql.some(query=>query.includes('bookmark_media_link'))).toBe(false);
    expect(sql.some(query=>query.includes("graphile_worker.add_job('anilist-enrichment'"))).toBe(true);
  });
  it('stores romaji for display and preserves Japanese as a native alias',async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];const h={query:async(sql:string,values?:unknown[])=>{calls.push({sql,values});return {rows:[],rowCount:1}}};
    await ensureAniListCalendarCatalog([{id:701,type:'ANIME',status:'RELEASING',title:{romaji:'Synthetic Romaji',native:'合成タイトル'},synonyms:[],airingSchedule:[],externalLinks:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]}],h);
    const inserts=calls.filter(call=>call.sql.startsWith('INSERT INTO media_title'));
    expect(inserts.some(call=>call.values?.[1]==='Synthetic Romaji'&&call.values?.[4]==='Latn'&&call.values?.[6]==='romaji')).toBe(true);
    expect(inserts.some(call=>call.values?.[1]==='合成タイトル'&&call.values?.[4]==='Jpan'&&call.values?.[6]==='native')).toBe(true);
    expect(calls.some(call=>call.sql.includes('bookmark_media_link'))).toBe(false);
  });
  it('keeps repeated normalized aliases idempotent without a conflicting title rewrite',async()=>{
    const sql:string[]=[];const h={query:async(query:string)=>{sql.push(query);return {rows:[],rowCount:1}}};
    const item={id:702,type:'ANIME' as const,status:'RELEASING',title:{romaji:'Synthetic Alias',english:'Synthetic Alias'},synonyms:['Synthetic-Alias'],airingSchedule:[],externalLinks:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]};
    await ensureAniListCalendarCatalog([item],h);
    expect(sql.filter(query=>query.startsWith('INSERT INTO media_title')).every(query=>query.includes('ON CONFLICT DO NOTHING'))).toBe(true);
    expect(sql.some(query=>query.startsWith('UPDATE media_title'))).toBe(false);
  });
  it('updates the stable episode event when AniList changes its airing instant',async()=>{
    const sql:string[]=[];
    const h={query:async(query:string)=>{sql.push(query);if(query.includes('FROM media_external_id'))return {rows:[{mediaId:'anilist:42'}],rowCount:1};return {rows:[],rowCount:1}}};
    const result=await processAniListCalendar([{id:42,type:'ANIME',title:{},synonyms:[],airingSchedule:[{episode:3,airingAt:1_786_000_000}],externalLinks:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]}],h);
    expect(result.saved).toBe(1);
    expect(sql.find(query=>query.includes('INSERT INTO media_airing'))).toContain('ON CONFLICT(media_id,provider,episode)');
    expect(sql.find(query=>query.includes('INSERT INTO media_airing'))).toContain('airing_at_utc=excluded.airing_at_utc');
  });
  it('never polls completed anime and backs off an undated hiatus',()=>{
    const base={id:1,type:'ANIME' as const,title:{},synonyms:[],airingSchedule:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]};
    expect(aniListCalendarPollPlan({...base,status:'FINISHED'}).nextCheckAt).toBeNull();
    const hiatus=aniListCalendarPollPlan({...base,status:'HIATUS'},0);
    expect(hiatus).toMatchObject({priority:10,reason:'HIATUS_WITHOUT_DATE'});
    expect(hiatus.nextCheckAt?.getTime()).toBe(30*24*60*60_000);
  });
  it('raises a dated hiatus to the urgent queue',()=>{
    const base={id:1,type:'ANIME' as const,title:{},synonyms:[],airingSchedule:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]};
    expect(aniListCalendarPollPlan({...base,status:'HIATUS',nextAiringEpisode:{episode:4,airingAt:86_400}},0)).toMatchObject({priority:100,reason:'HIATUS_RESUME_SCHEDULED'});
  });
  it('keeps terminal anime due until their final availability was checked',()=>{
    const source=readFileSync(new URL('./anilist-calendar-sweep.ts',import.meta.url),'utf8');
    expect(source).toContain("terminalAvailabilityChecked:TERMINAL_STATUSES.has");
    expect(source).toContain("COALESCE(p.provenance->>'terminalAvailabilityChecked','false')<>'true'");
  });
  it('promotes only aired episodes from the rolling calendar and keeps the final total',async()=>{
    const base={id:7,type:'ANIME' as const,title:{},synonyms:[],relations:[],streamingEpisodes:[],studios:[],authors:[],tags:[],genres:[]};
    const now=2_000_000_000_000;
    const airingSchedule=[{episode:11,airingAt:now/1000-60},{episode:12,airingAt:now/1000+60}];
    expect(latestAniListAvailableEpisode({...base,status:'RELEASING',airingSchedule},now)).toEqual({episode:11,evidence:'aired-calendar'});
    expect(latestAniListAvailableEpisode({...base,status:'FINISHED',episodes:24,airingSchedule:[]},now)).toEqual({episode:24,evidence:'completed-total'});
    expect(latestAniListAvailableEpisode({...base,status:'RELEASING',nextAiringEpisode:{episode:8,airingAt:now/1000+60},airingSchedule:[]},now)).toEqual({episode:7,evidence:'next-airing-predecessor'});
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const h={query:async(sql:string,values?:unknown[])=>{calls.push({sql,values});if(sql.includes('FROM media_external_id'))return {rows:[{mediaId:'anilist:7'}],rowCount:1};return {rows:[],rowCount:1}}};
    await processAniListCalendar([{...base,status:'RELEASING',airingSchedule}],h,now);
    const progress=calls.find(call=>call.sql.includes('INSERT INTO provider_progress'))!;
    expect(progress.values?.slice(1,6)).toEqual(['Ongoing','episode',11,'11',{provider:'anilist',anilistId:7,evidence:'aired-calendar',observedAt:new Date(now).toISOString()}]);
    expect(progress.sql).toContain('provider_progress.available_position_number>excluded.available_position_number');
  });
});
