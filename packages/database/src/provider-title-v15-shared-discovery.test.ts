import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0069_provider_title_v15_shared_discovery.sql',import.meta.url),'utf8');

describe('provider-title v15 shared discovery migration',()=>{
  it('queues one idempotent v30 enrichment sweep',()=>{
    expect(sql).toContain("'enrichment-sweep'");
    expect(sql).toContain("job_key := 'enrichment-sweep:provider-title-v15-shared-discovery-v30'");
    expect(sql).toContain("job_key_mode := 'replace'");
  });
});
