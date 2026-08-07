import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('collective review anti-abuse migration',()=>{
  const sql=readFileSync(new URL('../migrations/0034_collective_review_registry.sql',import.meta.url),'utf8');
  it('requires an active aged account, verified device and pre-existing favorite',()=>{
    expect(sql).toContain('u.active');
    expect(sql).toContain("interval '7 days'");
    expect(sql).toContain('verified_sync_at IS NOT NULL');
    expect(sql).toContain("l.created_at<=now()-interval '24 hours'");
  });
  it('prevents a lone report from suspending collective identity',()=>{
    expect(sql).toContain('review_cluster_endorsement');
    expect(sql).toContain('favlib_promote_collective_endorsements');
    expect(sql).toContain('reliable_at');
  });
});
