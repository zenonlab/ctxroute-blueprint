import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

describe('admin review adjudication history',()=>{
  const migration=readFileSync(new URL('../migrations/0034_collective_review_registry.sql',import.meta.url),'utf8');
  const api=readFileSync(new URL('../../../apps/api/src/server.ts',import.meta.url),'utf8');
  it('keeps an immutable reversible history',()=>{
    expect(migration).toContain("action IN ('CHOOSE','REVERT')");
    expect(migration).toContain('previous_consensus_profile_id');
    expect(migration).toContain('reverted_decision_id');
  });
  it('preserves qualified ambiguity during an admin choice and revert',()=>{
    expect(api).toContain("qualified>=2?'HOMONYM_REQUIRED':'CONFIRMED'");
    expect(api).toContain("action,selected_profile_id,previous_state");
    expect(api).toContain("/revert'");
  });
});
