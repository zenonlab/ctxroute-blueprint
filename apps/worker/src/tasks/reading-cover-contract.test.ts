import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

describe('reading cover provider chain',()=>{
  it('uses MangaUpdates for reading covers and never substitutes AniList',()=>{
    const source=readFileSync(resolve(process.cwd(),'src/tasks/mangaupdates-enrichment.ts'),'utf8');
    expect(source).toContain('provider: "mangaupdates"');
    expect(source).toContain('MANGAUPDATES_COVER_UNAVAILABLE');
    expect(source).not.toContain('searchAniList');
    expect(source).toContain('purpose: "cover"');
    expect(source.indexOf("resolvedMu.rows[0]?.external_id")).toBeLessThan(source.indexOf('purpose: "cover"'));
    expect(source).toContain('await enrichCover(mediaId, h)');
  });
});
