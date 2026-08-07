import { afterEach, describe, expect, it, vi } from 'vitest';
import { domainMatches, inventoryDigest, webBookmark } from './core.js';
import type { State } from './core.js';
import { emptyState, migrateState } from './storage.js';
import { checkAndPersist, checkLink, mediaSites, requestSitePermission, siteFromUrl } from './sites.js';
import { proposeFavoriteUpdate } from './updates.js';
import { acknowledgeEvents, createSyncDrain, mergeReconciledState, progressionFrom, rebuildImportQueue, reconcileBookmarks, recoverServerInventory, reportBookmarkProgression, upload } from './sync.js';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const bookmark = (id: string, title = `Manga favorite ${id}`, url = `https://source.test/media/${id}`) => ({ id, parentId: null, title, url, dateAdded: null, dateGroupModified: null, fingerprint: `fingerprint-${id}-${url}` });

describe('Wave 3 sites and opt-in updates', () => {
  it('migrates a v4 profile to v6 and queues a resumable progression catch-up',()=>{const favorite=bookmark('kept');const migrated=migrateState({...emptyState(),syncStatus:undefined,version:4,installationId:'inst_profile_kept',deviceToken:'secret-device-token',knownBookmarks:[favorite],inventory:{totalWeb:1,likelyMedia:1,ambiguous:0,updatedAt:10}});expect(migrated).toMatchObject({version:6,progressCatchupPending:true,installationId:'inst_profile_kept',deviceToken:'secret-device-token',knownBookmarks:[favorite],queue:[{type:'created',bookmark:favorite}],pendingProposalResults:[],syncStatus:'pending',inventory:{totalWeb:1,digest:null}})});
  it('inventories every HTTP(S) bookmark without a media-word or domain allowlist', async () => {
    await expect(webBookmark({ id:'docs', parentId:'1', title:'My saved page', url:'https://unknown.example/opaque/path' })).resolves.toMatchObject({id:'docs',url:'https://unknown.example/opaque/path'});
    await expect(webBookmark({ id:'local', parentId:'1', title:'Local', url:'file:///tmp/page' })).resolves.toBeNull();
  });

  it('reconciles a formerly filtered inventory completely and idempotently', () => {
    const old=bookmark('old');
    const missing=bookmark('missing','Anything','https://unknown.example/value');
    const first=reconcileBookmarks({...emptyState(),knownBookmarks:[old]},[old,missing],123);
    expect(first.inventory).toEqual({totalWeb:2,likelyMedia:1,ambiguous:1,digest:null,updatedAt:123});
    expect(first.queue.map(event=>[event.type,event.bookmark.id])).toEqual([['created','missing']]);
    const second=reconcileBookmarks(first,[old,missing],124);
    expect(second.queue).toHaveLength(1);
    const removed=reconcileBookmarks({...second,queue:[]},[missing],125);
    expect(removed.queue.map(event=>[event.type,event.bookmark.id])).toEqual([['removed','old']]);
  });

  it('rebuilds the complete queue when the paired server inventory was reset', async()=>{
    const current=[bookmark('1'),bookmark('2','Saved','https://unknown.example/item')];
    const state={...emptyState(),deviceToken:'device-token',knownBookmarks:current,inventory:{totalWeb:2,likelyMedia:1,ambiguous:1,digest:'local-digest',updatedAt:1}};
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({inventoryTotal:0}),{status:200})));
    const recovered=await recoverServerInventory(state);
    expect(recovered.queue.map(event=>event.bookmark.id)).toEqual(['1','2']);
    expect(rebuildImportQueue(recovered).queue).toHaveLength(2);
  });
  it('rebuilds the queue when counts match but the server digest diverges',async()=>{const current=[bookmark('1'),bookmark('2')];const state={...emptyState(),deviceToken:'device-token',knownBookmarks:current,inventory:{totalWeb:2,likelyMedia:2,ambiguous:0,digest:'local-digest',updatedAt:1}};vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({protocol:1,minimumProtocol:1,inventoryTotal:2,recognizedCount:2,reviewCount:0,excludedCount:0,inventoryDigest:'different-digest',lastSyncAt:null}),{status:200})));const recovered=await recoverServerInventory(state);expect(recovered.syncStatus).toBe('diverged');expect(recovered.queue.map(event=>event.bookmark.id)).toEqual(['1','2'])});
  it('validates and derives approved sites only from media URLs', () => {
    expect(siteFromUrl('https://WWW.example.test/watch/1', 'bookmark')?.domain).toBe('example.test');
    expect(siteFromUrl('javascript:alert(1)')).toBeNull();
    expect(mediaSites([bookmark('1', 'Anime 1', 'https://example.test/watch/1'), bookmark('2', 'Docs', 'https://other.test/docs')])).toHaveLength(1);
    expect(domainMatches('video.example.test', 'example.test')).toBe(true);
    expect(domainMatches('example.test.evil.test', 'example.test')).toBe(false);
  });

  it('keeps automatic favorite updates opt-in, permission-scoped and reversible', () => {
    const state = emptyState();
    const current = { id: '1', url: 'https://example.test/1', title: 'Episode 1' };
    expect(proposeFavoriteUpdate(current, { url: 'https://example.test/2', title: 'Episode 2', confidence: 'clear' }, state)).toBeNull();
    const enabled = { ...state, autoUpdateFavorites: true, sites: [{ id: 'site_example.test', domain: 'example.test', source: 'bookmark' as const, approvedAt: Date.now(), permissionGranted: true }] };
    expect(proposeFavoriteUpdate(current, { url: 'https://example.test/2', title: 'Episode 2', confidence: 'ambiguous' }, enabled)).toBeNull();
    expect(proposeFavoriteUpdate(current, { url: 'https://example.test/2', title: 'Episode 2', confidence: 'clear' }, enabled)).toMatchObject({ oldUrl: current.url, newUrl: 'https://example.test/2' });
  });

  it('normalizes a precise favorite position instead of sending its full URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const state = { ...emptyState(), deviceToken: 'device-token' };
    const favorite = bookmark('bookmark-1', 'Episode 12', 'https://source.test/anime/show/episode/12');
    await reportBookmarkProgression(state, favorite, 'changed');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ bookmarkId: 'bookmark-1', position: '12', kind: 'episode' });
    expect(progressionFrom('Chapter 37', 'https://source.test/read')).toEqual({ position: '37', kind: 'chapter' });
    await reportBookmarkProgression(state, favorite, 'moved');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 426, 429])('keeps the local queue when the import API returns %s', async status => {
    const fetchMock=vi.fn().mockResolvedValue(new Response('{}', { status:401 }));
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
    vi.stubGlobal('fetch',fetchMock);
    const favorite = bookmark('bookmark-2', 'Episode 2', 'https://source.test/episode/2');
    const state = { ...emptyState(), deviceToken: 'device-token', queue: [{ id: crypto.randomUUID(), type: 'changed' as const, bookmark: favorite, createdAt: Date.now(), attempts: 0 }] };
    await expect(upload(state)).rejects.toThrow();
    expect(state.queue).toHaveLength(1);
  });

  it('keeps a favorite changed while its previous payload is being uploaded',async()=>{
    const before=bookmark('changing','Episode 1','https://source.test/episode/1');
    const after=bookmark('changing','Episode 2','https://source.test/episode/2');
    const sent={id:'event-changing',type:'changed' as const,bookmark:before,createdAt:1,attempts:0};
    const replacement={...sent,bookmark:after};
    const current={...emptyState(),deviceToken:'device-token',queue:[replacement]};
    expect(acknowledgeEvents(current,[sent],'cursor-next').queue).toEqual([replacement]);
  });

  it('removes only the exactly acknowledged event and preserves arrivals during upload',()=>{
    const first={id:'event-first',type:'created' as const,bookmark:bookmark('first'),createdAt:1,attempts:0};
    const arrived={id:'event-arrived',type:'created' as const,bookmark:bookmark('arrived'),createdAt:2,attempts:0};
    const state={...emptyState(),queue:[first,arrived]};
    expect(acknowledgeEvents(state,[first],'cursor-next')).toMatchObject({queue:[arrived],cursor:'cursor-next'});
  });

  it('preserves a new favorite and inventory payload while reconciliation is being persisted',()=>{
    const discovered=bookmark('discovered'),arrived=bookmark('arrived');
    const reconciled=reconcileBookmarks(emptyState(),[discovered],1);
    const arrival={id:'event-arrival',type:'created' as const,bookmark:arrived,createdAt:2,attempts:0};
    const current={...emptyState(),knownBookmarks:[arrived],queue:[arrival]};
    const merged=mergeReconciledState(current,reconciled);
    expect(merged.knownBookmarks.map(item=>item.id).sort()).toEqual(['arrived','discovered']);
    expect(merged.queue.map(item=>item.bookmark.id).sort()).toEqual(['arrived','discovered']);
  });

  it('runs another pass when several sync requests arrive during an active pass',async()=>{
    let release!:()=>void;let passes=0;
    const firstPass=new Promise<void>(resolve=>{release=resolve});
    const sync=createSyncDrain(async()=>{passes++;if(passes===1)await firstPass});
    const active=sync();sync();sync();release();await active;
    expect(passes).toBe(2);
  });

  it('drains 1,446 queued favorites in six stable, persisted batches and verifies the receipt', async () => {
    const saved = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { set: saved } } });
    const importBodies: Array<{ batchId: string; items: unknown[] }> = [];
    const bookmarks=Array.from({ length: 1446 }, (_, index) => bookmark(String(index)));
    const digest=await inventoryDigest(bookmarks);
    vi.stubGlobal('fetch', vi.fn(async (input: string|URL, init: RequestInit) => {
      const url=String(input);
      if(url.includes('/diagnostic'))return new Response(JSON.stringify({protocol:1,minimumProtocol:1,inventoryTotal:1446,recognizedCount:360,reviewCount:1086,excludedCount:0,inventoryDigest:digest,lastSyncAt:'2026-08-02T10:00:00.000Z'}),{status:200});
      if(url.includes('/reconcile'))return new Response(JSON.stringify({verified:true,verifiedSyncAt:'2026-08-02T10:01:00.000Z'}),{status:200});
      if (!url.includes('/import-batches')) return new Response('{}', { status: 404 });
      const body = JSON.parse(String(init.body));
      importBodies.push(body);
      return new Response(JSON.stringify({ cursor: `cursor-${importBodies.length}` }), { status: 200 });
    }));
    const queue = bookmarks.map(item => ({ id: crypto.randomUUID(), type: 'created' as const, bookmark:item, createdAt: Date.now(), attempts: 0 }));
    const state = { ...emptyState(), deviceToken: 'device-token', queue,knownBookmarks:bookmarks,inventory:{totalWeb:1446,likelyMedia:1446,ambiguous:0,digest,updatedAt:1} };
    let persisted:State=state;
    const result = await upload(state,async(events,cursor)=>{persisted=acknowledgeEvents(persisted,events,cursor);await saved({favlibState:persisted});return persisted});
    expect(result.queue).toHaveLength(0);
    expect(importBodies.map(body => body.items.length)).toEqual([250, 250, 250, 250, 250, 196]);
    expect(importBodies[0].batchId).toBe(queue[0].id);
    expect(saved).toHaveBeenCalledTimes(6);
    expect(result.syncStatus).toBe('verified');
    expect(result.serverReceipt?.inventoryTotal).toBe(1446);
  });

  it('acknowledges an accepted import even when optional progression is rejected', async () => {
    vi.stubGlobal('chrome', { storage: { local: { set: vi.fn() } } });
    vi.stubGlobal('fetch', vi.fn(async (input: string|URL) => {const url=String(input);return url.includes('/import-batches') ? new Response(JSON.stringify({ cursor: 'next' }), { status: 200 }) : url.includes('/diagnostic')?new Response(JSON.stringify({protocol:1,minimumProtocol:1,inventoryTotal:0,recognizedCount:0,reviewCount:0,excludedCount:0,inventoryDigest:'0'.repeat(64),lastSyncAt:null}),{status:200}):new Response('{}', { status: 400 })}));
    const queue = [{ id: crypto.randomUUID(), type: 'changed' as const, bookmark: bookmark('3', 'Episode 3', 'https://source.test/episode/3'), createdAt: Date.now(), attempts: 0 }];
    let persisted:State={...emptyState(),deviceToken:'device-token',queue};
    const result = await upload(persisted,async(events,cursor)=>persisted=acknowledgeEvents(persisted,events,cursor));
    expect(result.queue).toHaveLength(0);
  });

  it('requests manual host permission and never approves invalid or refused domains', async () => {
    const request = vi.fn().mockResolvedValue(false);
    vi.stubGlobal('chrome', { permissions: { request } });
    expect(await requestSitePermission('javascript:alert(1)')).toBe(false);
    expect(await requestSitePermission('example.test')).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({ origins: ['https://example.test/*','http://example.test/*'] });
  });

  it('persists bounded link verification states without deleting inaccessible favorites', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 200, headers: { 'content-length': '4' } })).mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://example.test/next' } })).mockResolvedValueOnce(new Response('', { status: 200, headers: { 'content-length': '20' } })));
    expect((await checkLink('https://example.test/ok', 100, 10)).status).toBe('accessible');
    expect((await checkLink('https://example.test/redirect')).error).toBe('REDIRECT_NOT_FOLLOWED');
    expect((await checkLink('https://example.test/large', 100, 10)).error).toBe('SIZE_LIMIT');
    const saved = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { set: saved } } });
    const state = { ...emptyState(), knownBookmarks: [bookmark('b1', 'Episode', 'https://example.test/episode/1')] };
    expect((await checkAndPersist(state, 'https://example.test/offline')).checks).toHaveLength(1);
    expect(saved).toHaveBeenCalled();
  });

  it('turns an abort into a bounded timeout diagnostic', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))));
    const promise = checkLink('https://example.test/slow', 10);
    await vi.advanceTimersByTimeAsync(10);
    expect((await promise).error).toBe('TIMEOUT');
  });
});
