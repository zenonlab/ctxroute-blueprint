import { describe, expect, it } from 'vitest';
import { catalogDetailContract, catalogRelatedDetailContract } from './index.js';

describe('synthetic related work contract',()=>{
  it('keeps relations bounded and separate from title identity',()=>{
    const result=catalogDetailContract.parse({favorites:[],sources:[],relatedWorks:[{id:'synthetic-related',title:'Related title',type:'ANIME',format:'TV',seasonYear:2027,sequenceOrder:1,relationDepth:2,relationTypes:['SEQUENCE_MEMBER','SEQUEL'],anilistId:'42',coverUrl:'/api/v1/library/synthetic-root/related/synthetic-related/cover',status:'Ongoing',progress:{kind:'episode',number:3,raw:'3',updatedAt:'2027-01-02T00:00:00.000Z'},availability:{kind:'episode',number:5,raw:'5',provider:'synthetic-provider',verifiedAt:'2027-01-03T00:00:00.000Z'}}]});
    expect(result.relatedWorks?.[0]).toMatchObject({id:'synthetic-related',sequenceOrder:1,relationDepth:2,relationTypes:['SEQUENCE_MEMBER','SEQUEL'],status:'Ongoing',progress:{number:3},availability:{number:5}});
    expect(catalogDetailContract.safeParse({favorites:[],sources:[],relatedWorks:Array.from({length:51},(_,index)=>({id:`synthetic-${index}`,title:null,type:'ANIME',sequenceOrder:null,relationTypes:['OTHER'],coverUrl:null}))}).success).toBe(false);
  });
  it('keeps a navigated detail root-scoped while preserving the full bounded relation payload',()=>{
    const relatedWorks=Array.from({length:5},(_,index)=>({id:`synthetic-part-${index}`,title:`Synthetic part ${index}`,type:'ANIME',sequenceOrder:index,relationTypes:['SEQUENCE_MEMBER'],coverUrl:`/api/v1/library/synthetic-root/related/synthetic-part-${index}/cover`}));
    const result=catalogRelatedDetailContract.parse({rootMediaId:'synthetic-root',id:'synthetic-part-2',title:'Synthetic part 2',type:'ANIME',coverUrl:'/api/v1/library/synthetic-root/related/synthetic-part-2/cover',favorites:[],sources:[],relatedWorks});
    expect(result.relatedWorks).toHaveLength(5);
    expect(result.relatedWorks!.every(work=>work.coverUrl?.startsWith('/api/v1/library/synthetic-root/related/'))).toBe(true);
  });
});
