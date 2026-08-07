import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('manual review cluster propagation',()=>{
  const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../../worker/src/tasks/manual-review-provider.ts',import.meta.url),'utf8');
  it('attaches both cached and freshly verified profiles to the shared cluster',()=>{
    expect(source.match(/attachManualProfileToCluster\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('INSERT INTO review_cluster_candidate(cluster_id,profile_id)');
    expect(source).toContain("pending.status='PENDING'");
    expect(worker).toContain('INSERT INTO review_cluster_candidate(cluster_id,profile_id)');
    expect(worker).toContain("pending.status='PENDING'");
    expect(worker).toContain('ON CONFLICT(review_id,provider_id) DO UPDATE');
  });
  it('applies one user decision to that users pending reviews in the exact same cluster',()=>{
    expect(source).toContain("COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(source.cluster_id::text,source.id::text)");
    expect(source).toContain("pending.user_id=source.user_id");
    expect(source).toContain("pending.decision IS NULL");
    expect(source).toContain("'same-user-cluster'");
    expect(source).toContain('resolvedSiblingCount');
  });
});
