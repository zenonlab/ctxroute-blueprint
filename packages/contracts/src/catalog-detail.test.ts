import { describe, expect, it } from 'vitest';
import { catalogDetailContract, sourceReportContract } from './index.js';

describe('synthetic modal detail contract',()=>{
  it('preserves parsed/raw/provenance fields and source health independently',()=>{
    const result=catalogDetailContract.parse({favorites:[{bookmarkId:'synthetic-bookmark',url:'https://synthetic.invalid/raw',title:'raw marker',parsedTitle:'parsed marker',progression:{raw:'c.12'},device:'synthetic-device',parserId:'shared-parser',parserVersion:8,provenance:{source:'synthetic'}}],sources:[{mediaId:'synthetic-media',connector:'synthetic-source',canonicalUrl:'https://synthetic.invalid/work',status:'UNAVAILABLE',checkedAt:null,title:'parsed source',chapter:'12',domain:'synthetic.invalid',provenance:{source:'synthetic'}}]});
    expect(result.favorites[0].title).toBe('raw marker');
    expect(result.favorites[0].parsedTitle).toBe('parsed marker');
    expect(result.sources[0].status).toBe('UNAVAILABLE');
  });
  it('requires a canonical URL and bounded reason for reports',()=>{
    expect(sourceReportContract.safeParse({mediaId:'synthetic-media',canonicalUrl:'https://synthetic.invalid/work'}).success).toBe(true);
    expect(sourceReportContract.safeParse({mediaId:'other',canonicalUrl:'https://synthetic.invalid/work',reason:'INVALID'}).success).toBe(false);
  });
});
