import { describe,expect,it } from 'vitest';
import { mangaUpdatesReleaseKey, processMangaUpdatesReleases } from './mangaupdates-release-sweep.js';

describe('MangaUpdates release sweep',()=>{
  it('keeps language and group outside the logical release identity',()=>{
    const a={chapter:'12',volume:'1',group:'A',language:'en'};const b={chapter:'12',volume:'1',group:'B',language:'fr'};
    expect(mangaUpdatesReleaseKey('media-1',a)).toBe(mangaUpdatesReleaseKey('media-1',b));
  });
  it('matches a known provider id and writes durable progress without image calls',async()=>{
    const sql:string[]=[];const h={query:async(query:string)=>{sql.push(query);if(query.includes('FROM media m'))return {rows:[{mediaId:'media-1',type:'MANGA',year:2020,titles:['Solo Leveling'],muId:'42'}]};return {rows:[]}}};
    const result=await processMangaUpdatesReleases([{seriesId:'42',seriesTitle:'나 혼자만 레벨업',chapter:'201',releaseDate:'2026-08-03'}],h);
    expect(result).toMatchObject({announcements:1,progress:1,review:0});expect(sql.some(query=>query.includes('release_announcement'))).toBe(true);expect(sql.some(query=>query.includes('provider_progress'))).toBe(true);expect(sql.some(query=>query.includes('image'))).toBe(false);
  });
});
