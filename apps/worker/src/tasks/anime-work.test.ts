import { describe, expect, it, vi } from 'vitest';
import {CONNECTOR_VERSIONS} from '@favlib/config';
import { recordAndReconcileAnimeWork } from './anime-work.js';

describe('anime work PostgreSQL contract', () => {
  it('does not treat an old related payload as reconciled current metadata', async () => {
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
    const readiness=calls.find(call=>call.sql.includes('AS "payloadReady"'));
    const component=calls.find(call=>call.sql.includes('WITH RECURSIVE component'));
    expect(readiness?.sql).toContain('payload.connector_version=$2');
    expect(readiness?.values).toEqual(['anilist:202',CONNECTOR_VERSIONS.anilistMetadata]);
    expect(component?.sql).toContain('p.connector_version=$2');
    expect(component?.values).toEqual(['anilist:201',CONNECTOR_VERSIONS.anilistMetadata]);
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

  it('keeps part 2, part 3, and part 6 linked to their resolved seasons while projecting root progress', async () => {
    const calls: Array<{sql:string;values?:unknown[]}>=[];
    const query=vi.fn(async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      if(sql.includes('WITH RECURSIVE component'))return {rows:[
        {id:'anilist:part-1',format:'TV',anilist_id:'1',episode_total:12,payload_ready:true,relations:[{id:'anilist:part-2',kind:'SEQUEL'}]},
        {id:'anilist:part-2',format:'TV',anilist_id:'2',episode_total:12,payload_ready:true,relations:[{id:'anilist:part-1',kind:'PREQUEL'},{id:'anilist:part-3',kind:'SEQUEL'}]},
        {id:'anilist:part-3',format:'TV',anilist_id:'3',episode_total:12,payload_ready:true,relations:[{id:'anilist:part-2',kind:'PREQUEL'},{id:'anilist:part-6',kind:'SEQUEL'}]},
        {id:'anilist:part-6',format:'TV',anilist_id:'6',episode_total:12,payload_ready:true,relations:[{id:'anilist:part-3',kind:'PREQUEL'}]},
      ]};
      return {rows:[]};
    });
    await recordAndReconcileAnimeWork({query},'anilist:part-3',{id:3,type:'ANIME',format:'TV',title:{},synonyms:[],genres:[],tags:[],relations:[],airingSchedule:[],streamingEpisodes:[],studios:[],authors:[]},'synthetic-parts');
    const rootProjection=calls.find(call=>call.sql.includes("'anilist-season-chain'"));
    expect(rootProjection?.values?.[0]).toBe('anilist:part-1');
    expect(calls.some(call=>call.sql.startsWith('UPDATE bookmark_media_link'))).toBe(false);
    expect(rootProjection?.sql).not.toContain('w.member_order>0');
  });

  it('opens an ambiguous chain review from the preserved raw bookmark payload', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('WITH RECURSIVE component')) return { rows: [
        {id:'anilist:301',format:'TV',anilist_id:'301',episode_total:12,payload_ready:true,relations:[{id:'anilist:302',kind:'SEQUEL'},{id:'anilist:303',kind:'SEQUEL'}]},
        {id:'anilist:302',format:'TV',anilist_id:'302',episode_total:12,payload_ready:true,relations:[{id:'anilist:301',kind:'PREQUEL'}]},
        {id:'anilist:303',format:'TV',anilist_id:'303',episode_total:12,payload_ready:true,relations:[{id:'anilist:301',kind:'PREQUEL'}]},
      ] };
      return { rows: [] };
    });
    await recordAndReconcileAnimeWork({query},'anilist:301',{
      id:301,type:'ANIME',format:'TV',title:{},synonyms:[],genres:[],tags:[],relations:[],airingSchedule:[],streamingEpisodes:[],studios:[],authors:[],
    },'synthetic-ambiguous-payload');
    const reviewInsert=calls.find(sql=>sql.includes("'anilist-chain','PENDING'"));
    expect(reviewInsert).toContain("i.payload->>'title' AS title");
    expect(reviewInsert).toContain("i.payload->>'url' AS url");
    expect(reviewInsert).not.toContain('i.title');
  });
});
