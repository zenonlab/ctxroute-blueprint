import { describe, expect, it, vi } from 'vitest';
import { AniListAgendaCollector, collectPublicAgendaLanes, MangaUpdatesAgendaCollector, type PublicAgendaPageCheckpoint } from './collectors.js';

const event = { id: 'anilist-1', provider: 'anilist' as const, providerWorkId: '1', releaseKind: 'episode' as const, occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T00:00:00.000Z' }, state: 'SCHEDULED' as const, provenance: { source: 'anilist', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-09-14T00:00:00.000Z' };

describe('public Agenda collectors', () => {
  it('isolates provider failures while retaining successful lane events', async () => {
    const result = await collectPublicAgendaLanes([{ provider: 'anilist', collect: async () => [event] }, { provider: 'mangaupdates', collect: async () => { throw new Error('429'); } }], { from: '2026-09-12', to: '2026-09-28' });
    expect(result.events).toHaveLength(1); expect(result.failures[0]).toBe('mangaupdates:429');
  });

  it('follows AniList pageInfo with the required pause and checkpoints', async () => {
    const pauses: number[] = []; const checkpoints: PublicAgendaPageCheckpoint[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { variables: { page: number } };
      return Response.json({ data: { Page: { airingSchedules: [{ airingAt: 1_800_000_000 + request.variables.page, episode: request.variables.page, media: { id: 700 } }], pageInfo: { hasNextPage: request.variables.page === 1 } } } });
    });
    const events = await new AniListAgendaCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }, async (checkpoint) => { checkpoints.push(checkpoint); }, () => 10_000).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(events.map((item) => item.sequence)).toEqual(['1', '2']); expect(pauses).toEqual([2_200]); expect(checkpoints).toHaveLength(2);
  });

  it('uses MangaUpdates response pagination and preserves textual chapters', async () => {
    const pages: number[] = []; const pauses: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { page: number }; pages.push(request.page);
      const results = request.page === 1 ? [{ metadata: { series: { series_id: 42 } }, record: { chapter: '58.5', id: 'a', release_date: '2026-09-13', volume: null } }] : [{ metadata: { series: { series_id: 43 } }, record: { chapter: '29-29.5 (end)', id: 'b', release_date: '2026-09-14', volume: null } }];
      return Response.json({ page: request.page, per_page: 1, results, total_hits: 2 });
    });
    const events = await new MangaUpdatesAgendaCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(events.map((item) => item.sequence)).toEqual(['58.5', '29-29.5 (end)']); expect(pages).toEqual([1, 2]); expect(pauses).toEqual([3_000]);
  });

  it('rejects an interrupted lane instead of publishing a partial generation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { page: number };
      return request.page === 1 ? Response.json({ page: 1, per_page: 1, results: [{ record: { chapter: 1, release_date: '2026-09-13' }, series_id: 42 }], total_hits: 2 }) : new Response('rate limited', { status: 429 });
    });
    await expect(new MangaUpdatesAgendaCollector(fetcher, async () => undefined).collect({ from: '2026-09-12', to: '2026-09-28' })).rejects.toThrow('mangaupdates-429');
  });
});
