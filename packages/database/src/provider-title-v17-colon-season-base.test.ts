import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0071_provider_title_v17_colon_season_base.sql',import.meta.url),'utf8');

describe('provider-title v17 colon season base migration',()=>{
  it('reassesses reviews and stale AniList enrichment through bounded jobs',()=>{
    expect(sql).toContain("'reassess-favorite-reviews'");
    expect(sql).toContain("'enrichment-sweep'");
    expect(sql).toContain('provider-title-v17');
    expect(sql).toContain('anilist-v32');
    expect(sql).not.toContain('DELETE FROM');
  });
});
