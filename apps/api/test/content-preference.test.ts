import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');

describe('personal content preference API',()=>{
  it('reads and writes only the authenticated owner and defaults to false',()=>{
    const start=server.indexOf('app.get("/api/v1/preferences/content"');
    const end=server.indexOf('app.get("/api/v1/preferences/languages"');
    const routes=server.slice(start,end);
    expect(routes).toContain('WHERE user_id=$1');
    expect(routes).toContain('[req.user.id,parsed.data.allowAdult]');
    expect(routes).toContain('{allowAdult:false,updatedAt:null}');
    expect(routes).not.toContain('req.body.userId');
    expect(routes).toContain('contentPreferencePatchContract.safeParse');
  });

  it('passes the requesting user into every personal surface gate',()=>{
    expect(server).toContain("contentAllowedSql('e.media_id')");
    expect(server).toContain("contentAllowedSql('c.media_id','$2')");
    expect(server).toContain('favlib_content_allowed(link.media_id,$1::uuid)');
    expect(server).toContain("contentAllowedSql('m.id','$2')");
    expect(server).toContain("contentAllowedSql('bookmark_media_link.media_id')");
  });
});
