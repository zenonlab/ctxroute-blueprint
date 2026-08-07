import { loadState, updateState } from '../src/storage.js';
import { createSyncDrain, mergeReconciledState, reconcileInventory, recoverServerInventory, reportNavigation, upload, reimportAllInventory, API } from '../src/sync.js';
import { webBookmark } from '../src/core.js';
import { siteFromUrl, mergeSites } from '../src/sites.js';
import { synchronizeExtensionControl } from '../src/server-control.js';
import { apiFetch as fetch } from '../src/api-fetch.js';

declare function defineBackground(main: () => void): unknown;

export default defineBackground(() => {
  let retryAttempt = 0;
  const scheduleRetry = async () => {
    const delayInMinutes = Math.min(15, 2 ** retryAttempt);
    retryAttempt = Math.min(retryAttempt + 1, 4);
    await chrome.alarms.create('favlib-sync-retry', { delayInMinutes });
  };
  const sync = createSyncDrain(async () => {
    try {
      let state = await loadState();
      if (!state.deviceToken) return;
      state = await synchronizeExtensionControl(state);
      await chrome.alarms.create('favlib-sync', { periodInMinutes: state.syncMinutes });
      state = await reconcileInventory(state);
      state = await recoverServerInventory(state);
      state = await updateState(current => mergeReconciledState(current,state));
      state = await upload(state);
      await updateState(current => ({ ...current,cursor:state.cursor,lastSyncAt:state.lastSyncAt,serverReceipt:state.serverReceipt,debugReport:state.debugReport,syncStatus:current.queue.length?'pending':state.syncStatus,diagnostic: { status: 'ok' } }));
      retryAttempt = 0;
      await chrome.alarms.clear('favlib-sync-retry');
    } catch (error) {
      const message = String(error);
      const status = message.includes('PROTOCOL') ? 'protocol' : message.includes('REVOKED') ? 'revoked' : message.includes('QUOTA') ? 'quota' : 'offline';
      await updateState(current => ({ ...current, deviceToken: status === 'revoked' ? undefined : current.deviceToken, pairing: status === 'revoked' && current.pairing ? { ...current.pairing, status: 'revoked' } : current.pairing, syncStatus:status, diagnostic: { status, lastError: message } }));
      if (status === 'offline') await scheduleRetry();
    }
  });
  const adminReimport = async () => {
    const state=await loadState();
    if(state.accountRole!=='admin'){await updateState(current=>({...current,reimport:{status:'failed',processed:0,total:0,error:'ADMIN_REQUIRED'}}));return;}
    try{await reimportAllInventory(state);await updateState(current=>({...current,diagnostic:{status:'ok'}}));}
    catch(error){const message=String(error);await updateState(current=>({...current,reimport:{...(current.reimport??{status:'running',processed:0,total:0}),status:'failed',error:message,finishedAt:Date.now()},diagnostic:{status:message.includes('REVOKED')?'revoked':'offline',lastError:message}}));}
  };

  const pairingPoll = async () => {
    const state = await loadState();
    const pairing = state.pairing;
    if (!pairing || !['pending', 'error'].includes(pairing.status)) return;
    if (Date.parse(pairing.expiresAt) <= Date.now()) {
      await updateState(current => ({ ...current, pairing: current.pairing ? { ...current.pairing, status: 'expired' } : undefined }));
      return;
    }
    try {
      const response = await fetch(`${API}/extension/pairing/challenges/${encodeURIComponent(pairing.challengeId)}`);
      if (!response.ok) throw new Error(`PAIRING_API_${response.status}`);
      const result = await response.json() as { status: string; deviceToken?: string };
      if (result.status === 'activated' && result.deviceToken) {
        await updateState(current => ({ ...current, deviceToken: result.deviceToken, pairing: { ...current.pairing!, status: 'activated', error: undefined }, syncStatus:'pending', diagnostic: { status: 'ok' } }));
        await sync();
      } else if (result.status === 'expired') {
        await updateState(current => ({ ...current, pairing: current.pairing ? { ...current.pairing, status: 'expired' } : undefined }));
      } else if (result.status === 'pending') {
        await updateState(current => ({ ...current, pairing: current.pairing ? { ...current.pairing, status: 'pending', error: undefined } : undefined }));
      }
    } catch (error) {
      await updateState(current => ({ ...current, pairing: current.pairing ? { ...current.pairing, status: 'error', error: 'Serveur momentanément indisponible, nouvelle tentative automatique.' } : undefined, syncStatus:'offline', diagnostic: { status: 'offline', lastError: String(error) } }));
    }
  };

  const startPairing = async () => {
    try {
      const state = await loadState();
      const response = await fetch(`${API}/extension/pairing/challenges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FavLib-Protocol': '1' },
        body: JSON.stringify({ installationId: state.installationId, protocol: 1 })
      });
      if (!response.ok) throw new Error(`PAIRING_API_${response.status}`);
      const challenge = await response.json() as { challengeId: string; code: string; expiresAt: string; pairingUrl: string };
      await updateState(current => ({ ...current, pairing: { ...challenge, status: 'pending', error: undefined }, diagnostic: { status: 'ok' } }));
      const automaticUrl = `${challenge.pairingUrl.split('#')[0]}#extension&code=${encodeURIComponent(challenge.code)}`;
      await chrome.tabs.create({ url: automaticUrl });
      await pairingPoll();
    } catch (error) {
      await updateState(current => ({ ...current, pairing: current.pairing ? { ...current.pairing, status: 'error', error: String(error) } : undefined, diagnostic: { status: 'offline', lastError: String(error) } }));
    }
  };

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'sync') void sync().catch(() => undefined);
    if (message?.type === 'manual-sync') void loadState().then(state=>state.accountRole==='admin'?sync():undefined).catch(() => undefined);
    if (message?.type === 'admin-reimport') void adminReimport().catch(() => undefined);
    if (message?.type === 'pairing-start') void startPairing();
    if (message?.type === 'pairing-poll') void pairingPoll();
  });

  chrome.runtime.onInstalled.addListener(async () => {
    const state = await loadState();
    await updateState(current => current);
    const next = await reconcileInventory(state);
    await updateState(() => next);
    await sync();
  });

  for (const [event, type] of [[chrome.bookmarks.onCreated, 'created'], [chrome.bookmarks.onChanged, 'changed'], [chrome.bookmarks.onMoved, 'moved']] as const) {
    event.addListener(async id => {
      const nodes = await chrome.bookmarks.get(id).catch(() => [] as chrome.bookmarks.BookmarkTreeNode[]);
      if (!nodes[0]) return;
      const bookmark = await webBookmark(nodes[0]);
      if (!bookmark) return;
      const site = siteFromUrl(bookmark.url, 'bookmark');
      await updateState(state => {const pending=state.queue.find(item=>item.bookmark.id===bookmark.id);const nextEvent={id:pending?.id??crypto.randomUUID(),type:pending?.type==='created'?'created':type,bookmark,createdAt:pending?.createdAt??Date.now(),attempts:pending?.attempts??0};return { ...mergeSites(state, site ? [site] : []), knownBookmarks: [...state.knownBookmarks.filter(item => item.id !== bookmark.id), bookmark], queue: [...state.queue.filter(item=>item.bookmark.id!==bookmark.id),nextEvent],syncStatus:state.deviceToken?'pending':'unpaired' }});
      await sync();
    });
  }

  chrome.bookmarks.onRemoved.addListener(async id => {
    await updateState(state => {
      const previous = state.knownBookmarks.find(bookmark => bookmark.id === id);
      const pending=state.queue.find(item=>item.bookmark.id===id);return previous ? { ...state, knownBookmarks: state.knownBookmarks.filter(bookmark => bookmark.id !== id), queue: [...state.queue.filter(item=>item.bookmark.id!==id), { id:pending?.id??crypto.randomUUID(), type: 'removed', bookmark: previous, createdAt: pending?.createdAt??Date.now(), attempts: pending?.attempts??0 }],syncStatus:state.deviceToken?'pending':'unpaired' } : state;
    });
    await sync();
  });

  chrome.webNavigation.onCommitted.addListener(details => {
    if (details.frameId !== 0) return;
    void loadState().then(state => reportNavigation(state, details.url, details.url)).catch(error => updateState(current => ({ ...current, diagnostic: { status: 'error', lastError: String(error) } })));
  });

  chrome.webNavigation.onCompleted.addListener(details => {
    if(details.frameId!==0||details.tabId<0)return;
    void loadState().then(async state=>{
      if(!state.deviceToken)return;let host:string;try{host=new URL(details.url).hostname.toLowerCase().replace(/^www\./,'')}catch{return}
      if(!state.sites.some(site=>site.permissionGranted&&(host===site.domain||host.endsWith(`.${site.domain}`))))return;
      const results=await chrome.scripting.executeScript({target:{tabId:details.tabId},func:()=>{
        const meta=(...names:string[])=>{for(const name of names){const element=document.querySelector(`meta[property="${CSS.escape(name)}"],meta[name="${CSS.escape(name)}"]`) as HTMLMetaElement|null;if(element?.content)return element.content.trim()}return undefined};
        let jsonTitle:string|undefined,jsonImage:string|undefined,jsonType:string|undefined,year:number|undefined,format:string|undefined;
        for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')))try{const parsed=JSON.parse(script.textContent??'null'),values=Array.isArray(parsed)?parsed:parsed?.['@graph']??[parsed];for(const item of values){if(!item||typeof item!=='object')continue;jsonTitle??=typeof item.name==='string'?item.name:typeof item.headline==='string'?item.headline:undefined;const image=Array.isArray(item.image)?item.image[0]:typeof item.image==='object'?item.image?.url:item.image;jsonImage??=typeof image==='string'?image:undefined;jsonType??=typeof item['@type']==='string'?item['@type']:undefined;const date=typeof item.datePublished==='string'?item.datePublished:typeof item.startDate==='string'?item.startDate:undefined;const parsedYear=date?Number(date.slice(0,4)):NaN;if(Number.isInteger(parsedYear))year??=parsedYear;format??=typeof item.encodingFormat==='string'?item.encodingFormat:undefined;}}catch{/* malformed JSON-LD is ignored */}
        const absolute=(value:string|undefined)=>{if(!value)return undefined;try{return new URL(value,location.href).toString()}catch{return undefined}};
        const canonical=absolute((document.querySelector('link[rel~="canonical"]') as HTMLLinkElement|null)?.href)??location.href;
        const title=jsonTitle??meta('og:title')??meta('twitter:title')??document.title?.trim()??undefined;
        return {pageUrl:location.href,canonicalUrl:canonical,title:title||undefined,image:absolute(jsonImage??meta('og:image','og:image:url','twitter:image')),type:jsonType??meta('og:type'),year,format,confidence:title?0.96:0.6};
      }});
      const metadata=results[0]?.result;if(!metadata)return;
      const response=await fetch(`${API}/extension/page-metadata`,{method:'POST',headers:{Authorization:`Bearer ${state.deviceToken}`,'Content-Type':'application/json'},body:JSON.stringify(metadata)});if(response.status===401)throw new Error('DEVICE_REVOKED');if(response.status===426)throw new Error('PROTOCOL_UNSUPPORTED');if(!response.ok)throw new Error(`PAGE_METADATA_${response.status}`);
    }).catch(error=>updateState(current=>({...current,diagnostic:{status:'error',lastError:String(error)}})));
  });

  const ensureAlarms = async () => {
    if (!(await chrome.alarms.get('favlib-sync'))) {const state=await loadState();await chrome.alarms.create('favlib-sync', { periodInMinutes: state.syncMinutes });}
    if (!(await chrome.alarms.get('favlib-pairing'))) await chrome.alarms.create('favlib-pairing', { periodInMinutes: 1 });
  };
  void ensureAlarms();
  chrome.runtime.onStartup.addListener(() => { void ensureAlarms(); void sync(); void pairingPoll(); });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'favlib-pairing') void pairingPoll(); else if (alarm.name === 'favlib-sync' || alarm.name === 'favlib-sync-retry') void sync(); });
});
