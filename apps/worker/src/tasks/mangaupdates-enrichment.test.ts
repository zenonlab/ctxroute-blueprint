import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {mangaUpdatesAvailableChapter} from './mangaupdates-enrichment.js';

describe('MangaUpdates provider availability',()=>{
  it('rejects provider zero sentinels and preserves positive raw chapter values',()=>{
    expect(mangaUpdatesAvailableChapter('0')).toBeUndefined();
    expect(mangaUpdatesAvailableChapter(0)).toBeUndefined();
    expect(mangaUpdatesAvailableChapter('33')).toEqual({raw:'33',number:33});
    expect(mangaUpdatesAvailableChapter('33.5')).toEqual({raw:'33.5',number:33.5});
  });
  it('removes legacy zero assertions before monotonic provider upserts',()=>{
    const source=readFileSync(new URL('./mangaupdates-enrichment.ts',import.meta.url),'utf8');
    expect(source).toContain("DELETE FROM metadata_assertion");
    expect(source).toContain("available_position_number=0");
    expect(source).toContain("chapter?.raw??null");
    expect(source).not.toContain("s.latestChapter??null,s.latestVolume");
  });
});
