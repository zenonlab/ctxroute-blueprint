import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { digest, hashPassword } from '@favlib/auth';
import { OPERATIONAL_DEFAULTS } from '@favlib/config';
import { isolatedTestDatabaseUrl } from '@favlib/config';
import { app as rawApp } from '../src/server.js';

const app={inject:(options:any)=>rawApp.inject({...options,headers:{...((options.url==='/api/v1/auth/login'||options.url==='/api/v1/auth/register')?{origin:'https://favlib.home.arpa'}:{}),...options.headers}})};

const enabled=Boolean(process.env.TEST_DATABASE_URL);
if(process.env.DATABASE_URL&&!process.env.TEST_DATABASE_URL)throw new Error('TEST_DATABASE_URL is required; refusing DATABASE_URL integration tests');
const testDatabaseUrl=enabled?isolatedTestDatabaseUrl():undefined;
const suite=describe.skipIf(!enabled);
const pool=enabled?new Pool({connectionString:testDatabaseUrl}):null;
const alice=randomUUID();
const bob=randomUUID();

beforeAll(async()=>{if(pool)await pool.query('DELETE FROM security_rate_limit')});

suite('Wave 4 PostgreSQL ownership isolation',()=>{
  it('prefers a synthetic Latin transliteration over a non-Latin provider title',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const mediaId=`display-transliteration-${randomUUID()}`;
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')",[mediaId]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,connector,confidence,provenance) VALUES ($1,'Синтетическое название','синтетическое название','ru','Cyrl','native','native','anilist',1,'{}'),($1,'Sinteticheskoe Nazvanie','sinteticheskoe nazvanie','und','Latn','romaji','romaji','anilist',1,'{}')",[mediaId]);
    const result=await pool.query('SELECT favlib_display_title($1,NULL) AS selection',[mediaId]);
    expect(result.rows[0].selection).toMatchObject({title:'Sinteticheskoe Nazvanie',reason:'ROMAJI_FALLBACK'});
    await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('prefers a synthetic English provider title over another Latin language',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const mediaId=`display-english-${randomUUID()}`;
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')",[mediaId]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,connector,confidence,provenance) VALUES ($1,'Synthetischer Titel','synthetischer titel','de','Latn','official','canonical','anilist',1,'{}'),($1,'Synthetic English Title','synthetic english title','en','Latn','translation','english','anilist',1,'{}')",[mediaId]);
    const result=await pool.query('SELECT favlib_display_title($1,NULL) AS selection',[mediaId]);
    expect(result.rows[0].selection).toMatchObject({title:'Synthetic English Title',reason:'ENGLISH_FALLBACK'});
    await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('projects the provider canonical title before parser and personal aliases',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const mediaId=`display-title-${randomUUID()}`, mangaId=`display-title-manga-${randomUUID()}`, aliceAlias=randomUUID(), bobAlias=randomUUID();
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA'),($2,'MANGA')",[mediaId,mangaId]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,kind,title_type,connector,confidence,provenance) VALUES\n      ($1,'Mercenary Enrollment Adnfbn 038','mercenary enrollment adnfbn 038','source','official','source-url',.98,$2),\n      ($1,'Provider Canonical Title','provider canonical title','official','canonical','anilist',1,'{}'),\n      ($1,'Mercenary Enrollment','mercenary enrollment','personal','favorite','chrome-bookmark:alice',1,$3),\n      ($1,'The Savior Personal Alias','the savior personal alias','personal','favorite','chrome-bookmark:bob',1,$4)",[mediaId,{source:'parser'},{userId:aliceAlias},{userId:bobAlias}]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,kind,title_type,connector,confidence,provenance) VALUES($1,'Manga Pf992814','manga pf992814','source','official','source-url',.98,'{}'),($1,'The Savior Of The Lost Alias','the savior of the lost alias','personal','favorite','chrome-bookmark:alice',1,$2)",[mangaId,{userId:aliceAlias}]);
    const alice=await pool.query('SELECT favlib_display_title($1,$2) AS selection',[mediaId,aliceAlias]);
    const bob=await pool.query('SELECT favlib_display_title($1,$2) AS selection',[mediaId,bobAlias]);
    const nobody=await pool.query('SELECT favlib_display_title($1,$2) AS selection',[mediaId,randomUUID()]);
    const manga=await pool.query('SELECT favlib_display_title($1,$2) AS selection',[mangaId,aliceAlias]);
    expect(alice.rows[0].selection).toMatchObject({title:'Provider Canonical Title',referenceTitle:'Mercenary Enrollment Adnfbn 038',reason:'PROVIDER_CANONICAL'});
    expect(bob.rows[0].selection).toMatchObject({title:'Provider Canonical Title',reason:'PROVIDER_CANONICAL'});
    expect(nobody.rows[0].selection).toMatchObject({title:'Provider Canonical Title',reason:'PROVIDER_CANONICAL'});
    expect(manga.rows[0].selection).toMatchObject({title:'Manga Pf992814',reason:'SOURCE_CLEAN'});
    expect([alice.rows[0].selection.title,bob.rows[0].selection.title,manga.rows[0].selection.title]).not.toContain('Mercenary Enrollment');
    const aliases=await pool.query("SELECT text FROM media_title WHERE media_id=$1 AND normalized_text IN ('provider canonical title','mercenary enrollment','the savior personal alias') ORDER BY text",[mediaId]);
    expect(aliases.rows.map(row=>row.text)).toEqual(['Mercenary Enrollment','Provider Canonical Title','The Savior Personal Alias']);
    await pool.query('DELETE FROM media WHERE id IN ($1,$2)',[mediaId,mangaId]);
  });

  it('requires the Web origin and keeps private read routes authenticated',async()=>{const missing=await rawApp.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'nobody@example.test',password:'invalid'}});expect(missing.statusCode).toBe(403);expect(missing.json().error.code).toBe('ORIGIN_MISMATCH');for(const url of ['/api/v1/releases','/api/v1/calendar','/api/v1/openapi.json','/api/v1/catalog/media/unknown/cover'])expect((await rawApp.inject({method:'GET',url})).statusCode,url).toBe(401);expect((await rawApp.inject({method:'GET',url:'/api/v1/health'})).statusCode).toBe(200)});
  it('does not expose Alice classification rows to Bob',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    await pool.query('INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,$4),($5,$6,$3,$4)',[alice,`wave4-alice-${alice}@example.test`,'synthetic-hash','member',bob,`wave4-bob-${bob}@example.test`]);
    await pool.query("INSERT INTO classification_run(user_id,classifier_version,input_fingerprint,status,matches) VALUES($1,'wave4-test','wave4-isolation','review','[]')",[alice]);
    const aliceRows=await pool.query('SELECT id FROM classification_run WHERE user_id=$1',[alice]);
    const bobRows=await pool.query('SELECT id FROM classification_run WHERE user_id=$1',[bob]);
    expect(aliceRows.rowCount).toBe(1);expect(bobRows.rowCount).toBe(0);
  });
  it('keeps progression personal even when Alice and Bob share a media id',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const mediaId=`wave7-isolation-${randomUUID()}`;
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);
    const observation=await pool.query("INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,confidence,consented,observed_at) VALUES($1,$2,'fixture','chapter',12,'12','high',true,now()) RETURNING id",[alice,mediaId]);
    await pool.query("INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id) VALUES($1,$2,'chapter',12,'12',$3)",[alice,mediaId,observation.rows[0].id]);
    const aliceRows=await pool.query('SELECT position_raw FROM favorite_progress WHERE user_id=$1 AND media_id=$2',[alice,mediaId]);
    const bobRows=await pool.query('SELECT position_raw FROM favorite_progress WHERE user_id=$1 AND media_id=$2',[bob,mediaId]);
    expect(aliceRows.rows[0].position_raw).toBe('12');expect(bobRows.rowCount).toBe(0);
    await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('accepts a consented device observation and rejects a regression',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const mediaId=`wave7-http-${randomUUID()}`, installationId=`wave7-install-${randomUUID()}`, token=`wave7-token-${randomUUID()}`;
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'test','test',1) RETURNING id",[alice,installationId,digest(token)]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'bookmark-7',$3,'matched','test','{}')",[alice,installationId,mediaId]);
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
    const advanced=await app.inject({method:'POST',url:'/api/v1/extension/progression',headers,payload:{bookmarkId:'bookmark-7',url:'https://source.test/episode/11',title:'Episode 11',position:'11',kind:'episode',confidence:'high',consented:true}});
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'bookmark-8',$3,'matched','test','{}')",[alice,installationId,mediaId]);
    const consolidated=await app.inject({method:'POST',url:'/api/v1/extension/progression',headers,payload:{bookmarkId:'bookmark-8',url:'https://source.test/episode/12',title:'Episode 12',position:'12',kind:'episode',confidence:'high',consented:true}});
    const regressed=await app.inject({method:'POST',url:'/api/v1/extension/progression',headers,payload:{bookmarkId:'bookmark-7',url:'https://source.test/episode/10',title:'Episode 10',position:'10',kind:'episode',confidence:'high',consented:true}});
    const status=await app.inject({method:'GET',url:'/api/v1/extension/progression?bookmarkId=bookmark-7',headers:{authorization:`Bearer ${token}`}});
    const rows=await pool.query('SELECT COUNT(*)::int AS count,MAX(position_number) AS position FROM favorite_progress WHERE user_id=$1 AND media_id=$2',[alice,mediaId]);
    expect(advanced.statusCode).toBe(201);expect(consolidated.statusCode).toBe(201);expect(regressed.statusCode).toBe(409);expect(status.statusCode).toBe(200);expect(status.json().progress.raw).toBe('12');expect(rows.rows[0]).toMatchObject({count:1,position:'12'});
    await pool.query('DELETE FROM extension_device WHERE id=$1',[device.rows[0].id]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('confirms a real pairing challenge through an authenticated web session',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),installationId=`wave10-pair-${randomUUID()}`,email=`wave10-pair-${userId}@example.test`,password='Wave10-Pairing-Password!';
    await pool.query('INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,\'member\')',[userId,email,await hashPassword(password)]);
    const challenge=await app.inject({method:'POST',url:'/api/v1/extension/pairing/challenges',payload:{installationId,protocol:1}});
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});const cookie=String(login.headers['set-cookie']).split(';')[0],csrf=login.json().csrfToken;
    const confirmed=await app.inject({method:'POST',url:`/api/v1/extension/pairing/challenges/${challenge.json().challengeId}/confirm`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{code:challenge.json().code,browser:'test',name:'Wave 10'}});
    const activated=await app.inject({method:'GET',url:`/api/v1/extension/pairing/challenges/${challenge.json().challengeId}`});
    expect(challenge.statusCode).toBe(201);expect(confirmed.statusCode).toBe(200);expect(activated.json().status).toBe('activated');expect(activated.json().deviceToken).toBeTruthy();
    await pool.query('DELETE FROM app_user WHERE id=$1',[userId]);
  });

  it('enforces pairing CSRF, durable attempts, replay isolation, expiry and revocation',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const aliceId=randomUUID(),bobId=randomUUID(),password='Wave10-Pairing-Security!';
    const aliceEmail=`pairing-alice-${aliceId}@example.test`,bobEmail=`pairing-bob-${bobId}@example.test`;
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$5,'member'),($3,$4,$5,'member')",[aliceId,aliceEmail,bobId,bobEmail,await hashPassword(password)]);
    const aliceLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:aliceEmail,password}});
    const bobLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:bobEmail,password}});
    const aliceCookie=String(aliceLogin.headers['set-cookie']).split(';')[0],aliceCsrf=aliceLogin.json().csrfToken;
    const bobCookie=String(bobLogin.headers['set-cookie']).split(';')[0],bobCsrf=bobLogin.json().csrfToken;
    const webHeaders=(cookie:string,csrf:string)=>({cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf});

    const limited=await app.inject({method:'POST',url:'/api/v1/extension/pairing/challenges',payload:{installationId:`limited-${randomUUID()}`,protocol:1}});
    const limitedUrl=`/api/v1/extension/pairing/challenges/${limited.json().challengeId}/confirm`;
    const noCsrf=await app.inject({method:'POST',url:limitedUrl,headers:{cookie:aliceCookie,origin:'https://favlib.home.arpa'},payload:{code:limited.json().code}});
    expect(noCsrf.statusCode).toBe(403);expect(noCsrf.json().error.code).toBe('CSRF_FAILED');
    const wrongCode=limited.json().code==='00000000'?'00000001':'00000000';
    for(let attempt=1;attempt<=5;attempt+=1){
      const invalid=await app.inject({method:'POST',url:limitedUrl,headers:webHeaders(aliceCookie,aliceCsrf),payload:{code:wrongCode}});
      expect(invalid.statusCode).toBe(attempt===5?429:400);
    }
    const attempts=await pool.query('SELECT attempts FROM pairing_challenge WHERE id=$1',[limited.json().challengeId]);expect(attempts.rows[0].attempts).toBe(5);

    const installationId=`secure-${randomUUID()}`;
    const challenge=await app.inject({method:'POST',url:'/api/v1/extension/pairing/challenges',payload:{installationId,protocol:1}});
    const confirmUrl=`/api/v1/extension/pairing/challenges/${challenge.json().challengeId}/confirm`,payload={code:challenge.json().code,browser:'test',name:'Security test'};
    const confirmed=await app.inject({method:'POST',url:confirmUrl,headers:webHeaders(aliceCookie,aliceCsrf),payload});
    const replay=await app.inject({method:'POST',url:confirmUrl,headers:webHeaders(aliceCookie,aliceCsrf),payload});
    const crossAccount=await app.inject({method:'POST',url:confirmUrl,headers:webHeaders(bobCookie,bobCsrf),payload});
    expect(confirmed.statusCode).toBe(200);expect(replay.json()).toMatchObject({ok:true,idempotent:true});expect(crossAccount.statusCode).toBe(409);expect(crossAccount.json().error.code).toBe('PAIRING_CODE_REUSED');

    const activated=await app.inject({method:'GET',url:`/api/v1/extension/pairing/challenges/${challenge.json().challengeId}`});
    const device=await pool.query('SELECT id FROM extension_device WHERE user_id=$1 AND installation_id=$2',[aliceId,installationId]);
    const crossRevoke=await app.inject({method:'POST',url:`/api/v1/extension/devices/${device.rows[0].id}/revoke`,headers:webHeaders(bobCookie,bobCsrf),payload:{}});
    const revoke=await app.inject({method:'POST',url:`/api/v1/extension/devices/${device.rows[0].id}/revoke`,headers:webHeaders(aliceCookie,aliceCsrf),payload:{}});
    const revokedDiagnostic=await app.inject({method:'GET',url:'/api/v1/extension/diagnostic',headers:{authorization:`Bearer ${activated.json().deviceToken}`}});
    expect(crossRevoke.statusCode).toBe(404);expect(revoke.statusCode).toBe(200);expect(revokedDiagnostic.statusCode).toBe(401);expect(revokedDiagnostic.json().error.code).toBe('DEVICE_REVOKED');

    const expired=await app.inject({method:'POST',url:'/api/v1/extension/pairing/challenges',payload:{installationId:`expired-${randomUUID()}`,protocol:1}});
    await pool.query("UPDATE pairing_challenge SET expires_at=now()-interval '1 minute' WHERE id=$1",[expired.json().challengeId]);
    const expiredConfirm=await app.inject({method:'POST',url:`/api/v1/extension/pairing/challenges/${expired.json().challengeId}/confirm`,headers:webHeaders(aliceCookie,aliceCsrf),payload:{code:expired.json().code}});
    const unsupported=await app.inject({method:'POST',url:'/api/v1/extension/pairing/challenges',payload:{installationId:`protocol-${randomUUID()}`,protocol:0}});
    expect(expiredConfirm.statusCode).toBe(410);expect(expiredConfirm.json().error.code).toBe('PAIRING_EXPIRED');expect(unsupported.statusCode).toBe(426);

    await pool.query('DELETE FROM pairing_challenge WHERE id IN ($1,$2,$3)',[limited.json().challengeId,challenge.json().challengeId,expired.json().challengeId]);
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[aliceId,bobId]);
  });

  it('links an imported series from its URL without trusting the bookmark label',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const installationId=`wave10-import-${randomUUID()}`,token=`wave10-token-${randomUUID()}`;
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'test','test',1) RETURNING id",[alice,installationId,digest(token)]);
    const response=await app.inject({method:'POST',url:'/api/v1/extension/import-batches',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},payload:{batchId:randomUUID(),installationId,protocol:1,cursor:null,items:[
      {id:'wave10-bookmark',parentId:null,title:'Mon nom personnel',url:'https://anime-sama.fr/catalogue/one-piece/saison1/episode12',dateAdded:null,dateGroupModified:null,fingerprint:'b'.repeat(64),event:'created'},
      {id:'wave10-youtube',parentId:null,title:'One Piece',url:'https://www.youtube.com/watch?v=not-a-series',dateAdded:null,dateGroupModified:null,fingerprint:'c'.repeat(64),event:'created'},
      {id:'wave10-generic',parentId:null,title:'Titre personnel différent',url:'https://unknown-reader.example/series/solo-leveling/chapter/42',dateAdded:null,dateGroupModified:null,fingerprint:'d'.repeat(64),event:'created'},
      {id:'wave10-duplicate-a',parentId:null,title:'Saved',url:'https://unknown.example/opaque/item',dateAdded:null,dateGroupModified:null,fingerprint:'e'.repeat(64),event:'created'},
      {id:'wave10-duplicate-b',parentId:null,title:'Saved',url:'https://unknown.example/opaque/item',dateAdded:null,dateGroupModified:null,fingerprint:'e'.repeat(64),event:'created'},
    ]}});
    const link=await pool.query('SELECT media_id AS "mediaId",status FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3',[alice,installationId,'wave10-bookmark']);
    const ignored=await pool.query('SELECT 1 FROM bookmark_media_link WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3',[alice,installationId,'wave10-youtube']);
    const title=await pool.query('SELECT text,connector FROM media_title WHERE media_id=$1',[link.rows[0].mediaId]);
    const decisions=await pool.query('SELECT bookmark_id,classification_status,classification_reason FROM bookmark_import_item WHERE user_id=$1 AND installation_id=$2 ORDER BY bookmark_id',[alice,installationId]);
    const diagnostic=await app.inject({method:'GET',url:'/api/v1/extension/diagnostic',headers:{authorization:`Bearer ${token}`}});
    const expectedDigest=createHash('sha256').update([
      ['wave10-bookmark','b'],['wave10-duplicate-a','e'],['wave10-duplicate-b','e'],['wave10-generic','d'],['wave10-youtube','c'],
    ].map(([id,fingerprint])=>`${id}\0${fingerprint.repeat(64)}\n`).join('')).digest('hex');
    const divergent=await app.inject({method:'POST',url:'/api/v1/extension/reconcile',headers:{authorization:`Bearer ${token}`},payload:{inventoryTotal:5,inventoryDigest:'0'.repeat(64)}});
    const verified=await app.inject({method:'POST',url:'/api/v1/extension/reconcile',headers:{authorization:`Bearer ${token}`},payload:{inventoryTotal:5,inventoryDigest:expectedDigest}});
    expect(response.statusCode).toBe(200);expect(link.rows[0]).toMatchObject({mediaId:`source:${digest('anime-sama.fr:one-piece').slice(0,40)}`,status:'matched'});
    expect(title.rows).toContainEqual({text:'One Piece',connector:'source-url'});expect(ignored.rowCount).toBe(0);
    expect(decisions.rowCount).toBe(5);expect(decisions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({bookmark_id:'wave10-generic',classification_status:'recognized',classification_reason:'URL_IDENTITY_ADAPTER'}),
      expect.objectContaining({bookmark_id:'wave10-youtube',classification_status:'review',classification_reason:'URL_IDENTITY_MISSING'}),
      expect.objectContaining({bookmark_id:'wave10-duplicate-a',classification_status:'review'}),
      expect.objectContaining({bookmark_id:'wave10-duplicate-b',classification_status:'review'}),
    ]));
    expect(diagnostic.json()).toMatchObject({inventoryTotal:5,inventoryDigest:expectedDigest,recognizedCount:2,reviewCount:3,excludedCount:0});expect(divergent.statusCode).toBe(409);expect(verified.json()).toMatchObject({verified:true,inventoryDigest:expectedDigest});expect(verified.json().verifiedSyncAt).toBeTruthy();
    await pool.query('DELETE FROM extension_device WHERE id=$1',[device.rows[0].id]);
  });

  it('acknowledges identical imports and page metadata without reclassification or enqueue inputs',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');const installationId=`idempotent-${randomUUID()}`,token=`idempotent-token-${randomUUID()}`,bookmarkId='idempotent-bookmark';const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'idempotent','Chrome',1) RETURNING id",[alice,installationId,digest(token)]);const item={id:bookmarkId,parentId:null,title:'Libellé personnel',url:'https://anime-sama.fr/catalogue/idempotent-work/saison1/episode1',dateAdded:null,dateGroupModified:null,fingerprint:'f'.repeat(64),event:'created'};const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};const first=await app.inject({method:'POST',url:'/api/v1/extension/import-batches',headers,payload:{batchId:randomUUID(),installationId,protocol:1,cursor:null,items:[item]}});const before=await pool.query('SELECT id,created_at,classification_status,classification_reason FROM bookmark_import_item WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3',[alice,installationId,bookmarkId]);const second=await app.inject({method:'POST',url:'/api/v1/extension/import-batches',headers,payload:{batchId:randomUUID(),installationId,protocol:1,cursor:null,items:[item]}});const after=await pool.query('SELECT id,created_at,classification_status,classification_reason FROM bookmark_import_item WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3',[alice,installationId,bookmarkId]);expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);expect(after.rows[0]).toEqual(before.rows[0]);const metadata={pageUrl:item.url,canonicalUrl:'https://anime-sama.fr/catalogue/idempotent-work',title:'Idempotent Work',image:'https://anime-sama.fr/images/idempotent.jpg',confidence:.96};const metadataFirst=await app.inject({method:'POST',url:'/api/v1/extension/page-metadata',headers,payload:metadata}),metadataSecond=await app.inject({method:'POST',url:'/api/v1/extension/page-metadata',headers,payload:metadata});const receipts=await pool.query('SELECT count(*)::int AS count FROM extension_metadata_receipt WHERE device_id=$1',[device.rows[0].id]);expect(metadataFirst.json()).toMatchObject({accepted:true,unchanged:false});expect(metadataSecond.json()).toMatchObject({accepted:true,unchanged:true});expect(receipts.rows[0].count).toBe(1);await pool.query('DELETE FROM extension_device WHERE id=$1',[device.rows[0].id]);
  });

  it('reports reading favorites without an active cover',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const installationId=`missing-cover-${randomUUID()}`,token=`missing-cover-token-${randomUUID()}`,mediaId=`xiu-xian-${randomUUID()}`;
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'missing-cover','test',1) RETURNING id",[alice,installationId,digest(token)]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANHUA')",[mediaId]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,kind,title_type,connector,confidence,provenance) VALUES($1,'Xiu Xian Gui Lai Zai Xiao Yuan','xiu xian gui lai zai xiao yuan','source','official','fixture',1,'{}')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,$3,$4,'matched','test','{}')",[alice,installationId,'xiu-xian-bookmark',mediaId]);
    const response=await app.inject({method:'GET',url:'/api/v1/extension/diagnostic',headers:{authorization:`Bearer ${token}`}});
    expect(response.statusCode).toBe(200);
    expect(response.json().debug.withoutCover).toEqual(expect.arrayContaining([expect.objectContaining({mediaId,type:'MANHUA'})]));
    expect(response.json().debug.withoutCover.length).toBeGreaterThanOrEqual(1);
    const report=await app.inject({method:'GET',url:'/api/v1/extension/diagnostic/covers-missing',headers:{authorization:`Bearer ${token}`} });
    expect(report.statusCode).toBe(200);expect(report.json()).toMatchObject({count:expect.any(Number),items:expect.arrayContaining([expect.objectContaining({mediaId,type:'MANHUA',titles:expect.stringContaining('Xiu Xian Gui Lai Zai Xiao Yuan')})])});
    await pool.query('DELETE FROM extension_device WHERE id=$1',[device.rows[0].id]);
    await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });

  it('removes the last active favorite and stale-ifies its availability origins',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),installationId=`wave3-remove-${randomUUID()}`,token=`wave3-remove-token-${randomUUID()}`,mediaId=`wave6-remove-${randomUUID()}`;
    const device=await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,'synthetic','member') RETURNING id",[userId,`wave3-remove-${userId}@example.test`]);
    await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'test','test',1)",[userId,installationId,digest(token)]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'remove-bookmark',$3,'matched','test','{}')",[userId,installationId,mediaId]);
    await pool.query("INSERT INTO release_origin(user_id,scope_key,media_id,release_key,connector,canonical_url,status,checked_at,provenance) VALUES($1,'remove-scope',$2,$3,'fixture','https://source.test/3','AVAILABLE',now(),'{}')",[userId,mediaId,`${mediaId}|main|integer|3|default`]);
    const response=await app.inject({method:'POST',url:'/api/v1/extension/import-batches',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},payload:{batchId:randomUUID(),installationId,protocol:1,cursor:null,items:[{id:'remove-bookmark',parentId:null,title:'Episode 3',url:'https://source.test/episode/3',dateAdded:null,dateGroupModified:null,fingerprint:'a'.repeat(64),event:'removed'}]}});
    const link=await pool.query('SELECT status FROM bookmark_media_link WHERE user_id=$1 AND bookmark_id=$2',[userId,'remove-bookmark']);
    const origin=await pool.query('SELECT status FROM release_origin WHERE user_id=$1 AND media_id=$2',[userId,mediaId]);
    expect(response.statusCode).toBe(200);expect(link.rows[0].status).toBe('removed');expect(origin.rows[0].status).toBe('STALE');
    await pool.query('DELETE FROM app_user WHERE id=$1',[device.rows[0].id]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('serves only calendar events for media favorited by the current account',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(), otherId=randomUUID(), mediaId=`wave6-calendar-${randomUUID()}`;
    const email=`wave6-calendar-${userId}@example.test`, otherEmail=`wave6-calendar-${otherId}@example.test`;
    const passwordHash=await hashPassword('Wave6-Calendar-Password!');
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$5,'member'),($3,$4,$5,'member')",[userId,email,otherId,otherEmail,passwordHash]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'calendar-bookmark',$3,'matched','test','{}'),($4,$2,'other-calendar-bookmark',$3,'matched','test','{}')",[userId,`calendar-install-${userId}`,mediaId,otherId]);
    await pool.query("INSERT INTO media_airing(media_id,provider,episode,airing_at_utc,precision,schedule_status,last_verified_at,provenance) VALUES($1,'anilist',12,now()+interval '1 day','exact','SCHEDULED',now(),'{}'),($1,'anilist',13,now()+interval '8 days','exact','SCHEDULED',now(),'{}')",[mediaId]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Wave6-Calendar-Password!'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0];
    const response=await app.inject({method:'GET',url:'/api/v1/calendar',headers:{cookie}});
    const items=response.json().items;
    expect(response.statusCode).toBe(200);expect(items).toHaveLength(2);
    expect(items.every((item:any)=>item.mediaId===mediaId&&item.provider==='anilist')).toBe(true);
    const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:otherEmail,password:'Wave6-Calendar-Password!'}});
    const otherCookie=String(otherLogin.headers['set-cookie']).split(';')[0];
    const other=await app.inject({method:'GET',url:'/api/v1/calendar',headers:{cookie:otherCookie}});
    expect(other.json().items).toHaveLength(2); // same shared catalogue events because this account also favorites the media
    expect(other.json().items.every((item:any)=>!('selectedOrigin' in item))).toBe(true);
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[userId,otherId]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('accepts announcements only for an authorized provider policy',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const adminId=randomUUID(),mediaId=`wave6-announcement-${randomUUID()}`,provider='mangaupdates';
    const email=`${provider}@example.test`,password='Wave6-Announcement-Password!';
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,'admin')",[adminId,email,await hashPassword(password)]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});const cookie=String(login.headers['set-cookie']).split(';')[0],csrf=login.json().csrfToken,headers={cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf};
    const payload={provider,announcements:[{mediaId,releaseKey:`${mediaId}|main|integer|1|default`,status:'SCHEDULED',announcedAt:'2026-08-02T00:00:00.000Z',provenance:{fixture:true}}]};
    await pool.query("UPDATE catalog_provider_policy SET status='DISABLED' WHERE provider=$1",[provider]);
    const denied=await app.inject({method:'POST',url:'/api/v1/admin/announcements',headers,payload});expect(denied.statusCode).toBe(403);
    await pool.query("UPDATE catalog_provider_policy SET status='AUTHORIZED' WHERE provider=$1",[provider]);
    const accepted=await app.inject({method:'POST',url:'/api/v1/admin/announcements',headers,payload});const row=await pool.query('SELECT status FROM release_announcement WHERE provider=$1',[provider]);
    expect(accepted.statusCode).toBe(202);expect(row.rows[0].status).toBe('SCHEDULED');
    await pool.query('DELETE FROM app_user WHERE id=$1',[adminId]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('hides removed-link reviews from the current queue while retaining scoped audit history',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),otherId=randomUUID(),mediaId=`review-visibility-${randomUUID()}`,password='Review-Visibility-Password!';
    const email=`review-visible-${userId}@example.test`,otherEmail=`review-other-${otherId}@example.test`,passwordHash=await hashPassword(password);
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$5,'member'),($3,$4,$5,'member')",[userId,email,otherId,otherEmail,passwordHash]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'current-installation','current-bookmark',$3,'review','synthetic','{}'),($1,'obsolete-installation','obsolete-bookmark',$3,'removed','synthetic','{}'),($2,'other-installation','other-bookmark',$3,'review','synthetic','{}')",[userId,otherId,mediaId]);
    const reviews=await pool.query("INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason) VALUES($1,'current-installation','current-bookmark','Synthetic Current Work','https://reader.invalid/current','mangaupdates','PENDING','LOW_CONFIDENCE'),($1,'obsolete-installation','obsolete-bookmark','Synthetic Archived Work','https://reader.invalid/archived','mangaupdates','PENDING','LOW_CONFIDENCE'),($2,'other-installation','other-bookmark','Synthetic Other Work','https://reader.invalid/other','mangaupdates','PENDING','LOW_CONFIDENCE') RETURNING id,bookmark_id",[userId,otherId]);
    const archivedId=reviews.rows.find(row=>row.bookmark_id==='obsolete-bookmark').id;
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:otherEmail,password}}),otherCookie=String(otherLogin.headers['set-cookie']).split(';')[0];
    const queue=await app.inject({method:'GET',url:'/api/v1/reviews',headers:{cookie}});
    const history=await app.inject({method:'GET',url:`/api/v1/reviews/${archivedId}`,headers:{cookie}});
    const isolated=await app.inject({method:'GET',url:`/api/v1/reviews/${archivedId}`,headers:{cookie:otherCookie}});
    expect(queue.statusCode).toBe(200);expect(queue.json()).toMatchObject({pendingCount:1});
    expect(queue.json().items.map((item:any)=>item.favoriteTitle)).toEqual(['Synthetic Current Work']);
    expect(history.statusCode).toBe(200);expect(history.json().favoriteTitle).toBe('Synthetic Archived Work');
    expect(isolated.statusCode).toBe(404);
    const stored=await pool.query('SELECT count(*)::int AS count FROM favorite_review WHERE user_id=$1',[userId]);
    expect(stored.rows[0].count).toBe(2);
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[userId,otherId]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('keeps the notification inbox and read action isolated per account',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(), otherId=randomUUID(), password='Wave6-Inbox-Password!';
    const email=`wave6-inbox-${userId}@example.test`, otherEmail=`wave6-inbox-${otherId}@example.test`;
    const passwordHash=await hashPassword(password);
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$4,'member'),($3,$5,$4,'member')",[userId,email,otherId,passwordHash,otherEmail]);
    const notification=await pool.query("INSERT INTO personal_notification(user_id,release_key,kind,payload) VALUES($1,$2,'RELEASE_AVAILABLE',$3) RETURNING id",[userId,`wave6-inbox-${userId}`,'{}']);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
    const cookie=String(login.headers['set-cookie']).split(';')[0], csrf=login.json().csrfToken;
    const otherLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:otherEmail,password}});
    const otherCookie=String(otherLogin.headers['set-cookie']).split(';')[0], otherCsrf=otherLogin.json().csrfToken;
    const inbox=await app.inject({method:'GET',url:'/api/v1/notifications',headers:{cookie}});
    const otherInbox=await app.inject({method:'GET',url:'/api/v1/notifications',headers:{cookie:otherCookie}});
    const read=await app.inject({method:'POST',url:`/api/v1/notifications/${notification.rows[0].id}/read`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf}});
    const forbiddenRead=await app.inject({method:'POST',url:`/api/v1/notifications/${notification.rows[0].id}/read`,headers:{cookie:otherCookie,origin:'https://favlib.home.arpa','x-csrf-token':otherCsrf}});
    expect(inbox.statusCode).toBe(200);expect(inbox.json().items).toHaveLength(1);expect(otherInbox.json().items).toHaveLength(0);expect(read.statusCode).toBe(200);expect(forbiddenRead.statusCode).toBe(404);
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[userId,otherId]);
  });
  it('rejects web mutations before they reach the handler when CSRF or origin is invalid',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),email=`wave9-csrf-${userId}@example.test`,password='Wave9-Csrf-Password!';
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,'member')",[userId,email,await hashPassword(password)]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}});
    const cookie=String(login.headers['set-cookie']).split(';')[0],csrf=login.json().csrfToken;
    const wrongOrigin=await app.inject({method:'PATCH',url:'/api/v1/notification-preferences',headers:{cookie,origin:'https://evil.example','x-csrf-token':csrf},payload:{digestEnabled:true}});
    const wrongToken=await app.inject({method:'PATCH',url:'/api/v1/notification-preferences',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':'invalid-token'},payload:{digestEnabled:true}});
    const stored=await pool.query('SELECT 1 FROM notification_preference WHERE user_id=$1',[userId]);
    expect(wrongOrigin.statusCode).toBe(403);expect(wrongOrigin.json().error.code).toBe('ORIGIN_MISMATCH');expect(wrongToken.statusCode).toBe(403);expect(wrongToken.json().error.code).toBe('CSRF_FAILED');expect(stored.rowCount).toBe(0);
    await pool.query('DELETE FROM app_user WHERE id=$1',[userId]);
  });
  it('previews, activates and rolls back a declarative source without saving preview HTML',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const adminId=randomUUID(), sourceId=`wave8-${randomUUID()}`;
    await pool.query('INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,\'admin\')',[adminId,`${sourceId}@example.test`,await hashPassword('Wave8-Integration-Password!')]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:`${sourceId}@example.test`,password:'Wave8-Integration-Password!'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0], csrf=login.json().csrfToken;
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'test','test',1) RETURNING id",[adminId,`wave9-rotation-${sourceId}`,digest('old-token')]);
    const rotated=await app.inject({method:'POST',url:`/api/v1/extension/devices/${device.rows[0].id}/rotate`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{}});expect(rotated.statusCode).toBe(200);expect(rotated.json().deviceToken).toBeTruthy();
    const definition={sourceId,version:'1',domain:'fixture.test',page:'release',titleSelector:'h1',sequenceSelector:'[data-episode]',linkSelector:'[data-release]',sequencePattern:'(\\d+)'};
    const preview=await app.inject({method:'POST',url:'/api/v1/admin/sources/preview',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{definition,html:'<h1>Fixture</h1><span data-episode="12">12</span><a data-release href="/ep/12">open</a>',baseUrl:'https://fixture.test/work'}});
    expect(preview.statusCode).toBe(200);expect(preview.json().preview.ok).toBe(true);
    const created=await app.inject({method:'POST',url:'/api/v1/admin/sources',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{definition,featureFlag:`source.${sourceId}`}});expect(created.statusCode).toBe(201);
    const v2=await app.inject({method:'POST',url:'/api/v1/admin/sources',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{definition:{...definition,version:'2'},featureFlag:`source.${sourceId}`}});expect(v2.statusCode).toBe(201);
    const activated=await app.inject({method:'POST',url:`/api/v1/admin/sources/${sourceId}/activate`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{version:'2'}});expect(activated.statusCode).toBe(200);
    const rolled=await app.inject({method:'POST',url:`/api/v1/admin/sources/${sourceId}/rollback`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{}});expect(rolled.statusCode).toBe(200);expect(rolled.json().activeVersion).toBe('1');
    await pool.query('DELETE FROM app_user WHERE id=$1',[adminId]);
  });
  it('creates a bounded personal export idempotently and purges it',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(), email=`wave9-${userId}@example.test`;
    await pool.query('INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,\'member\')',[userId,email,await hashPassword('Wave9-Integration-Password!')]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Wave9-Integration-Password!'}});
    const cookie=String(login.headers['set-cookie']).split(';')[0], csrf=login.json().csrfToken, headers={cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf};
    const first=await app.inject({method:'POST',url:'/api/v1/account-exports',headers:{...headers,'idempotency-key':'wave9-export-1'},payload:{}});
    const replay=await app.inject({method:'POST',url:'/api/v1/account-exports',headers:{...headers,'idempotency-key':'wave9-export-1'},payload:{}});
    expect(first.statusCode).toBe(202);expect(replay.json().exportId).toBe(first.json().exportId);
    const preference=await app.inject({method:'PATCH',url:'/api/v1/notification-preferences',headers,payload:{digestEnabled:true,preferredOriginAlert:true,ntfyTopic:'wave9-test'}});expect(preference.statusCode).toBe(200);expect(preference.json().digestEnabled).toBe(true);
    const purged=await app.inject({method:'DELETE',url:`/api/v1/account-exports/${first.json().exportId}`,headers,payload:{}});expect(purged.statusCode).toBe(200);
    await pool.query('DELETE FROM app_user WHERE id=$1',[userId]);
  });
  it('keeps account deletion secrets in an authenticated CSRF-protected body',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(), email=`wave9-delete-${userId}@example.test`;
    await pool.query('INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,\'member\')',[userId,email,await hashPassword('Wave9-Delete-Password!')]);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password:'Wave9-Delete-Password!'}});const cookie=String(login.headers['set-cookie']).split(';')[0],csrf=login.json().csrfToken;
    const request=await app.inject({method:'POST',url:'/api/v1/account/deletion-requests',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{}});expect(request.statusCode).toBe(201);const token=request.json().token;
    const leaked=await app.inject({method:'DELETE',url:`/api/v1/account/deletion/${token}`,headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf}});expect(leaked.statusCode).toBe(404);const first=await app.inject({method:'DELETE',url:'/api/v1/account/deletion',headers:{cookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{token}});expect(first.statusCode).toBe(200);
    await pool.query("DELETE FROM account_deletion_request WHERE token_hash=$1",[digest(token)]);await pool.query("DELETE FROM deletion_tombstone WHERE entity_type='user' AND entity_id=$1",[userId]);
  });
  it('paginates a personal library in stable non-overlapping batches of thirty',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),prefix=`pagination-${randomUUID()}`,email=`${prefix}@example.test`,password='Pagination-Integration-Password!';
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,'member')",[userId,email,await hashPassword(password)]);
    const installationId=`${prefix}-installation`;
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'Pagination fixture','test',1) RETURNING id",[userId,installationId,digest(`${prefix}-token`)]);
    const batch=await pool.query('INSERT INTO bookmark_import_batch(device_id,batch_id,item_count) VALUES($1,$2,65) RETURNING id',[device.rows[0].id,randomUUID()]);
    for(let index=1;index<=65;index+=1){
      const suffix=String(index).padStart(3,'0'),mediaId=`${prefix}-${suffix}`,bookmarkId=`${prefix}-bookmark-${suffix}`;
      await pool.query("INSERT INTO media(id,type,season_year,format) VALUES($1,'MANGA',$2,'serialized')",[mediaId,2000+(index%20)]);
      await pool.query("INSERT INTO media_title(media_id,text,normalized_text,kind,connector,provenance) VALUES($1,$2,$3,'official','test','{}')",[mediaId,`Œuvre ${suffix}`,`œuvre ${suffix}`]);
      await pool.query("INSERT INTO bookmark_import_item(batch_id,user_id,installation_id,bookmark_id,fingerprint,event,payload,classification_status) VALUES($1,$2,$3,$4,$5,'created',$6,'recognized')",[batch.rows[0].id,userId,installationId,bookmarkId,digest(bookmarkId),{id:bookmarkId,title:`Œuvre ${suffix}`,url:`https://example.test/library/${suffix}`}]);
      await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,$3,$4,'matched','test','{}')",[userId,installationId,bookmarkId,mediaId]);
    }
    for(const [suffix,date] of [['001','2026-07-01'],['002','2026-08-01']]){const mediaId=`${prefix}-${suffix}`;for(const [field,value] of [['themes',['Action','Adventure']],['status','ongoing'],['language','ja'],['latestReleaseDate',date]])await pool.query('INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,\'anilist\',\'https://anilist.org\',1,\'Metadata source: AniList\')',[mediaId,field,JSON.stringify(value)]);}
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email,password}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const first=await app.inject({method:'GET',url:'/api/v1/library?limit=30&offset=0',headers:{cookie}}),second=await app.inject({method:'GET',url:'/api/v1/library?limit=30&offset=30',headers:{cookie}}),third=await app.inject({method:'GET',url:'/api/v1/library?limit=30&offset=60',headers:{cookie}});
    expect(first.json()).toMatchObject({total:65,nextOffset:30,hasMore:true});expect(second.json()).toMatchObject({total:65,nextOffset:60,hasMore:true});expect(third.json()).toMatchObject({total:65,nextOffset:65,hasMore:false});
    const ids=[...first.json().items,...second.json().items,...third.json().items].map((item:any)=>item.id);
    expect(ids).toHaveLength(65);expect(new Set(ids).size).toBe(65);expect(ids[0]).toBe(`${prefix}-001`);expect(ids[64]).toBe(`${prefix}-065`);
    const facets=await app.inject({method:'GET',url:'/api/v1/library/facets',headers:{cookie}}),filtered=await app.inject({method:'GET',url:'/api/v1/library?theme=Action&type=MANGA&status=ongoing&provider=anilist&sort=release&direction=desc',headers:{cookie}});
    expect(facets.statusCode).toBe(200);expect(facets.json().themes).toContainEqual(expect.objectContaining({value:'Action',count:2}));expect(filtered.json().items.map((item:any)=>item.id)).toEqual([`${prefix}-002`,`${prefix}-001`]);
    const cards=await app.inject({method:'GET',url:'/api/v1/library/cards?limit=30&offset=0',headers:{cookie}}),home=await app.inject({method:'GET',url:'/api/v1/home',headers:{cookie}}),header=await app.inject({method:'GET',url:'/api/v1/header-summary',headers:{cookie}});
    expect(cards.statusCode).toBe(200);expect(cards.json()).toMatchObject({total:65,nextOffset:30,hasMore:true});expect(cards.headers['cache-control']).toBe('private, max-age=30');expect(cards.headers.vary).toContain('Cookie');
    expect(Buffer.byteLength(cards.body)).toBeLessThanOrEqual(Math.floor(Buffer.byteLength(first.body)*0.2));
    expect(Object.keys(cards.json().items[0]).sort()).toEqual(['availability','classificationStatus','coverUrl','favoriteCount','format','id','progress','status','title','type'].sort());
    expect(home.statusCode).toBe(200);expect(home.json().myList).toHaveLength(6);expect(home.json().continue).toEqual([]);expect(home.json().latestReleases).toEqual([]);
    expect(header.json()).toEqual({role:'member',pendingReviewCount:0});
    await pool.query('DELETE FROM app_user WHERE id=$1',[userId]);await pool.query('DELETE FROM media WHERE id LIKE $1',[`${prefix}-%`]);
  });
  it('validates, persists and authorizes operational settings and protects the last admin',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');const adminId=randomUUID(),memberId=randomUUID(),password='Settings-Integration-Password!',adminEmail=`settings-admin-${adminId}@example.test`,memberEmail=`settings-member-${memberId}@example.test`;await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,'admin'),($4,$5,$3,'member')",[adminId,adminEmail,await hashPassword(password),memberId,memberEmail]);const adminLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:adminEmail,password}}),memberLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:memberEmail,password}}),adminCookie=String(adminLogin.headers['set-cookie']).split(';')[0],memberCookie=String(memberLogin.headers['set-cookie']).split(';')[0],csrf=adminLogin.json().csrfToken;const denied=await app.inject({method:'GET',url:'/api/v1/admin/settings',headers:{cookie:memberCookie}}),noCsrf=await app.inject({method:'PATCH',url:'/api/v1/admin/settings',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa'},payload:{'timeouts.providerMs':4321}}),unsafe=await app.inject({method:'PATCH',url:'/api/v1/admin/settings',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{'timeouts.providerMs':999}}),saved=await app.inject({method:'PATCH',url:'/api/v1/admin/settings',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{'timeouts.providerMs':4321}}),read=await app.inject({method:'GET',url:'/api/v1/admin/settings',headers:{cookie:adminCookie}}),lastAdmin=await app.inject({method:'PATCH',url:`/api/v1/admin/users/${adminId}`,headers:{cookie:adminCookie,origin:'https://favlib.home.arpa','x-csrf-token':csrf},payload:{role:'member'}});expect(denied.statusCode).toBe(403);expect(noCsrf.statusCode).toBe(403);expect(unsafe.statusCode).toBe(422);expect(saved.statusCode).toBe(200);expect(read.json().values['timeouts.providerMs']).toBe(4321);expect(read.json().defaults['timeouts.providerMs']).toBe(OPERATIONAL_DEFAULTS['timeouts.providerMs']);expect(lastAdmin.statusCode).toBe(409);await pool.query("DELETE FROM operational_setting WHERE key='timeouts.providerMs'");await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[adminId,memberId]);
  });
  it('allows local public registration and rejects weak passwords and duplicate email addresses',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');const email=`public-member-${randomUUID()}@example.test`,password='Public-Registration-Password!';const weak=await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{email:`weak-${email}`,password:'too-short'}});const accepted=await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{email,password}});const duplicate=await app.inject({method:'POST',url:'/api/v1/auth/register',payload:{email,password}});expect(weak.statusCode).toBe(422);expect(accepted.statusCode).toBe(201);expect(duplicate.statusCode).toBe(409);await pool.query('DELETE FROM app_user WHERE email=$1',[email]);
  });
  it('resets only provider-derived catalogue rows and preserves personal data and local image hashes',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const userId=randomUUID(),mediaId=`catalog-reset-${randomUUID()}`,installationId=`catalog-reset-${randomUUID()}`,assetHash=createHash('sha256').update(randomUUID()).digest('hex');
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,'synthetic','member')",[userId,`catalog-reset-${userId}@example.test`]);
    await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol) VALUES($1,$2,$3,'catalog reset','test',1)",[userId,installationId,digest(`catalog-reset-${userId}`)]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'catalog-reset-bookmark',$3,'matched','test','{}')",[userId,installationId,mediaId]);
    const observation=await pool.query("INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,confidence,consented,observed_at) VALUES($1,$2,'fixture','chapter',7,'7','high',true,now()) RETURNING id",[userId,mediaId]);
    await pool.query("INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id) VALUES($1,$2,'chapter',7,'7',$3)",[userId,mediaId,observation.rows[0].id]);
    await pool.query("INSERT INTO extension_preference(user_id,auto_update_favorites,observe_navigation,sync_minutes) VALUES($1,true,true,15)",[userId]);
    await pool.query("INSERT INTO catalog_image_asset(sha256,mime_type,data,width,height,byte_size) VALUES($1,'image/webp','synthetic',1,1,9)",[assetHash]);
    await pool.query("INSERT INTO media_cover(media_id,source_url,provider,provider_external_id,provenance,mime_type,asset_sha256,content_sha256,width,height,byte_size,status) VALUES($1,'https://s.example/cover.webp','anilist','fixture-cover','{\"fixture\":true}','image/webp',$2,$2,1,1,9,'ACTIVE')",[mediaId,assetHash]);
    await pool.query("INSERT INTO media_title(media_id,text,normalized_text,kind,connector,provenance) VALUES($1,'Provider title','provider title','official','mangaupdates','{}')",[mediaId]);
    await pool.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,'status','\"ongoing\"','mangaupdates','https://s.example',1,'fixture')",[mediaId]);
    const before=await pool.query("SELECT (SELECT count(*) FROM app_user WHERE id=$1)::int users,(SELECT count(*) FROM extension_device WHERE user_id=$1)::int devices,(SELECT count(*) FROM bookmark_media_link WHERE user_id=$1)::int favorites,(SELECT count(*) FROM favorite_progress WHERE user_id=$1)::int progress,(SELECT count(*) FROM extension_preference WHERE user_id=$1)::int preferences,(SELECT count(*) FROM media_cover WHERE media_id=$2)::int covers,(SELECT md5(string_agg(sha256,',' ORDER BY sha256)) FROM catalog_image_asset WHERE sha256=$3) hashes",[userId,mediaId,assetHash]);
    const reset=await pool.query("SELECT favlib_reset_catalog('RESET-FAVLIB-CATALOG') AS result");
    const after=await pool.query("SELECT (SELECT count(*) FROM app_user WHERE id=$1)::int users,(SELECT count(*) FROM extension_device WHERE user_id=$1)::int devices,(SELECT count(*) FROM bookmark_media_link WHERE user_id=$1)::int favorites,(SELECT count(*) FROM favorite_progress WHERE user_id=$1)::int progress,(SELECT count(*) FROM extension_preference WHERE user_id=$1)::int preferences,(SELECT count(*) FROM media_cover WHERE media_id=$2)::int covers,(SELECT md5(string_agg(sha256,',' ORDER BY sha256)) FROM catalog_image_asset WHERE sha256=$3) hashes",[userId,mediaId,assetHash]);
    const derived=await pool.query("SELECT (SELECT count(*) FROM media_title WHERE media_id=$1 AND connector='mangaupdates')::int titles,(SELECT count(*) FROM metadata_assertion WHERE media_id=$1 AND provider='mangaupdates')::int assertions",[mediaId]);
    expect(after.rows[0]).toEqual(before.rows[0]);expect(derived.rows[0]).toEqual({titles:0,assertions:0});expect(reset.rows[0].result).toMatchObject({removedMedia:0,removedProviderTitles:expect.any(Number),removedProviderAssertions:expect.any(Number),preservedCovers:expect.any(Number)});
    await pool.query('DELETE FROM media_cover WHERE media_id=$1',[mediaId]);await pool.query('DELETE FROM catalog_image_asset WHERE sha256=$1',[assetHash]);await pool.query('DELETE FROM app_user WHERE id=$1',[userId]);await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });
  it('protects reset and preserves account, session, preferences and extension pairing',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const adminId=randomUUID(),memberId=randomUUID(),adminEmail=`reset-admin-${adminId}@example.test`,memberEmail=`reset-member-${memberId}@example.test`,password='Reset-Integration-Password!';
    await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,$3,'admin'),($4,$5,$3,'member')",[adminId,adminEmail,await hashPassword(password),memberId,memberEmail]);
    const device=await pool.query("INSERT INTO extension_device(user_id,installation_id,token_hash,name,browser,protocol,last_sync_at,verified_sync_at) VALUES($1,$2,$3,'reset device','test',1,now(),now()) RETURNING id",[adminId,`reset-${adminId}`,digest(`token-${adminId}`)]);
    const batch=await pool.query('INSERT INTO bookmark_import_batch(device_id,batch_id,item_count) VALUES($1,$2,1) RETURNING id',[device.rows[0].id,randomUUID()]);const mediaId=`source:${createHash('sha256').update(adminId).digest('hex').slice(0,40)}`;
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')",[mediaId]);await pool.query("INSERT INTO bookmark_import_item(batch_id,user_id,installation_id,bookmark_id,fingerprint,event,payload,classification_status) VALUES($1,$2,$3,'reset-bookmark',$4,'created',$5,'recognized')",[batch.rows[0].id,adminId,`reset-${adminId}`,'a'.repeat(64),{id:'reset-bookmark',title:'Reset fixture',url:'https://example.test/manga/reset'}]);await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,$2,'reset-bookmark',$3,'matched','test','{}')",[adminId,`reset-${adminId}`,mediaId]);await pool.query("INSERT INTO notification_preference(user_id,digest_enabled) VALUES($1,true)",[adminId]);await pool.query("INSERT INTO personal_notification(user_id,release_key,kind,payload) VALUES($1,'reset-release','fixture','{}')",[adminId]);
    const adminLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:adminEmail,password}}),adminCookie=String(adminLogin.headers['set-cookie']).split(';')[0],adminCsrf=adminLogin.json().csrfToken;const memberLogin=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:memberEmail,password}}),memberCookie=String(memberLogin.headers['set-cookie']).split(';')[0],memberCsrf=memberLogin.json().csrfToken;
    const diagnostics=await app.inject({method:'GET',url:'/api/v1/admin/diagnostics',headers:{cookie:adminCookie}});const diagnosticsDenied=await app.inject({method:'GET',url:'/api/v1/admin/diagnostics',headers:{cookie:memberCookie}});const noCsrf=await app.inject({method:'POST',url:'/api/v1/admin/reset',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa'},payload:{email:adminEmail,confirmation:'RESET'}});const ordinary=await app.inject({method:'POST',url:'/api/v1/admin/reset',headers:{cookie:memberCookie,origin:'https://favlib.home.arpa','x-csrf-token':memberCsrf},payload:{email:memberEmail,confirmation:'RESET'}});const wrong=await app.inject({method:'POST',url:'/api/v1/admin/reset',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa','x-csrf-token':adminCsrf},payload:{email:adminEmail,confirmation:'reset'}});const reset=await app.inject({method:'POST',url:'/api/v1/admin/reset',headers:{cookie:adminCookie,origin:'https://favlib.home.arpa','x-csrf-token':adminCsrf},payload:{email:adminEmail,confirmation:'RESET'}});
    const session=await app.inject({method:'GET',url:'/api/v1/auth/session',headers:{cookie:adminCookie}});const [devices,preferences,imports,notifications,member]=await Promise.all([pool.query('SELECT token_hash,last_sync_at,verified_sync_at FROM extension_device WHERE id=$1',[device.rows[0].id]),pool.query('SELECT digest_enabled FROM notification_preference WHERE user_id=$1',[adminId]),pool.query('SELECT count(*)::int AS count FROM bookmark_import_item WHERE user_id=$1',[adminId]),pool.query('SELECT count(*)::int AS count FROM personal_notification WHERE user_id=$1',[adminId]),pool.query('SELECT active FROM app_user WHERE id=$1',[memberId])]);
    expect(diagnostics.statusCode).toBe(200);expect(diagnostics.json()).toMatchObject({readOnly:true});expect(diagnosticsDenied.statusCode).toBe(403);expect(noCsrf.statusCode).toBe(403);expect(ordinary.statusCode).toBe(403);expect(wrong.statusCode).toBe(400);expect(reset.statusCode).toBe(200);expect(session.statusCode).toBe(200);expect(devices.rows[0]).toMatchObject({token_hash:digest(`token-${adminId}`),last_sync_at:null,verified_sync_at:null});expect(preferences.rows[0].digest_enabled).toBe(true);expect(imports.rows[0].count).toBe(0);expect(notifications.rows[0].count).toBe(0);expect(member.rowCount).toBe(1);
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[adminId,memberId]);
  });
  afterAll(async()=>{if(pool){await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)',[alice,bob]);await pool.end();}});
});
