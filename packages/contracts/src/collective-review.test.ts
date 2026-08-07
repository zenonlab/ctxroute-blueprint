import {describe,expect,it} from 'vitest';
import {collectiveReviewIdentityContract} from './index.js';

describe('collective review provider contract',()=>{
  it('accepts only explicit canonical provider/media pairs',()=>{
    expect(collectiveReviewIdentityContract.safeParse({provider:'anilist',mediaType:'ANIME',parsedTitle:'Synthetic Anime'}).success).toBe(true);
    expect(collectiveReviewIdentityContract.safeParse({provider:'mangaupdates',mediaType:'MANHWA',parsedTitle:'Synthetic Reading'}).success).toBe(true);
    expect(collectiveReviewIdentityContract.safeParse({provider:'mangaupdates',mediaType:'ANIME',parsedTitle:'Synthetic Anime'}).success).toBe(false);
    expect(collectiveReviewIdentityContract.safeParse({provider:'anilist',mediaType:'MANGA',parsedTitle:'Synthetic Reading'}).success).toBe(false);
  });
});
