import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('shared review registry',()=>{
  it('propagates saved profiles without encoding a provider result in logic',()=>{
    const source=readFileSync(new URL('./favorite-review.ts',import.meta.url),'utf8');
    expect(source).toContain('review_cluster_candidate');
    expect(source).toContain("r.status='PENDING'");
    expect(source).toContain('LIMIT 5');
    expect(source).not.toContain('oqvzgof');
  });
});
