import {describe,expect,it} from 'vitest';
import {collectiveReviewIdentityContract,reviewQueueContract} from './index.js';

describe('collective review provider contract',()=>{
  it('keeps logical review fields optional while exposing cluster counts',()=>{
    const parsed=reviewQueueContract.parse({items:[{id:'00000000-0000-4000-8000-000000000001',clusterId:'00000000-0000-4000-8000-000000000002',favoriteCount:3,candidateCount:2,provider:'anilist',status:'PENDING'}],pendingCount:1});
    expect(parsed.items[0].favoriteCount).toBe(3);
  });
  it('accepts only explicit canonical provider/media pairs',()=>{
    expect(collectiveReviewIdentityContract.safeParse({provider:'anilist',mediaType:'ANIME',parsedTitle:'Synthetic Anime'}).success).toBe(true);
    expect(collectiveReviewIdentityContract.safeParse({provider:'mangaupdates',mediaType:'MANHWA',parsedTitle:'Synthetic Reading'}).success).toBe(true);
    expect(collectiveReviewIdentityContract.safeParse({provider:'mangaupdates',mediaType:'ANIME',parsedTitle:'Synthetic Anime'}).success).toBe(false);
    expect(collectiveReviewIdentityContract.safeParse({provider:'anilist',mediaType:'MANGA',parsedTitle:'Synthetic Reading'}).success).toBe(false);
  });
});
