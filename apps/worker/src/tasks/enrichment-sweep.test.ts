import { describe, expect, it } from 'vitest';
import sweep,{backfillKnownProviderAvailability,reconcileMergedEnrichment} from './enrichment-sweep.js';

describe('enrichment sweep', () => {
  it('backfills a decimal MangaUpdates assertion through the shared progression parser',async()=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const helpers={query:async(sql:string,values?:unknown[])=>{
      calls.push({sql,values});
      return sql.includes('SELECT DISTINCT ON')?{rows:[{mediaId:'synthetic-reading',raw:'c.12.5',externalId:'synthetic-id',sourceUrl:'https://provider.invalid/series/synthetic',assertedAt:'2026-01-01T00:00:00Z'}]}:{rows:[]};
    }};
    expect(await backfillKnownProviderAvailability(helpers as any,10)).toBe(1);
    const write=calls.find(call=>call.sql.includes('INSERT INTO provider_progress'))!;
    expect(write.values?.slice(0,3)).toEqual(['synthetic-reading','c.12.5',12.5]);
    expect(write.sql).toContain('excluded.available_position_number>=provider_progress.available_position_number');
  });
  it('repairs linked favorites without requiring a pre-existing enrichment state', async () => {
    const jobs: { task: string; payload: any; key: string }[] = [];
    const helpers = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM media m') && sql.includes("purpose='metadata'")) {
          return { rows: [{ mediaId: 'anime-1', type: 'ANIME' }] };
        }
        if (sql.includes('FROM media m JOIN bookmark_media_link') && sql.includes('c.media_id IS NULL')) {
          return { rows: [{ mediaId: 'manga-1', type: 'MANGA' }] };
        }
        if (sql.includes('graphile_worker.add_job')) {
          jobs.push({ task: String(values?.[0]), payload: JSON.parse(String(values?.[1])), key: String(values?.[2]) });
        }
        return { rows: [] };
      },
    };
    await sweep({}, helpers as any);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.payload.cover)).toEqual([undefined, true]);
    expect(jobs.every((job) => /:(metadata|cover):\d+$/.test(job.key))).toBe(true);
  });

  it('does not make a current terminal state due again without invalidation or a version bump', async () => {
    let dueSql = '';
    const helpers = {
      query: async (sql: string) => {
        if (sql.includes('FROM media m') && sql.includes("purpose='metadata'")) dueSql = sql;
        return { rows: [] };
      },
    };
    await sweep({}, helpers as any);
    expect(dueSql).toContain("es.status IN ('PENDING','FAILED','NO_MATCH')");
    expect(dueSql).toContain('es.attempt_count<$4::int');
    expect(dueSql).toContain('es.invalidated_at IS NOT NULL');
    expect(dueSql).not.toContain("es.status<>'SUCCESS'");
    expect(dueSql).not.toContain('mm.media_id IS NULL');
    expect(dueSql).toContain('EXISTS(SELECT 1 FROM bookmark_media_link l');
  });

  it('cleans merged empty projections and retries inconsistent success states',async()=>{
    const calls:string[]=[];
    const helpers={query:async(sql:string)=>{calls.push(sql);return {rows:[{media_id:'synthetic-source'}],rowCount:1};}};
    expect(await reconcileMergedEnrichment(helpers as any)).toEqual({cleaned:1,retried:1});
    expect(calls[0]).toContain('media_identity_merge');
    expect(calls[0]).toContain('available_position_number IS NULL');
    expect(calls[0]).toContain('NOT EXISTS(SELECT 1 FROM bookmark_media_link');
    expect(calls[1]).toContain("error_code='SUCCESS_PROJECTION_MISSING'");
    expect(calls[1]).toContain("status='ACTIVE'");
  });
});
