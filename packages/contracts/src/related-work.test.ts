import { describe, expect, it } from 'vitest';
import { catalogDetailContract } from './index.js';

describe('synthetic related work contract',()=>{
  it('keeps relations bounded and separate from title identity',()=>{
    const result=catalogDetailContract.parse({favorites:[],sources:[],relatedWorks:[{id:'synthetic-related',title:'Related title',type:'ANIME',format:'TV',seasonYear:2027,sequenceOrder:1,relationTypes:['SEQUENCE_MEMBER','SEQUEL'],anilistId:'42',coverUrl:null}]});
    expect(result.relatedWorks?.[0]).toMatchObject({id:'synthetic-related',sequenceOrder:1,relationTypes:['SEQUENCE_MEMBER','SEQUEL']});
    expect(catalogDetailContract.safeParse({favorites:[],sources:[],relatedWorks:Array.from({length:51},(_,index)=>({id:`synthetic-${index}`,title:null,type:'ANIME',sequenceOrder:null,relationTypes:['OTHER'],coverUrl:null}))}).success).toBe(false);
  });
});
