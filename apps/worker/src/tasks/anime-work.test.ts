import { describe, expect, it, vi } from 'vitest';
import { recordAndReconcileAnimeWork } from './anime-work.js';

describe('anime work PostgreSQL contract', () => {
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
