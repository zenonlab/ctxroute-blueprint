import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0067_provider_title_v15_delimited_alias.sql',import.meta.url),'utf8');

describe('provider-title v15 reassessment migration',()=>{
  it('queues one bounded idempotent reassessment without embedding a work title',()=>{
    expect(sql).toContain("'reassess-favorite-reviews'");
    expect(sql).toContain("job_key := 'review-reassess:provider-title-v15'");
    expect(sql).toContain('job_key_mode := \'replace\'');
    expect(sql).not.toMatch(/good\s*bye|dragon|human/iu);
  });
});
