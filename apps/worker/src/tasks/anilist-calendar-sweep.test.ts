import { describe,expect,it } from 'vitest';
import { aniListCalendarPollPlan, processAniListCalendar } from './anilist-calendar-sweep.js';

describe('AniList calendar sweep',()=>{
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
});
