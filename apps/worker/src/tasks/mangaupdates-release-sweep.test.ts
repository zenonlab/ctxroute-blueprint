import { describe,expect,it } from 'vitest';
import { mangaUpdatesReleaseKey, processMangaUpdatesReleases, storeMangaUpdatesCalendarIdentifier } from './mangaupdates-release-sweep.js';
import { readFileSync } from 'node:fs';

describe('MangaUpdates release sweep',()=>{
  it('queues reading imports on the same priority lane as calendar anime',()=>{
    const source=readFileSync(new URL('./mangaupdates-release-sweep.ts',import.meta.url),'utf8');
    expect(source).toContain("priority := -20");
    expect(source).toContain("job_key_mode := 'replace'");
  });
  it('retains an unknown global series identifier without creating a favorite',async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];const h={query:async(sql:string,values?:unknown[])=>{calls.push({sql,values});return {rows:[],rowCount:1}}};
    await storeMangaUpdatesCalendarIdentifier({seriesId:'synthetic-700',seriesTitle:'Synthetic Reading',chapter:'7'},h);
    expect(calls[0]?.sql).toContain('provider_profile');expect(calls[0]?.values?.[0]).toBe('synthetic-700');expect(calls.some(call=>call.sql.includes('bookmark_media_link'))).toBe(false);
    const enrichment=calls.find(call=>call.sql.includes("add_job('mangaupdates-enrichment"));
    expect(enrichment?.values?.[0]).toContain('"forceRefresh":true');
    expect(enrichment?.values?.[0]).not.toContain('"cover":true');
  });
  it('keeps language and group outside the logical release identity',()=>{
    const a={chapter:'12',volume:'1',group:'A',language:'en'};const b={chapter:'12',volume:'1',group:'B',language:'fr'};
    expect(mangaUpdatesReleaseKey('media-1',a)).toBe(mangaUpdatesReleaseKey('media-1',b));
  });
  it('matches a known provider id and writes durable progress without image calls',async()=>{
    const sql:string[]=[];const h={query:async(query:string)=>{sql.push(query);if(query.includes('FROM media m'))return {rows:[{mediaId:'media-1',type:'MANGA',year:2020,titles:['Solo Leveling'],muId:'42'}]};return {rows:[]}}};
    const result=await processMangaUpdatesReleases([{seriesId:'42',seriesTitle:'나 혼자만 레벨업',chapter:'201',releaseDate:'2026-08-03'}],h);
    expect(result).toMatchObject({announcements:1,progress:1,review:0});expect(sql.some(query=>query.includes('release_announcement'))).toBe(true);expect(sql.some(query=>query.includes('provider_progress'))).toBe(true);expect(sql.some(query=>query.includes('image'))).toBe(false);
  });
  it('propagates provider failures so Graphile can retry instead of recording false success',async()=>{
    const source=readFileSync(new URL('./mangaupdates-release-sweep.ts',import.meta.url),'utf8');
    expect(source).toMatch(/catch \(error\)[\s\S]*throw error;[\s\S]*finally/u);
  });
});
