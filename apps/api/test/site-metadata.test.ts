import { describe, expect, it } from 'vitest';
import { manifestMetadata } from '../src/site-metadata.js';

describe('site manifest metadata',()=>{
  it('keeps the declared language and extracts an explicit region only',()=>{
    expect(manifestMetadata({lang:'fr-FR',dir:'ltr'},'https://site.invalid/manifest.json')).toEqual({language:'fr-FR',country:'FR',direction:'ltr',manifestUrl:'https://site.invalid/manifest.json'});
  });
  it('does not invent a country from a language without a region',()=>{
    expect(manifestMetadata({lang:'fr'},'https://site.invalid/manifest.json')).toMatchObject({language:'fr',country:null});
  });
});
