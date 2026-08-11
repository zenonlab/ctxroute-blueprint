import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync(new URL('../migrations/0065_adjudicated_report_cases.sql',import.meta.url),'utf8');
describe('adjudicated report storage',()=>{
  it('deduplicates a user submission by revision without a report quorum trigger',()=>{expect(migration).toContain('UNIQUE(subject_key,evidence_revision)');expect(migration).toContain('UNIQUE(case_id,user_id)');expect(migration).not.toContain("state='SUSPENDED'")});
  it('keeps exact reversible source associations and immutable audit events',()=>{expect(migration).toContain('source_association_decision');expect(migration).toContain('media_id text NOT NULL');expect(migration).toContain('canonical_url text NOT NULL');expect(migration).toContain('report_case_audit_event');expect(migration).toContain('reverted_at')});
  it('retains original review/parser data through an explicit override',()=>{expect(migration).toContain('admin_identity_override');expect(migration).toContain('old_media_id');expect(migration).toContain('new_media_id');expect(migration).not.toMatch(/UPDATE\s+favorite_review\s+SET\s+decision/i)});
});
