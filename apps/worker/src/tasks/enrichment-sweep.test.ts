import { describe, expect, it } from 'vitest';
import sweep from './enrichment-sweep.js';

describe('enrichment sweep', () => {
  it('repairs linked favorites without requiring a pre-existing enrichment state', async () => {
    const jobs: { task: string; payload: any; key: string }[] = [];
    const helpers = {
      query: async (sql: string, values?: unknown[]) => {
        if (sql.includes('FROM media m JOIN bookmark_media_link') && sql.includes('mm.media_id IS NULL')) {
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
        if (sql.includes('FROM media m JOIN bookmark_media_link') && sql.includes("purpose='metadata'")) dueSql = sql;
        return { rows: [] };
      },
    };
    await sweep({}, helpers as any);
    expect(dueSql).toContain("es.status IN ('PENDING','FAILED','NO_MATCH')");
    expect(dueSql).toContain('es.attempt_count<$4::int');
    expect(dueSql).toContain('es.invalidated_at IS NOT NULL');
    expect(dueSql).not.toContain("es.status<>'SUCCESS'");
  });
});
