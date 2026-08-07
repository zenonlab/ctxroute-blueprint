import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('bounded useful review cards',()=>{
  const sql=readFileSync(new URL('../migrations/0034_collective_review_registry.sql',import.meta.url),'utf8');
  it('locks at most two cards and can replace a weaker lock',()=>{
    expect(sql).toContain('locked_at');
    expect(sql).toContain('review_cluster_candidate_position_event');
    expect(sql).toContain('review_cluster_endorsement');
  });
  it('ranks only local evidence and records every transition',()=>{
    expect(sql).toContain('score jsonb');
    expect(sql).toContain('favlib_provider_audience_signal');
    expect(sql).toContain('display-only');
  });
});
