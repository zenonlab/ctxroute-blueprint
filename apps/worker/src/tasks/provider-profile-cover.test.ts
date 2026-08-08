import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('provider profile cover promotion',()=>{
  it('promotes a synthetic resolved provider profile asset to its media cover',()=>{
    const source=readFileSync(new URL('./provider-profile-cover.ts',import.meta.url),'utf8');
    expect(source).toContain('FROM media_external_id external');
    expect(source).toContain('favorite_review_candidate candidate');
    expect(source).toContain('candidate.profile_id=profile.id');
    expect(source).toContain("profile.cover_status='ACTIVE'");
    expect(source).toContain("media_cover.status IN ('FAILED','STALE','FALLBACK')");
    expect(source).toContain("jsonb_build_object('source','provider-profile-cover'");
  });
});
