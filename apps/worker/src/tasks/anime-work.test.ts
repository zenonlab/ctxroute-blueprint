import { describe, expect, it, vi } from 'vitest';
import { recordAndReconcileAnimeWork } from './anime-work.js';

describe('anime work PostgreSQL contract', () => {
  it('restarts missing related metadata so related-of-related discovery and covers can complete', async () => {
    const calls: Array<{sql:string;values?:unknown[]}>=[];
    const query=vi.fn(async (sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes('AS "payloadReady"'))return {rows:[{payloadReady:false,coverReady:false}]};
      if(sql.includes('WITH RECURSIVE component'))return {rows:[]};
      return {rows:[]};
    });
    await recordAndReconcileAnimeWork({query},'anilist:201',{
      id:201,type:'ANIME',format:'TV',title:{},synonyms:[],genres:[],tags:[],
      relations:[{id:202,type:'ANIME',format:'TV',relationType:'SIDE_STORY',title:{}}],
      airingSchedule:[],streamingEpisodes:[],studios:[],authors:[],
    },'synthetic-relation-payload');
    const queued=calls.find(call=>call.sql.includes("add_job('anilist-enrichment'"));
    expect(queued?.values?.[0]).toContain('"mediaId":"anilist:202"');
    expect(queued?.values?.[0]).toContain('"animeRelationDiscovery":true');
    expect(queued?.values?.[0]).toContain('"forceRefresh":true');
  });

  it('types the synthetic root identity in the implied progression insert', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('WITH RECURSIVE component')) return { rows: [{
        id: 'anilist:101', format: 'TV', anilist_id: '101', episode_total: 12,
        payload_ready: true, relations: [],
      }] };
      return { rows: [] };
    });
    await recordAndReconcileAnimeWork({ query }, 'anilist:101', {
      id: 101, type: 'ANIME', format: 'TV', title: {}, synonyms: [], genres: [],
      tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [], authors: [],
    }, 'synthetic-payload');
    const implied = calls.find(sql => sql.includes("'anilist-season-chain'"));
    expect(implied).toContain('SELECT l.user_id,$1::text');
  });
});
