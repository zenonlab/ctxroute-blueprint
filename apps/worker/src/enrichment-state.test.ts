import { describe,expect,it,vi } from 'vitest';
import { claimEnrichment,enrichmentFingerprint,normalizedError } from './enrichment-state.js';

describe('global enrichment state',()=>{
  it('has a stable fingerprint independent of object and alias order',()=>expect(enrichmentFingerprint({aliases:['B','A'],year:2024})).toBe(enrichmentFingerprint({year:2024,aliases:['A','B']})));
  it('normalizes retry-relevant errors without persisting private messages',()=>{expect(normalizedError(Object.assign(new Error('getaddrinfo ENOTFOUND private.example'),{code:'ENOTFOUND'}))).toBe('DNS_UNAVAILABLE');expect(normalizedError(new Error('IMAGE_HTTP_403'))).toBe('IMAGE_FORBIDDEN')});
  it('claims atomically and uses the configured attempt ceiling',async()=>{const query=vi.fn().mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{attempt_count:1,owner:'worker'}]});const result=await claimEnrichment({query} as any,{mediaId:'media',provider:'anilist',purpose:'metadata',version:'v2',fingerprint:'a'.repeat(64),maxAttempts:3,owner:'worker'});expect(result).toMatchObject({owner:'worker'});expect(query.mock.calls[1][1][6]).toBe(3)});
});
