import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('weekly MangaDex promotion contract',()=>{
  const source=readFileSync(new URL('./mangadex-promotion.ts',import.meta.url),'utf8');
  it('keeps editorial MangaDex data while changing only public identity',()=>{
    expect(source).toContain("mm.provider='mangadex'");
    expect(source).toContain("UPDATE media_metadata SET provider='mangaupdates'");
    expect(source).not.toContain('DELETE FROM metadata_assertion');
    expect(source).not.toContain('UPDATE media_cover');
  });
  it('uses the shared matcher and reschedules non-unique or failed attempts to a common Monday',()=>{
    expect(source).toContain('decideMangaUpdatesTitleMatch');
    expect(source).toContain('favlib_next_paris_monday');
    expect(source).not.toMatch(/popularity|bayesian|ratingVotes/u);
  });
});
