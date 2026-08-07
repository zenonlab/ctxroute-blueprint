import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('manual review cluster propagation',()=>{
  const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  it('attaches both cached and freshly verified profiles to the shared cluster',()=>{
    expect(source.match(/attachManualProfileToCluster\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain('INSERT INTO review_cluster_candidate(cluster_id,profile_id)');
    expect(source).toContain("pending.status='PENDING'");
  });
  it('applies one user decision to that users pending reviews in the exact same cluster',()=>{
    expect(source).toContain("pending.cluster_id=source.cluster_id");
    expect(source).toContain("pending.user_id=source.user_id");
    expect(source).toContain("pending.decision IS NULL");
    expect(source).toContain("'same-user-cluster'");
    expect(source).toContain('resolvedSiblingCount');
  });
});
