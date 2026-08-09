import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('weekly MangaDex promotion contract',()=>{
  const source=readFileSync(new URL('./mangadex-promotion.ts',import.meta.url),'utf8');
  it('dispatches the canonical enrichment pipeline without writing provider identity itself',()=>{
    expect(source).toContain("mm.provider='mangadex'");
    expect(source).toContain("'mangaupdates-enrichment'");
    expect(source).toContain('forceRefresh:true');
    expect(source).not.toContain("UPDATE media_metadata SET provider='mangaupdates'");
    expect(source).not.toContain('INSERT INTO metadata_assertion');
    expect(source).not.toContain('DELETE FROM metadata_assertion');
    expect(source).not.toContain('UPDATE media_cover');
  });
  it('requires stored links.mu and reschedules attempts to a common Monday',()=>{
    expect(source).toContain('parseMangaDexManga');
    expect(source).toContain('mangaUpdatesId');
    expect(source).toContain('MANGADEX_MU_LINK_MISSING');
    expect(source).toContain('favlib_next_paris_monday');
    expect(source).not.toMatch(/popularity|bayesian|ratingVotes/u);
  });
});
