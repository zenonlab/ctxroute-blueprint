import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../migrations/0068_provider_title_v15_connector_reassessment.sql',import.meta.url),'utf8');

describe('provider-title v15 connector reassessment migration',()=>{
  it('queues one idempotent bounded enrichment sweep',()=>{
    expect(sql).toContain("'enrichment-sweep'");
    expect(sql).toContain("job_key := 'enrichment-sweep:provider-title-v15-connectors-v29'");
    expect(sql).toContain("job_key_mode := 'replace'");
  });
});
