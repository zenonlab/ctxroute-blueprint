import {describe,expect,it} from 'vitest';
import {adminReportDecisionContract,sourceReportContract,userReportContract} from './index.js';

const identityBase={family:'IDENTITY' as const,mediaId:'synthetic-media',subjectKey:'identity:synthetic-media',evidenceRevision:'synthetic-revision'};
const sourceBase={family:'SOURCE' as const,mediaId:'synthetic-media',subjectKey:'source:synthetic-media:synthetic-key',evidenceRevision:'synthetic-revision',canonicalUrl:'https://synthetic.invalid/work'};

describe('adjudicated reporting contracts',()=>{
  it.each(['WRONG_IDENTITY','WRONG_SEASON','WRONG_MEDIA_TYPE','PROVIDER_RECORD_CHANGED'] as const)('accepts identity reason %s without domain-specific corrections',reason=>expect(userReportContract.safeParse({...identityBase,reason}).success).toBe(true));
  it('requires details for another identity problem',()=>{expect(userReportContract.safeParse({...identityBase,reason:'OTHER_IDENTITY'}).success).toBe(false);expect(userReportContract.safeParse({...identityBase,reason:'OTHER_IDENTITY',details:'Synthetic detail'}).success).toBe(true)});
  it.each(['WRONG_WORK','WRONG_LANGUAGE','UNSTABLE_WORK_PAGE','WRONG_EDITION','WRONG_ACCESS_MODE','UNRELATED_OR_UNSAFE'] as const)('accepts source reason %s',reason=>expect(userReportContract.safeParse({...sourceBase,reason}).success).toBe(true));
  it('requires details for another source problem and keeps legacy dead-link compatibility',()=>{expect(userReportContract.safeParse({...sourceBase,reason:'OTHER_SOURCE'}).success).toBe(false);expect(userReportContract.safeParse({...sourceBase,reason:'OTHER_SOURCE',details:'Synthetic detail'}).success).toBe(true);expect(sourceReportContract.safeParse({mediaId:'synthetic-media',canonicalUrl:'https://synthetic.invalid/work',reason:'DEAD_LINK'}).success).toBe(true)});
  it('requires an explicit confirmed revision-bound admin decision',()=>{expect(adminReportDecisionContract.safeParse({verdict:'KEEP',scope:'SUBJECT'}).success).toBe(false);expect(adminReportDecisionContract.safeParse({verdict:'KEEP',scope:'SUBJECT',expectedEvidenceRevision:'synthetic-revision',confirm:true}).success).toBe(true)});
});
