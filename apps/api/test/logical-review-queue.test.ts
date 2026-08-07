import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('logical personal review queue',()=>{
  const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
  it('counts one pending item per personal cluster and exposes compatibility fields',()=>{
    expect(source).toContain('count(DISTINCT COALESCE(cluster_id::text,id::text))');
    expect(source).toContain('r.cluster_id AS "clusterId"');
    expect(source).toContain('c.favorite_count AS "favoriteCount"');
    expect(source).toContain('count(DISTINCT c.provider_id)');
  });
  it('accepts a candidate from a sibling row without crossing users and propagates no-match',()=>{
    expect(source).toContain('candidate_owner.user_id=r.user_id');
    expect(source).toContain('pending.user_id=source.user_id');
    expect(source).toContain("pending.decision IS NULL RETURNING pending.id");
  });
  it('shows canonical titles before matched aliases',()=>{
    expect(source).toContain('COALESCE(p.canonical_title,c.canonical_title,c.provider_id) AS "displayTitle"');
    expect(source).toContain('c.hit_title AS "matchedAlias"');
  });
});
