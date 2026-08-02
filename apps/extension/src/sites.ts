import { ApprovedSite, Bookmark, LinkCheck, State, domainMatches, hostnameFor, isApprovedDomain, isMedia } from './core.js';
import { saveState } from './storage.js';

export function siteFromUrl(url:string, source:ApprovedSite['source']='bookmark'):ApprovedSite|null {
  const domain=hostnameFor(url); if(!domain||!isApprovedDomain(domain)) return null;
  return {id:`site_${domain}`,domain,source,approvedAt:Date.now(),permissionGranted:false};
}
export function mediaSites(bookmarks:Bookmark[]):ApprovedSite[] {
  const map=new Map<string,ApprovedSite>(); for(const b of bookmarks){if(!isMedia(b.title,b.url))continue;const site=siteFromUrl(b.url);if(site)map.set(site.domain,site)} return [...map.values()];
}
export function mergeSites(state:State, additions:ApprovedSite[]):State { const map=new Map(state.sites.map(s=>[s.domain,s])); for(const site of additions)if(!map.has(site.domain))map.set(site.domain,site); return {...state,sites:[...map.values()]}; }
export async function addManualSite(state:State, raw:string):Promise<State> { const site=siteFromUrl(raw,'manual'); if(!site)throw new Error('INVALID_APPROVED_DOMAIN'); return saveAndReturn({...mergeSites(state,[site])}); }
export async function requestSitePermission(domain:string):Promise<boolean> { if(!isApprovedDomain(domain))return false; return chrome.permissions.request({origins:[`https://${domain}/*`]}); }
export function canOpenUrl(url:string,state:State){const host=hostnameFor(url);return Boolean(host&&state.sites.some(s=>s.permissionGranted&&domainMatches(host,s.domain)));}
export async function checkLink(url:string, timeoutMs=5000, maxBytes=1024*1024):Promise<LinkCheck> {
  const started=Date.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,10000));
  try { const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:controller.signal}); const length=Number(response.headers.get('content-length')??0); const status=response.status>=200&&response.status<400&&(!length||length<=maxBytes)?'accessible':response.status>=500?'offline':'needs_review'; return {url,status,checkedAt:Date.now(),failures:status==='accessible'?0:1,error:status==='accessible'?undefined:`HTTP_${response.status}`}; }
  catch(error){return {url,status:'offline',checkedAt:Date.now(),failures:1,error:Date.now()-started>=timeoutMs?'TIMEOUT':String(error)}} finally {clearTimeout(timer)}
}
export async function saveAndReturn(state:State){await saveState(state);return state}
