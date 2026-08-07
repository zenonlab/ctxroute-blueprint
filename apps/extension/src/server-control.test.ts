import { afterEach,describe,expect,it,vi } from 'vitest';
import { emptyState } from './storage.js';
import { processProposal } from './server-control.js';

afterEach(()=>vi.unstubAllGlobals());
const proposal={id:'00000000-0000-4000-8000-000000000009',bookmarkId:'b1',expectedUrl:'https://source.test/episode/1',expectedTitle:'Episode 1',newUrl:'https://source.test/episode/2',newTitle:'Episode 2',domain:'source.test',state:'PENDING' as const,createdAt:'2026-08-02T00:00:00.000Z'};
describe('server-authoritative extension proposals',()=>{
  it('does not modify Chrome when the server opt-in cache is false',async()=>{const update=vi.fn(),set=vi.fn();vi.stubGlobal('chrome',{bookmarks:{get:vi.fn().mockResolvedValue([{id:'b1',url:proposal.expectedUrl,title:proposal.expectedTitle}]),update},storage:{local:{set}}});const state=await processProposal({...emptyState(),deviceToken:'token'},proposal);expect(update).not.toHaveBeenCalled();expect(state.pendingProposalResults).toContainEqual(expect.objectContaining({id:proposal.id,result:'CANCELLED',code:'OPT_IN_DISABLED'}));expect(set).toHaveBeenCalled()});
  it('recovers uniquely after a crash following local application',async()=>{const update=vi.fn();vi.stubGlobal('chrome',{bookmarks:{get:vi.fn().mockResolvedValue([{id:'b1',url:proposal.newUrl,title:proposal.newTitle}]),update},storage:{local:{set:vi.fn()}}});const state=await processProposal({...emptyState(),deviceToken:'token',autoUpdateFavorites:true},proposal);expect(update).not.toHaveBeenCalled();expect(state.pendingProposalResults).toContainEqual(expect.objectContaining({result:'APPLIED',code:'RECOVERED_AFTER_LOCAL_APPLY'}))});
});
