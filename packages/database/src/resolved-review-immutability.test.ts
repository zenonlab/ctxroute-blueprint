import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('resolved favorite database invariant',()=>{
  it('blocks automated identity/status rewrites but permits removal and the bounded repair session',()=>{
    const sql=readFileSync(resolve(process.cwd(),'migrations/0061_immutable_resolved_favorite_links.sql'),'utf8');
    expect(sql).toContain("r.status='RESOLVED'");
    expect(sql).toContain('r.decision IS NOT NULL');
    expect(sql).toContain("NEW.status <> 'removed'");
    expect(sql).toContain("current_setting('favlib.resolved_review_repair', true) = 'on'");
    expect(sql).toContain('NEW.media_id IS DISTINCT FROM OLD.media_id');
  });
});
