import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { collectSnapshot } from './collect.js';

let server: Server;
let base = '';

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/plain/chapter-2') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html><head><title>Read Fixture Chapter 2</title></head><body>site markup without connector data attributes</body></html>');
      return;
    }
    if(request.url==='/plain/work'){
      response.writeHead(200,{'content-type':'text/html','content-language':'fr'});
      response.end('<html lang="fr"><head><title>Synthetic River Archive</title></head><body><main><h1>Synthetic River Archive</h1><p>Une page synthétique décrivant clairement une œuvre, sans lien de chapitre ni attribut propriétaire.</p></main></body></html>');
      return;
    }
    if(request.url==='/plain/french-theme'){
      response.writeHead(200,{'content-type':'text/html'});
      response.end('<html lang="en-US"><head><title>Synthetic River Archive</title><meta property="og:locale" content="en_US"></head><body><main><h1>Archive synthétique</h1><p>Cette page synthétique présente une œuvre traduite en français. Les lectrices et lecteurs peuvent y découvrir les chapitres récemment publiés, consulter une description complète et suivre les nouvelles parutions dans une langue naturelle et clairement identifiable.</p></main></body></html>');
      return;
    }
    if(request.url==='/plain/header-conflict'){
      response.writeHead(200,{'content-type':'text/html','content-language':'en'});
      response.end('<html><head><title>Synthetic River Archive</title></head><body><main><p>Cette page synthétique présente une œuvre traduite en français. Les lectrices et lecteurs peuvent y découvrir les chapitres récemment publiés, consulter une description complète et suivre les nouvelles parutions dans une langue naturelle et clairement identifiable.</p></main></body></html>');
      return;
    }
    response.writeHead(404);
    response.end();
  }).listen(0);
  await new Promise<void>(resolve => server.once('listening', () => {
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    resolve();
  }));
});

afterAll(() => server.close());

describe('source signal quarantine policy', () => {
  it('does not quarantine an accessible page only because its HTML lacks connector attributes', async () => {
    const snapshot = await collectSnapshot({ target: `${base}/plain/chapter-2`, mediaId: 'm1', connector: 'fixture', connectorVersion: '1', policy: { approvedDomains: ['127.0.0.1'], allowPrivateTest: true } });
    expect(snapshot.status).toBe('VALID');
    expect(snapshot.origins).toEqual(expect.arrayContaining([expect.objectContaining({mediaId:'m1',observationKind:'WORK'}),expect.objectContaining({ mediaId: 'm1',observationKind:'RELEASE', sequence:expect.objectContaining({ raw: '2' }) })]));
  });
  it('keeps a language-qualified work recommendation even when no release is structured',async()=>{
    const workUrl=`${base}/plain/work`;
    const snapshot=await collectSnapshot({target:workUrl,workUrl,rawTarget:`${workUrl}/chapter-12`,mediaId:'synthetic-media',connector:'fixture',connectorVersion:'3',policy:{approvedDomains:['127.0.0.1'],allowPrivateTest:true}});
    expect(snapshot.resolutionStatus).toBe('UNRESOLVED_CHAPTER');
    expect(snapshot.origins).toEqual([expect.objectContaining({observationKind:'WORK',workUrl,language:'fr',sequence:{kind:'special',raw:'work-source'}})]);
  });
  it('uses reliable visible French content over generic English theme metadata',async()=>{
    const workUrl=`${base}/plain/french-theme`;
    const snapshot=await collectSnapshot({target:workUrl,workUrl,mediaId:'synthetic-media',connector:'fixture',connectorVersion:'4',policy:{approvedDomains:['127.0.0.1'],allowPrivateTest:true}});
    expect(snapshot.origins[0]).toMatchObject({observationKind:'WORK',language:'fr',languageDetection:'statistical',languageEvidence:{declarations:[expect.objectContaining({method:'html-lang',language:'en-US'}),expect.objectContaining({method:'og:locale',language:'en-US'})],detectors:{francMin:expect.objectContaining({language:'fr'}),eld:expect.objectContaining({language:'fr'})}}});
  });
  it('does not qualify a recommendation when Content-Language conflicts with reliable content',async()=>{
    const workUrl=`${base}/plain/header-conflict`;
    const snapshot=await collectSnapshot({target:workUrl,workUrl,mediaId:'synthetic-media',connector:'fixture',connectorVersion:'4',policy:{approvedDomains:['127.0.0.1'],allowPrivateTest:true}});
    expect(snapshot.origins[0]).toMatchObject({observationKind:'WORK',language:null,languageDetection:'ambiguous',languageEvidence:{conflicts:[expect.objectContaining({kind:'strong-statistical'})]}});
  });
});
