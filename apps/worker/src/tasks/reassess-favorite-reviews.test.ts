import {describe,expect,it,vi} from 'vitest';
import {PROVIDER_TITLE_MATCHER_VERSION} from '@favlib/metadata';
import task from './reassess-favorite-reviews.js';

describe('review reassessment',()=>{
  it('uses a bounded versioned cluster ledger and deterministic provider jobs',async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const query=vi.fn(async(sql:string,values?:unknown[])=>{calls.push({sql,values});if(sql.includes('FROM review_title_cluster'))return{rows:[{id:'cluster-1',provider:'anilist',media_ids:['media-1']}]};return{rows:[],rowCount:0}});
    await task({batch:500} as never,{query,logger:{info:vi.fn()}} as never);
    expect(calls.find(call=>call.sql.includes('FROM review_title_cluster'))?.values?.[1]).toBe(100);
    expect(calls.some(call=>call.sql.includes('review_matcher_reassessment'))).toBe(true);
    expect(calls.some(call=>call.sql.includes("status='COMPLETED'")&&call.sql.includes('resolved_count'))).toBe(true);
    expect(calls.some(call=>call.sql.includes("status='ERROR'")&&call.sql.includes('last_error_code'))).toBe(true);
    expect(calls.some(call=>call.sql.includes('RETURNING a.cluster_id'))).toBe(false);
    expect(calls.some(call=>call.sql.includes('FROM LATERAL'))).toBe(false);
    expect(calls.filter(call=>call.values?.includes(PROVIDER_TITLE_MATCHER_VERSION)).length).toBeGreaterThan(0);
    expect(calls.some(call=>call.sql.includes('favorite_parser_repair')&&call.sql.includes("review.decision IS NULL"))).toBe(true);
    expect(calls.find(call=>call.sql.includes('graphile_worker.add_job'))?.values?.[2]).toContain('review-reassess:anilist:');
  });
});
