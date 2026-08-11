import { describe, expect, it, vi } from 'vitest';
import { applyAnimeSeasonLinkRepairBatch, createAnimeSeasonLinkRepairReviews, previewAnimeSeasonLinkRepair } from './anime-season-link-repair.js';

describe('anime season link repair',()=>{
  it('previews first, applies only a proved member, and reviews the remainder',async()=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('WHERE repairable ORDER BY')?[{id:'link-1',seasonMediaId:'season-2'}]:sql.includes('WHERE NOT repairable')?[{id:'link-2',reason:'ANIME_SEASON_LINK_REPAIR_OUTSIDE_CHAIN'}]:[]}));
    const preview=await previewAnimeSeasonLinkRepair(query);
    expect(preview.changes).toHaveLength(1);expect(preview.anomalies[0].reason).toBe('ANIME_SEASON_LINK_REPAIR_OUTSIDE_CHAIN');
    await applyAnimeSeasonLinkRepairBatch(query,100);
    await createAnimeSeasonLinkRepairReviews(query);
    expect(query.mock.calls.some(([sql])=>String(sql).includes("SET media_id=r.\"seasonMediaId\""))).toBe(true);
    expect(query.mock.calls.some(([sql])=>String(sql).includes("'anilist-chain','PENDING'"))).toBe(true);
  });
});
