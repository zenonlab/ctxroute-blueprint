import {describe,expect,it} from 'vitest';
import {catalogCardSummaryContract} from './index.js';

describe('CatalogCardSummary',()=>{
  const summary={id:'media-synthetic',title:'Synthetic title',type:'MANGA',format:'MANGA',status:'Ongoing',progress:null,availability:null,favoriteCount:1,classificationStatus:'classified',coverUrl:'/cover'};
  it('accepts only the lightweight card projection',()=>expect(catalogCardSummaryContract.parse(summary)).toEqual(summary));
  it.each(['favorites','sources','metadata','relations','relatedWorks','reporting','provenance'])("rejects detailed field %s",field=>{
    expect(()=>catalogCardSummaryContract.parse({...summary,[field]:[]})).toThrow();
  });
});
