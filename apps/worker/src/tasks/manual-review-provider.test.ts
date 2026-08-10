import {beforeEach,describe,expect,it,vi} from 'vitest';

const {fetchAniList,fetchMangaUpdatesSeries,resolveMangaUpdatesPublicSlug}=vi.hoisted(()=>({
  fetchAniList:vi.fn(),
  fetchMangaUpdatesSeries:vi.fn(),
  resolveMangaUpdatesPublicSlug:vi.fn(),
}));

vi.mock('@favlib/metadata',async()=>{
  const actual=await vi.importActual<typeof import('@favlib/metadata')>('@favlib/metadata');
  return {...actual,fetchAniList,fetchMangaUpdatesSeries,resolveMangaUpdatesPublicSlug};
});
vi.mock('@favlib/database/provider-queue',()=>({withProviderRequest:vi.fn(async(_h:unknown,_input:unknown,call:()=>Promise<unknown>)=>call())}));

import manualReviewProvider from './manual-review-provider.js';

describe('manual provider review',()=>{
  beforeEach(()=>vi.clearAllMocks());

  it('resolves a synthetic MangaUpdates public slug through the shared exact-URL bridge',async()=>{
    resolveMangaUpdatesPublicSlug.mockResolvedValue({
      rawLink:'synthetic42',method:'public-url-slug',
      series:{id:'420042',title:'Synthetic Tower Expert',titles:['Synthetic Tower Expert'],type:'Manhwa',image:'https://images.provider.invalid/synthetic-cover.jpg',url:'https://provider.invalid/series/synthetic42/synthetic-tower-expert'},
    });
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    let ownershipChecks=0;
    const query=vi.fn(async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes('FROM favorite_review review')){ownershipChecks++;return {rowCount:1,rows:[{favorite_title:'Ep.42 - 42 | Synthetic Tower Expert',source_titles:['Synthetic Tower Expert']}]};}
      if(sql.startsWith('SELECT 1 FROM favorite_review'))return {rowCount:1,rows:[{}]};
      if(sql.includes('INSERT INTO provider_profile'))return {rowCount:1,rows:[{id:'profile-synthetic'}]};
      return {rowCount:1,rows:[]};
    });
    await manualReviewProvider({reviewId:'review-synthetic',userId:'user-synthetic',provider:'mangaupdates',providerId:'synthetic42'},{query});
    expect(ownershipChecks).toBe(1);
    expect(resolveMangaUpdatesPublicSlug).toHaveBeenCalledWith('synthetic42',expect.arrayContaining(['Synthetic Tower Expert']),expect.any(Object));
    expect(fetchMangaUpdatesSeries).not.toHaveBeenCalled();
    const profile=calls.find(call=>call.sql.includes('INSERT INTO provider_profile'))!;
    expect(profile.values?.[1]).toBe('420042');
    expect(profile.values?.[14]).toContain('"rawProviderId":"synthetic42"');
    expect(calls.find(call=>call.sql.includes('INSERT INTO favorite_review_candidate'))?.values?.[2]).toBe('synthetic42');
    expect(calls.some(call=>call.sql.includes("SET status='RESOLVED'"))).toBe(true);
    expect(calls.some(call=>call.sql.includes("INSERT INTO media_external_id"))).toBe(true);
    const mediaUpsert=calls.find(call=>call.sql.includes('INSERT INTO media(id,type,season_year)'))!;
    expect(mediaUpsert.values?.[1]).toBe('MANHWA');
    expect(mediaUpsert.sql).toContain('type=excluded.type');
    expect(calls.some(call=>call.sql.includes("UPDATE bookmark_media_link"))).toBe(true);
    const coverJob=calls.find(call=>call.sql.includes("add_job('provider-profile-cover'"));
    expect(coverJob?.values?.[0]).toEqual({profileId:'profile-synthetic'});
    expect(coverJob?.values?.[1]).toBe('provider-profile-cover:mangaupdates:420042');
    const enrichmentJob=calls.find(call=>call.sql.includes('graphile_worker.add_job($1'));
    expect(enrichmentJob?.values).toEqual([
      'mangaupdates-enrichment',
      {mediaId:'mangaupdates:420042',forceRefresh:true,repairAvailability:true},
      'manual-review-enrichment:mangaupdates:420042',
    ]);
  });

  it('hands a synthetic AniList manual identity to the same canonical enrichment lane',async()=>{
    fetchAniList.mockResolvedValue({id:700,title:{userPreferred:'Synthetic Animation',romaji:'Synthetic Animation'},type:'ANIME',synonyms:[]});
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const query=vi.fn(async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes('FROM favorite_review review'))return {rowCount:1,rows:[{favorite_title:'Synthetic Animation',source_titles:['Synthetic Animation']}]};
      if(sql.startsWith('SELECT 1 FROM favorite_review'))return {rowCount:1,rows:[{}]};
      if(sql.includes('INSERT INTO provider_profile'))return {rowCount:1,rows:[{id:'profile-animation'}]};
      return {rowCount:1,rows:[]};
    });
    await manualReviewProvider({reviewId:'review-animation',userId:'user-animation',provider:'anilist',providerId:'700'},{query});
    const enrichmentJob=calls.find(call=>call.sql.includes('graphile_worker.add_job($1'));
    expect(enrichmentJob?.values).toEqual([
      'anilist-enrichment',
      {mediaId:'anilist:700',forceRefresh:true,repairAvailability:true},
      'manual-review-enrichment:anilist:700',
    ]);
  });
});
