import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { runMigrations, runOnce } from 'graphile-worker';
import { Pool } from 'pg';
import { acquireLease } from './lease.js';
import { enqueuePersonalNotifications } from './notify.js';
import availability from './tasks/availability.js';
import announcementSync from './tasks/announcement-sync.js';
import retentionPurge from './tasks/retention-purge.js';
import notificationDelivery from './tasks/notification-delivery.js';
import { waitProviderGate } from './enrichment-state.js';
import { reconcileResolvedFavoriteReviews } from './favorite-resolution.js';
import { openFavoriteReview } from './favorite-review.js';
import { isolatedTestDatabaseUrl } from '@favlib/config';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
if (process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required; refusing DATABASE_URL integration tests');
const testDatabaseUrl = enabled ? isolatedTestDatabaseUrl() : undefined;
const suite = describe.skipIf(!enabled);
const pool = enabled ? new Pool({ connectionString: testDatabaseUrl }) : null;
const scope = `wave6-test-${Date.now()}`;

beforeAll(async()=>{
  if(testDatabaseUrl)await runMigrations({connectionString:testDatabaseUrl,noHandleSignals:true});
});

suite('Wave 6 PostgreSQL worker integration', () => {
  it('persists shared typed profiles and reconciles every undecided review without title exceptions', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const mediaId = `wave-f4-review-${Date.now()}`;
    const externalId = `integration-${randomUUID()}`;
    const user = await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id", [`wave-f4-${Date.now()}@example.test`]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')", [mediaId]);
    for (const bookmarkId of ['automatic', 'manual'])
      await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'wave-f4',$2,$3,'review','wave-f4','{}')", [user.rows[0].id, bookmarkId, mediaId]);
    await openFavoriteReview(pool.query.bind(pool), {
      userId: user.rows[0].id, installationId: 'wave-f4', bookmarkId: 'automatic', mediaId,
      title: 'Danmachi 5', url: 'https://example.test/danmachi-5', provider: 'anilist', reason: 'LOW_CONFIDENCE',
      candidates: [{ id: externalId, title: 'Synthetic Work', type: 'ANIME', startDate: { year: 2024 }, authors: [], synonyms: ['Synthetic Work Season 5'] }],
    });
    await openFavoriteReview(pool.query.bind(pool), {
      userId: user.rows[0].id, installationId: 'wave-f4', bookmarkId: 'manual', mediaId,
      title: 'Synthetic Parsed Work', url: 'https://example.test/synthetic-work', provider: 'anilist', reason: 'LOW_CONFIDENCE', candidates: [],
    });
    await pool.query("INSERT INTO media_metadata(media_id,provider,external_id,status,resolved_at,updated_at) VALUES($1,'anilist',$2,'ACTIVE',now(),now())", [mediaId,externalId]);
    await reconcileResolvedFavoriteReviews(pool.query.bind(pool), mediaId);
    const reviews = await pool.query("SELECT bookmark_id,status,reason,decision FROM favorite_review WHERE user_id=$1 AND installation_id='wave-f4' ORDER BY bookmark_id", [user.rows[0].id]);
    expect(reviews.rows).toEqual([
      expect.objectContaining({ bookmark_id: 'automatic', status: 'RESOLVED', decision: expect.objectContaining({ kind: 'automatic-provider-resolution', externalId }) }),
      expect.objectContaining({ bookmark_id: 'manual', status: 'RESOLVED', decision: expect.objectContaining({ kind: 'automatic-provider-resolution', externalId }) }),
    ]);
    const links=await pool.query("SELECT bookmark_id,media_id,status FROM bookmark_media_link WHERE user_id=$1 AND installation_id='wave-f4' ORDER BY bookmark_id",[user.rows[0].id]);
    expect(links.rows).toEqual([
      {bookmark_id:'automatic',media_id:mediaId,status:'matched'},
      {bookmark_id:'manual',media_id:mediaId,status:'matched'},
    ]);
    const candidate = await pool.query("SELECT p.start_date,p.authors,p.payload FROM favorite_review_candidate c JOIN provider_profile p ON p.id=c.profile_id JOIN favorite_review r ON r.id=c.review_id WHERE r.user_id=$1 AND c.provider_id=$2", [user.rows[0].id,externalId]);
    expect(candidate.rows[0]).toMatchObject({ start_date: { year: 2024 }, authors: [], payload: expect.objectContaining({ id: externalId }) });
    await pool.query('DELETE FROM app_user WHERE id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM media WHERE id=$1', [mediaId]);
  });

  it.each(['anilist','mangaupdates'] as const)('atomically converges a synthetic %s provisional favorite and materializes its progress',async provider=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const suffix=randomUUID(),sourceId=`source:integration-${suffix}`,targetId=`${provider}:integration-${suffix}`,externalId=`external-${suffix}`;
    const user=await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id",[`convergence-${suffix}@example.test`]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,$3),($2,$3)",[sourceId,targetId,provider==='anilist'?'ANIME':'MANGA']);
    await pool.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,$2,$3,'{}')",[targetId,provider,externalId]);
    await pool.query("INSERT INTO media_metadata(media_id,provider,external_id,status,resolved_at,updated_at) VALUES($1,$2,$3,'ACTIVE',now(),now())",[targetId,provider,externalId]);
    await pool.query("INSERT INTO media_identity_merge(source_media_id,target_media_id,provider,external_id,evidence) VALUES($1,$2,$3,$4,'{}')",[sourceId,targetId,provider,externalId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'synthetic-installation','synthetic-bookmark',$2,'review','synthetic','{}')",[user.rows[0].id,sourceId]);
    await pool.query("INSERT INTO favorite_progress_candidate(user_id,installation_id,bookmark_id,position_kind,position_number,position_raw,raw_title,raw_url,evidence) VALUES($1,'synthetic-installation','synthetic-bookmark','chapter',62,'62','Synthetic Chronicle Chapter 62','https://reader.invalid/chapter/62',$2)",[user.rows[0].id,{source:'shared-parser',raw:'62'}]);
    await pool.query("INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason) VALUES($1,'synthetic-installation','synthetic-bookmark','Synthetic Chronicle','https://reader.invalid/chapter/62',$2,'PENDING','LOW_CONFIDENCE')",[user.rows[0].id,provider]);
    await reconcileResolvedFavoriteReviews(pool.query.bind(pool),targetId);
    const state=await pool.query("SELECT l.media_id,l.status,r.status AS review_status,r.decision,p.position_number,p.position_raw,o.provenance FROM bookmark_media_link l JOIN favorite_review r ON r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id LEFT JOIN favorite_progress p ON p.user_id=l.user_id AND p.media_id=l.media_id AND p.position_kind='chapter' LEFT JOIN progression_observation o ON o.id=p.observation_id WHERE l.user_id=$1",[user.rows[0].id]);
    expect(state.rows[0]).toMatchObject({media_id:targetId,status:'matched',review_status:'RESOLVED',decision:expect.objectContaining({kind:'automatic-provider-resolution',provider,externalId}),position_number:'62',position_raw:'62',provenance:expect.objectContaining({raw:'62'})});
    await pool.query('DELETE FROM app_user WHERE id=$1',[user.rows[0].id]);
    await pool.query('DELETE FROM media WHERE id IN ($1,$2)',[sourceId,targetId]);
  });

  it('does not resurrect a removed favorite during automatic reconciliation',async()=>{
    if(!pool)throw new Error('DATABASE_URL required');
    const suffix=randomUUID(),mediaId=`anilist:removed-${suffix}`,externalId=`removed-${suffix}`;
    const user=await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id",[`removed-${suffix}@example.test`]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')",[mediaId]);
    await pool.query("INSERT INTO media_metadata(media_id,provider,external_id,status,resolved_at,updated_at) VALUES($1,'anilist',$2,'ACTIVE',now(),now())",[mediaId,externalId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'removed-installation','removed-bookmark',$2,'removed','synthetic','{}')",[user.rows[0].id,mediaId]);
    await pool.query("INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason) VALUES($1,'removed-installation','removed-bookmark','Synthetic Removed Work','https://reader.invalid/removed','anilist','PENDING','LOW_CONFIDENCE')",[user.rows[0].id]);
    await reconcileResolvedFavoriteReviews(pool.query.bind(pool),mediaId);
    const state=await pool.query("SELECT l.status,r.status AS review_status FROM bookmark_media_link l JOIN favorite_review r ON r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id WHERE l.user_id=$1",[user.rows[0].id]);
    expect(state.rows[0]).toEqual({status:'removed',review_status:'PENDING'});
    await pool.query('DELETE FROM app_user WHERE id=$1',[user.rows[0].id]);
    await pool.query('DELETE FROM media WHERE id=$1',[mediaId]);
  });

  it('keeps the repaired MangaUpdates identity, aliases, favorites and active cover intact', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const mediaId = process.env.FAVLIB_MANGAUPDATES_REGRESSION_MEDIA_ID;
    if (!mediaId) return; // Production repair runs opt in with the exact media id.
    const identity = await pool.query(
      "SELECT external_id FROM media_external_id WHERE media_id=$1 AND provider='mangaupdates'",
      [mediaId],
    );
    expect(identity.rows.map((row) => row.external_id)).toContain('24277219018');
    const state = await pool.query(
      "SELECT provider,external_id,status FROM media_metadata WHERE media_id=$1 AND provider='mangaupdates' AND status='ACTIVE'",
      [mediaId],
    );
    expect(state.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ external_id: '24277219018', status: 'ACTIVE' }),
    ]));
    const cover = await pool.query(
      "SELECT status,provider,provider_external_id FROM media_cover WHERE media_id=$1 AND status='ACTIVE'",
      [mediaId],
    );
    expect(cover.rows).toHaveLength(1);
    const noResult = await pool.query(
      "SELECT count(*)::int AS count FROM media_enrichment_state WHERE media_id=$1 AND provider='mangaupdates' AND purpose='metadata' AND error_code='NO_RESULT'",
      [mediaId],
    );
    expect(noResult.rows[0].count).toBe(0);
  });

  it('paces concurrent workers through one shared PostgreSQL provider gate',async()=>{if(!pool)throw new Error('DATABASE_URL required');await pool.query("DELETE FROM provider_request_gate WHERE provider='anilist-integration'");const completed:number[]=[];await Promise.all([waitProviderGate(pool,'anilist-integration',600).then(()=>completed.push(Date.now())),waitProviderGate(pool,'anilist-integration',600).then(()=>completed.push(Date.now()))]);completed.sort();expect(completed[1]-completed[0]).toBeGreaterThanOrEqual(500);await pool.query("DELETE FROM provider_request_gate WHERE provider='anilist-integration'")});
  it('serializes a lease and deduplicates a personal notification', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const leases = await Promise.all([acquireLease(pool, `${scope}-concurrent`, 'a'), acquireLease(pool, `${scope}-concurrent`, 'b')]);
    expect(leases.filter(Boolean)).toHaveLength(1);
    await pool.query('UPDATE source_check_lease SET expires_at=now()-interval \'1 second\' WHERE scope_key=$1', [`${scope}-concurrent`]);
    expect(await acquireLease(pool, `${scope}-concurrent`, 'recovered')).toBe(true);
    const release = { mediaId: 'wave6-test-media', sequence: { kind: 'integer' as const, raw: '1', number: 1 }, connector: 'fixture', checkedAt: '2026-08-02T00:00:00Z', status: 'AVAILABLE' as const };
    const user = await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id", [`wave6-${scope}@example.test`]);
    const users = [{ userId: user.rows[0].id, mediaId: 'wave6-test-media' }];
    expect(await enqueuePersonalNotifications(pool, release, users)).toBe(1);
    expect(await enqueuePersonalNotifications(pool, release, users)).toBe(1);
    const rows = await pool.query('SELECT count(*)::int AS count FROM personal_notification WHERE user_id=$1', [user.rows[0].id]);
    expect(rows.rows[0].count).toBe(1);
    await pool.query('DELETE FROM source_check_lease WHERE scope_key=$1', [`${scope}-concurrent`]);
    await pool.query('DELETE FROM app_user WHERE id=$1', [user.rows[0].id]);
  });

  it('persists a valid local snapshot and fans out a new release', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const mediaId = `wave6-media-${Date.now()}`;
    const scopeKey = `wave6-collect-${Date.now()}`;
    const user = await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id", [`wave6-collect-${Date.now()}@example.test`]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')", [mediaId]);
    await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'test','bookmark',$2,'matched','test','{}')", [user.rows[0].id, mediaId]);
    const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<main data-series="fixture"><h1>Fixture</h1><a href="/ep/2" data-episode="2">Episode 2</a></main>'); }).listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await availability({ scopeKey, target: `http://127.0.0.1:${port}/page`, mediaId, connector: 'fixture', connectorVersion: '1', policy: { approvedDomains: ['127.0.0.1'], allowPrivateTest: true } }, pool);
    const snapshot = await pool.query('SELECT status FROM source_snapshot WHERE scope_key=$1', [scopeKey]);
    const notifications = await pool.query('SELECT count(*)::int AS count FROM personal_notification WHERE user_id=$1 AND release_key LIKE $2', [user.rows[0].id, `${mediaId}|%`]);
    expect(snapshot.rows[0].status).toBe('VALID');
    expect(notifications.rows[0].count).toBe(1);
    server.close();
    await pool.query('DELETE FROM app_user WHERE id=$1', [user.rows[0].id]);
    await pool.query('DELETE FROM media WHERE id=$1', [mediaId]);
  });

  it('fetches a public target once and fans out independently to Alice and Bob', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const mediaId = `wave6-shared-media-${Date.now()}`;
    const scopeKey = `wave6-shared-${Date.now()}`;
    const users = await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member'),($2,'synthetic','member') RETURNING id", [`wave6-alice-${Date.now()}@example.test`, `wave6-bob-${Date.now()}@example.test`]);
    await pool.query("INSERT INTO media(id,type) VALUES($1,'MANGA')", [mediaId]);
    for (const user of users.rows) await pool.query("INSERT INTO bookmark_media_link(user_id,installation_id,bookmark_id,media_id,status,classifier_version,evidence) VALUES($1,'test',$2,$3,'matched','test','{}')", [user.id, `bookmark-${user.id}`, mediaId]);
    const server = createServer((_, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<main data-series="fixture"><h1>Fixture</h1><a href="/ep/3" data-episode="3">Episode 3</a></main>'); }).listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await availability({ scopeKey, target: `http://127.0.0.1:${port}/page`, mediaId, connector: 'fixture', connectorVersion: '1', policy: { approvedDomains: ['127.0.0.1'], allowPrivateTest: true } }, pool);
    const snapshots = await pool.query('SELECT count(*)::int AS count FROM source_snapshot WHERE scope_key=$1', [scopeKey]);
    const notifications = await pool.query('SELECT user_id,count(*)::int AS count FROM personal_notification WHERE release_key LIKE $1 GROUP BY user_id', [`${mediaId}|%`]);
    expect(snapshots.rows[0].count).toBe(1);
    expect(notifications.rows).toHaveLength(2);
    expect(notifications.rows.every(row => row.count === 1)).toBe(true);
    server.close();
    await pool.query('DELETE FROM app_user WHERE id IN ($1,$2)', [users.rows[0].id, users.rows[1].id]);
    await pool.query('DELETE FROM media WHERE id=$1', [mediaId]);
  });

  it('applies the configured TTL per approved domain without bypassing the fetch budget', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    let requests = 0;
    const mediaId = `wave6-ttl-media-${Date.now()}`;
    const scopeKey = `wave6-ttl-domain-${Date.now()}`;
    const server = createServer((_, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<main data-series="fixture"></main>');
    }).listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const payload = { scopeKey, target: `http://127.0.0.1:${port}/page`, mediaId, connector: 'fixture', connectorVersion: '1', policy: { approvedDomains: ['127.0.0.1'], allowPrivateTest: true } };
    const first = await availability({ ...payload, ttlMs: 60_000 }, pool);
    const second = await availability({ ...payload, ttlMs: 60_000 }, pool);
    expect('status' in first ? first.status : null).not.toBe('CACHED');
    expect('status' in second ? second.status : null).toBe('CACHED');
    expect(requests).toBe(1);
    await availability({ ...payload, ttlMs: 0 }, pool);
    expect(requests).toBe(2);
    server.close();
  });

  it('ingests an authorized AniList announcement idempotently through the worker task', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const mediaId = `wave6-announcement-media-${Date.now()}`;
    const releaseKey = `${mediaId}|main|integer|14|default`;
    await pool.query("INSERT INTO media(id,type) VALUES($1,'ANIME')", [mediaId]);
    const payload = { provider: 'anilist', announcements: [{ mediaId, releaseKey, announcedAt: '2026-08-02T00:00:00Z', status: 'ANNOUNCED' as const, provenance: { fixture: true, source: 'qualified-fixture' } }] };
    expect(await announcementSync(payload, pool)).toEqual({ status: 'OK', saved: 1 });
    expect(await announcementSync(payload, pool)).toEqual({ status: 'OK', saved: 1 });
    const rows = await pool.query('SELECT status,provenance FROM release_announcement WHERE provider=$1 AND release_key=$2', ['anilist', releaseKey]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ status: 'ANNOUNCED', provenance: { source: 'qualified-fixture' } });
    await pool.query('DELETE FROM media WHERE id=$1', [mediaId]);
  });

  it('freezes one batch of 100 from 150 notifications and leaves 50 pending',async()=>{if(!pool)throw new Error('DATABASE_URL required');const userId=randomUUID();await pool.query("INSERT INTO app_user(id,email,password_hash,role) VALUES($1,$2,'synthetic','member')",[userId,`batch-${userId}@example.test`]);await pool.query("INSERT INTO notification_preference(user_id,ntfy_topic) VALUES($1,'favlib_integration')",[userId]);for(let index=0;index<150;index++)await pool.query("INSERT INTO personal_notification(user_id,release_key,kind,payload) VALUES($1,$2,'RELEASE_AVAILABLE','{}')",[userId,`batch-release-${index}`]);const sent:string[][]=[];expect(await notificationDelivery({},pool,async(_topic,items)=>{sent.push(items.map(item=>item.id))})).toBe(100);const counts=await pool.query('SELECT count(*) FILTER(WHERE delivered_at IS NOT NULL)::int AS delivered,count(*) FILTER(WHERE delivered_at IS NULL)::int AS pending FROM personal_notification WHERE user_id=$1',[userId]);expect(sent).toHaveLength(1);expect(new Set(sent[0]).size).toBe(100);expect(counts.rows[0]).toEqual({delivered:100,pending:50});await pool.query('DELETE FROM app_user WHERE id=$1',[userId])});

  it('measures retention purge against expired rows without touching live exports', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const user = await pool.query("INSERT INTO app_user(email,password_hash,role) VALUES($1,'synthetic','member') RETURNING id", [`wave9-purge-${Date.now()}@example.test`]);
    const expired = await pool.query("INSERT INTO account_export(user_id,status,payload,purge_after) VALUES($1,'READY','{}'::jsonb,now()-interval '1 minute') RETURNING id", [user.rows[0].id]);
    const live = await pool.query("INSERT INTO account_export(user_id,status,payload,purge_after) VALUES($1,'READY','{}'::jsonb,now()+interval '1 day') RETURNING id", [user.rows[0].id]);
    const result = await retentionPurge({}, pool);
    expect(result.exports).toBeGreaterThanOrEqual(1);
    const rows = await pool.query('SELECT id FROM account_export WHERE id IN ($1,$2)', [expired.rows[0].id, live.rows[0].id]);
    expect(rows.rows.map(row => row.id)).toEqual([live.rows[0].id]);
    await pool.query('DELETE FROM app_user WHERE id=$1', [user.rows[0].id]);
  });

  it('retries a failed Graphile job and removes it after the next successful attempt', async () => {
    if (!pool) throw new Error('DATABASE_URL required');
    const key = `wave6-recovery-${Date.now()}`;
    await pool.query("SELECT graphile_worker.add_job('wave6-recovery-probe','{}'::json,NULL,now(),2,$1,0,ARRAY['wave6-recovery-test'])", [key]);
    let attempts = 0;
    const taskList = {
      'wave6-recovery-probe': async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('synthetic transient failure');
      },
    };
    await runOnce({ connectionString: testDatabaseUrl, noHandleSignals: true, concurrency: 1 }, taskList);
    const failed = await pool.query('SELECT attempts,max_attempts,last_error FROM graphile_worker._private_jobs WHERE key=$1', [key]);
    expect(attempts).toBe(1);
    expect(failed.rows[0]).toMatchObject({ attempts: 1, max_attempts: 2 });
    await pool.query('UPDATE graphile_worker._private_jobs SET run_at=now(),locked_at=NULL,locked_by=NULL WHERE key=$1', [key]);
    await runOnce({ connectionString: testDatabaseUrl, noHandleSignals: true, concurrency: 1 }, taskList);
    const recovered = await pool.query('SELECT id FROM graphile_worker._private_jobs WHERE key=$1', [key]);
    expect(attempts).toBe(2);
    expect(recovered.rowCount).toBe(0);
  });
});

afterAll(async () => {
  if (pool) {
    await pool.query('DELETE FROM source_check_lease WHERE scope_key=$1', [scope]);
    await pool.end();
  }
});
