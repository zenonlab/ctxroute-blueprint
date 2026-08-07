import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('consolidated collective review registry',()=>{
  const sql=readFileSync(new URL('../migrations/0034_collective_review_registry.sql',import.meta.url),'utf8');
  it('stores a synthetic new-owner endorsement before reliable promotion',()=>{
    expect(sql).toContain('CREATE TABLE review_cluster_endorsement');
    expect(sql).toContain("u.created_at<=now()-interval '7 days'");
    expect(sql.indexOf('CREATE TABLE review_cluster_endorsement')).toBeLessThan(sql.indexOf('CREATE TABLE review_cluster_vote'));
    expect(sql).not.toMatch(/TRIGGER review_cluster_endorsement.*eligible/is);
  });
  it('uses revalidation identity instead of a historical review as fresh participation',()=>{
    expect(sql).toContain('revalidation_id uuid');
    expect(sql).toContain('review_cluster_endorsement_revalidation_fk');
    expect(sql).toContain('CHECK((review_id IS NOT NULL)::int+(revalidation_id IS NOT NULL)::int=1)');
  });
  it('records empty discovery and forbids cross-provider media clusters',()=>{
    expect(sql).toContain("status IN ('RESULTS','EMPTY')");
    expect(sql).toContain("provider='anilist' AND media_type='ANIME'");
    expect(sql).toContain("provider='mangaupdates' AND media_type IN ('MANGA','MANHWA','MANHUA')");
  });
});
