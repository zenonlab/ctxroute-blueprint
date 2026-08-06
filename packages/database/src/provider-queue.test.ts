import {describe,expect,it,vi} from 'vitest';
import {withProviderRequest} from './provider-queue.js';

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
