import {describe,expect,it,vi} from 'vitest';
import {recoverProviderRequestOwner,withProviderRequest} from './provider-queue.js';

describe('global provider waitlists',()=>{
  it('persists, prioritizes and completes one AniList request through the shared lane',async()=>{
    const sql:string[]=[];
    const db={query:vi.fn(async(statement:string)=>{sql.push(statement);return {rows:[],rowCount:statement.includes('RETURNING id')?1:0}})};
    await expect(withProviderRequest(db,{provider:'anilist',kind:'calendar',priority:100,scopeKey:'media-1',spacingMs:2100},async()=>42)).resolves.toBe(42);
    expect(sql[0]).toContain('provider_request_waitlist');
    expect(sql.join('\n')).toContain('ORDER BY priority DESC,created_at');
    expect(sql.join('\n')).toContain('provider_request_gate');
    expect(sql.join('\n')).not.toContain('SKIP LOCKED');
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('state=$2'),expect.arrayContaining(['COMPLETED']));
  });
});
it('fails orphaned requests and releases only their durable running slots',async()=>{
  const query=vi.fn().mockResolvedValueOnce({rows:[{provider:'anilist',count:'2'}]}).mockResolvedValue({rows:[]});
  await recoverProviderRequestOwner({query},'api','API_RESTART');
  expect(query).toHaveBeenCalledWith(expect.stringContaining("state IN ('WAITING','RUNNING')"),['api','API_RESTART']);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('in_flight=GREATEST'),['anilist',2]);
});
