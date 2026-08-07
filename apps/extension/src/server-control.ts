import type { ExtensionConfig,ExtensionUpdateProposal } from '@favlib/contracts';
import { canonicalUrl,domainMatches,type ProposalResult,type State } from './core.js';
import { saveState } from './storage.js';
import { API } from './sync.js';
import { apiFetch as fetch } from './api-fetch.js';

type Config=ExtensionConfig&{sites?:{id:string;domain:string;source:'bookmark'|'manual'}[]};
type Proposal=ExtensionUpdateProposal;
const headers=(state:State)=>({Authorization:`Bearer ${state.deviceToken}`,'Content-Type':'application/json'});
async function checked(response:Response,label:string){if(response.status===401)throw new Error('DEVICE_REVOKED');if(response.status===426)throw new Error('PROTOCOL_UNSUPPORTED');if(!response.ok)throw new Error(`${label}_${response.status}`);return response}

async function acknowledge(state:State,result:ProposalResult){await checked(await fetch(`${API}/extension/update-proposals/${encodeURIComponent(result.id)}/result`,{method:'POST',headers:headers(state),body:JSON.stringify({result:result.result,code:result.code})}),'PROPOSAL_RESULT')}
async function flushResults(state:State){let next=state;for(const result of state.pendingProposalResults){await acknowledge(next,result);next={...next,pendingProposalResults:next.pendingProposalResults.filter(item=>item.id!==result.id)};await saveState(next)}return next}
async function permissionFor(domain:string){return chrome.permissions.contains({origins:[`https://${domain}/*`,`http://${domain}/*`]})}

export async function processProposal(state:State,proposal:Proposal):Promise<State>{
  const nodes=await chrome.bookmarks.get(proposal.bookmarkId).catch(()=>[] as chrome.bookmarks.BookmarkTreeNode[]),current=nodes[0];let result:ProposalResult;
  if(current?.url&&canonicalUrl(current.url)===canonicalUrl(proposal.newUrl)&&current.title===proposal.newTitle)result={id:proposal.id,result:'APPLIED',code:'RECOVERED_AFTER_LOCAL_APPLY'};
  else if(!current?.url||canonicalUrl(current.url)!==canonicalUrl(proposal.expectedUrl)||current.title!==proposal.expectedTitle)result={id:proposal.id,result:'STALE',code:'CURRENT_FAVORITE_CHANGED'};
  else if(!state.autoUpdateFavorites)result={id:proposal.id,result:'CANCELLED',code:'OPT_IN_DISABLED'};
  else{
    const currentHost=new URL(current.url).hostname.toLowerCase().replace(/^www\./,''),nextHost=new URL(proposal.newUrl).hostname.toLowerCase().replace(/^www\./,'');
    const approved=[currentHost,nextHost].every(host=>state.sites.some(site=>site.permissionGranted&&domainMatches(host,site.domain)));
    if(!approved||!await permissionFor(proposal.domain))result={id:proposal.id,result:'CANCELLED',code:'DOMAIN_PERMISSION_MISSING'};
    else try{await chrome.bookmarks.update(proposal.bookmarkId,{url:proposal.newUrl,title:proposal.newTitle});result={id:proposal.id,result:'APPLIED'}}catch{result={id:proposal.id,result:'FAILED',code:'BOOKMARK_UPDATE_FAILED'}}
  }
  const next={...state,pendingProposalResults:[...state.pendingProposalResults.filter(item=>item.id!==result.id),result]};await saveState(next);return next;
}

export async function synchronizeExtensionControl(state:State):Promise<State>{
  if(!state.deviceToken)return state;let next=await flushResults(state);
  const config=await checked(await fetch(`${API}/extension/config`,{headers:headers(next)}),'CONFIG').then(response=>response.json()) as Config;
  const serverSites=await Promise.all((config.sites??[]).map(async site=>({id:site.id,domain:site.domain,source:site.source,approvedAt:Date.now(),permissionGranted:await permissionFor(site.domain)})));
  const domains=new Set(serverSites.map(site=>site.domain));next={...next,sites:[...next.sites.filter(site=>!domains.has(site.domain)),...serverSites],accountRole:config.role,autoUpdateFavorites:config.preferences.autoUpdateFavorites,observeNavigation:config.preferences.observeNavigation,syncMinutes:config.preferences.syncMinutes,availableVersion:config.availableVersion};await saveState(next);
  const proposals=await checked(await fetch(`${API}/extension/update-proposals`,{headers:headers(next)}),'PROPOSALS').then(response=>response.json()) as {items:Proposal[]};
  for(const proposal of proposals.items){next=await processProposal(next,proposal);await acknowledge(next,next.pendingProposalResults.find(item=>item.id===proposal.id)!);next={...next,pendingProposalResults:next.pendingProposalResults.filter(item=>item.id!==proposal.id)};await saveState(next)}
  return next;
}
