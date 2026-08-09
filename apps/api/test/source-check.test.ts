import { describe, expect, it, vi } from 'vitest';
import { checkSourceUrl } from '../src/source-check.js';

const response=(status:number,url:string)=>Promise.resolve({status,url});

describe('source HTTP checks',()=>{
  it('maps 2xx to AVAILABLE without inspecting page content',async()=>{
    const request=vi.fn((url:string)=>response(200,url));
    await expect(checkSourceUrl('https://source.invalid/work',request)).resolves.toMatchObject({status:'AVAILABLE',httpStatus:200,finalUrl:'https://source.invalid/work',error:null});
  });
  it('preserves the final URL after a followed redirect',async()=>{
    const request=vi.fn((url:string)=>response(200,'https://final.invalid/work'));
    await expect(checkSourceUrl('https://source.invalid/work',request)).resolves.toMatchObject({status:'AVAILABLE',finalUrl:'https://final.invalid/work'});
  });
  it('maps a final 404 to MOVED',async()=>{
    await expect(checkSourceUrl('https://source.invalid/work',()=>response(404,'https://source.invalid/work'))).resolves.toMatchObject({status:'MOVED',httpStatus:404,error:null});
  });
  it('distinguishes timeout and DNS failures',async()=>{
    await expect(checkSourceUrl('https://source.invalid/timeout',()=>Promise.reject(new Error('UND_ERR_ABORTED timeout')))).resolves.toMatchObject({status:'UNAVAILABLE',error:'TIMEOUT'});
    await expect(checkSourceUrl('https://source.invalid/dns',()=>Promise.reject(new Error('getaddrinfo ENOTFOUND source.invalid')))).resolves.toMatchObject({status:'UNAVAILABLE',error:'DNS_UNAVAILABLE'});
  });
});
