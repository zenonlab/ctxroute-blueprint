import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0070_provider_title_v16_explicit_anime_season.sql',import.meta.url),'utf8');

describe('provider-title v16 explicit anime season migration',()=>{
  it('reassesses reviews and stale enrichment through bounded jobs',()=>{
    expect(sql).toContain("'reassess-favorite-reviews'");
    expect(sql).toContain("'enrichment-sweep'");
    expect(sql).toContain('provider-title-v16');
    expect(sql).toContain('anilist-v31');
    expect(sql).not.toContain('DELETE FROM');
  });
});
