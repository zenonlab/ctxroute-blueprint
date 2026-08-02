import { describe, expect, it } from 'vitest';
import { domainMatches } from './core.js';
import { emptyState } from './storage.js';
import { mediaSites, siteFromUrl } from './sites.js';
import { proposeFavoriteUpdate } from './updates.js';

describe('Wave 3 sites and opt-in updates',()=>{
  it('validates and derives approved sites only from media URLs',()=>{expect(siteFromUrl('https://WWW.example.test/watch/1','bookmark')?.domain).toBe('example.test');expect(siteFromUrl('javascript:alert(1)')).toBeNull();expect(mediaSites([{id:'1',parentId:null,title:'Anime 1',url:'https://example.test/watch/1',dateAdded:null,dateGroupModified:null},{id:'2',parentId:null,title:'Docs',url:'https://other.test/docs',dateAdded:null,dateGroupModified:null}])).toHaveLength(1);expect(domainMatches('video.example.test','example.test')).toBe(true);expect(domainMatches('example.test.evil.test','example.test')).toBe(false)});
  it('keeps automatic favorite updates opt-in and reversible',()=>{const state=emptyState();const current={id:'1',url:'https://example.test/1',title:'Episode 1'};expect(proposeFavoriteUpdate(current,{url:'https://example.test/2',title:'Episode 2',confidence:'clear'},state)).toBeNull();const enabled={...state,autoUpdateFavorites:true};expect(proposeFavoriteUpdate(current,{url:'https://example.test/2',title:'Episode 2',confidence:'ambiguous'},enabled)).toBeNull();expect(proposeFavoriteUpdate(current,{url:'https://example.test/2',title:'Episode 2',confidence:'clear'},enabled)).toMatchObject({oldUrl:current.url,newUrl:'https://example.test/2'});});
});
