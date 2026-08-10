import { describe, expect, it } from 'vitest';
import { catalogDetailContract, catalogInventoryPageContract, catalogLibraryPageContract, sourceReportContract } from './index.js';

describe('synthetic modal detail contract',()=>{
  it('preserves parsed/raw/provenance fields and source health independently',()=>{
    const result=catalogDetailContract.parse({favorites:[{bookmarkId:'synthetic-bookmark',url:'https://synthetic.invalid/raw',title:'raw marker',parsedTitle:'parsed marker',progression:{raw:'c.12'},device:'synthetic-device',parserId:'shared-parser',parserVersion:8,provenance:{source:'synthetic'}}],sources:[{mediaId:'synthetic-media',connector:'synthetic-source',canonicalUrl:'https://synthetic.invalid/work',status:'UNAVAILABLE',checkedAt:null,title:'parsed source',chapter:'12',domain:'synthetic.invalid',provenance:{source:'synthetic'}}]});
    expect(result.favorites[0].title).toBe('raw marker');
    expect(result.favorites[0].parsedTitle).toBe('parsed marker');
    expect(result.sources[0].status).toBe('UNAVAILABLE');
    expect(result.sources[0].language).toBeUndefined();
  });
  it('accepts an optional canonical work URL without removing legacy source fields',()=>{
    const source=catalogDetailContract.parse({favorites:[],sources:[{mediaId:'synthetic-media',connector:'synthetic-connector',canonicalUrl:'https://synthetic.invalid/release/12',workUrl:'https://synthetic.invalid/work',status:'AVAILABLE',checkedAt:'2026-08-10T00:00:00.000Z',title:null,chapter:null,domain:'synthetic.invalid',language:'fr',provenance:{rawUrl:'https://synthetic.invalid/release/12'}}]}).sources[0];
    expect(source).toMatchObject({canonicalUrl:'https://synthetic.invalid/release/12',workUrl:'https://synthetic.invalid/work'});
  });
  it('requires a canonical URL and bounded reason for reports',()=>{
    expect(sourceReportContract.safeParse({mediaId:'synthetic-media',canonicalUrl:'https://synthetic.invalid/work'}).success).toBe(true);
    expect(sourceReportContract.safeParse({mediaId:'other',canonicalUrl:'https://synthetic.invalid/work',reason:'INVALID'}).success).toBe(false);
  });
  it('keeps raw inventory and recommendations independent from media identity',()=>{
    const page=catalogInventoryPageContract.parse({items:[{installationId:'synthetic-installation',bookmarkId:'synthetic-bookmark',rawTitle:'raw title',rawUrl:'https://reader.synthetic.invalid/a',parsedTitle:null,classificationStatus:'review',linkStatus:'review',mediaId:null,recommendations:[{canonicalUrl:'https://reader.synthetic.invalid/a',domain:'reader.synthetic.invalid',language:'fr',status:'AVAILABLE',checkedAt:null,provenance:{source:'bookmark-import',rawUrl:'https://reader.synthetic.invalid/a'}}]}],total:1,nextOffset:1,hasMore:false});
    expect(page.items[0].mediaId).toBeNull();
    expect(page.items[0].recommendations[0].language).toBe('fr');
  });
  it('keeps personal progress, provider availability and normalized status distinct on library cards',()=>{
    const page=catalogLibraryPageContract.parse({items:[{id:'synthetic-media',type:'MANGA',authors:[],studios:[],episodeTotal:null,status:'Completed',progress:{kind:'chapter',number:54,raw:'54',updatedAt:'2026-08-09T00:00:00Z'},availability:{kind:'chapter',number:143,raw:'143',provider:'mangaupdates',provenance:{source:'synthetic-provider-record'}}}],total:1,nextOffset:1,hasMore:false});
    expect(page.items[0]).toMatchObject({status:'Completed',progress:{number:54,raw:'54'},availability:{number:143,raw:'143'}});
  });
});
