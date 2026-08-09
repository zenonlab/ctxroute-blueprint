import { describe,expect,it,vi } from 'vitest';
import { applyObsoleteInstallationCleanup,obsoleteInstallationIdentityChecksSql,obsoleteInstallationPreviewSql,previewObsoleteInstallationCleanup } from './obsolete-installation-cleanup.js';

describe('obsolete installation cleanup',()=>{
  it('requires the exact user and installation and retains audit history',async()=>{
    const query=vi.fn(async(sql:string)=>({rows:sql===obsoleteInstallationPreviewSql?[{deviceId:'synthetic-device',activeLinkCount:2}]:[]}));
    const result=await previewObsoleteInstallationCleanup(query,'00000000-0000-4000-8000-000000000001','synthetic-installation');
    expect(result.summary.activeLinkCount).toBe(2);
    expect(obsoleteInstallationPreviewSql).toContain('d.user_id=$1::uuid AND d.installation_id=$2');
    expect(obsoleteInstallationPreviewSql).toContain('favorite_review_candidate');
    expect(obsoleteInstallationIdentityChecksSql).toContain('favorite_progress_candidate');
    expect(obsoleteInstallationIdentityChecksSql).toContain('media_identity_merge');
  });

  it('revokes only the scoped device, removes only active links, and preserves rows',async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const query=vi.fn(async(sql:string,values?:unknown[])=>{calls.push({sql,values});
      if(sql.startsWith('UPDATE extension_device'))return {rows:[{deviceId:'synthetic-device'}],rowCount:1};
      if(sql.startsWith('UPDATE bookmark_media_link'))return {rows:[{id:'one'},{id:'two'}],rowCount:2};
      if(sql.startsWith('SELECT count(DISTINCT'))return {rows:[{count:0}]};
      return {rows:[],rowCount:1};
    });
    const result=await applyObsoleteInstallationCleanup(query,'00000000-0000-4000-8000-000000000001','synthetic-installation');
    expect(result).toMatchObject({removedLinkCount:2,pendingReviewCount:0});
    for(const call of calls.slice(0,2))expect(call.values?.slice(0,2)).toEqual(['00000000-0000-4000-8000-000000000001','synthetic-installation']);
    const linkUpdate=calls.find(call=>call.sql.startsWith('UPDATE bookmark_media_link'))!.sql;
    expect(linkUpdate).toContain("status IN ('matched','accepted','review')");
    expect(calls.some(call=>/DELETE FROM (?:bookmark_import_item|favorite_review|favorite_review_candidate|favorite_progress_candidate)/u.test(call.sql))).toBe(false);
  });

  it('is idempotent and does not reactivate removed links',async()=>{
    const query=vi.fn(async(sql:string)=>{
      if(sql.startsWith('UPDATE extension_device'))return {rows:[{deviceId:'synthetic-device'}],rowCount:1};
      if(sql.startsWith('UPDATE bookmark_media_link'))return {rows:[],rowCount:0};
      if(sql.startsWith('SELECT count(DISTINCT'))return {rows:[{count:1}]};
      return {rows:[],rowCount:0};
    });
    await expect(applyObsoleteInstallationCleanup(query,'00000000-0000-4000-8000-000000000001','synthetic-installation')).resolves.toMatchObject({removedLinkCount:0,pendingReviewCount:1});
  });
});
