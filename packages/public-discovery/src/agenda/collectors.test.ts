import { describe, expect, it, vi } from 'vitest';
import { AniListAgendaCollector, collectPublicAgendaLanes, MangaUpdatesAgendaCollector, type PublicAgendaPageCheckpoint } from './collectors.js';

const event = { id: 'anilist-1', provider: 'anilist' as const, providerWorkId: '1', releaseKind: 'episode' as const, occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T00:00:00.000Z' }, state: 'SCHEDULED' as const, provenance: { source: 'anilist', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-09-14T00:00:00.000Z' };

describe('public Agenda collectors', () => {
  it.each([
    ['CANCELLED', '2026-09-13T00:00:00.000Z', 'CANCELLED'],
    ['CANCELLED', '2026-09-11T00:00:00.000Z', 'SCHEDULED'],
    ['HIATUS', '2026-09-13T00:00:00.000Z', 'SCHEDULED'],
    [null, '2026-09-13T00:00:00.000Z', 'SCHEDULED'],
    [undefined, '2026-09-13T00:00:00.000Z', 'SCHEDULED'],
  ])('uses explicit future cancellation evidence only: %s at %s', async (status, instant, expected) => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      expect(String(init?.body)).toContain('media{id status}');
      return Response.json({ data: { Page: { airingSchedules: [{ airingAt: Date.parse(instant!) / 1000, episode: 1, media: { id: 700, status } }], pageInfo: { hasNextPage: false } } } });
    });
    const collected = await new AniListAgendaCollector(fetcher, async () => undefined, async () => undefined, () => Date.parse('2026-09-12T00:00:00.000Z')).collect({ from: '2026-09-11', to: '2026-09-28' });
    expect(collected.events).toMatchObject([{ state: expected, provenance: { fetchedAt: '2026-09-12T00:00:00.000Z', parserVersion: '3', rulesVersion: '3' } }]);
  });

  it('isolates provider failures while retaining successful lane events', async () => {
    const result = await collectPublicAgendaLanes([{ provider: 'anilist', collect: async () => ({ events: [event], received: 1, skippedUnidentified: 0 }) }, { provider: 'mangaupdates', collect: async () => { throw new Error('429'); } }], { from: '2026-09-12', to: '2026-09-28' });
    expect(result.events).toHaveLength(1); expect(result.failures[0]).toBe('mangaupdates:429');
  });

  it('follows AniList pageInfo with the required pause and checkpoints', async () => {
    const pauses: number[] = []; const checkpoints: PublicAgendaPageCheckpoint[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { variables: { page: number } };
      return Response.json({ data: { Page: { airingSchedules: [{ airingAt: 1_800_000_000 + request.variables.page, episode: request.variables.page, media: { id: 700 } }], pageInfo: { hasNextPage: request.variables.page === 1 } } } });
    });
    const result = await new AniListAgendaCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }, async (checkpoint) => { checkpoints.push(checkpoint); }, () => 10_000).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(result.events.map((item) => item.sequence)).toEqual(['1', '2']); expect(result).toMatchObject({ received: 2, skippedUnidentified: 0 }); expect(pauses).toEqual([3_000]); expect(checkpoints).toHaveLength(2);
    expect(checkpoints.map(({ page, received }) => ({ page, received }))).toEqual([{ page: 1, received: 1 }, { page: 2, received: 2 }]);
  });

  it('uses MangaUpdates response pagination and preserves textual chapters', async () => {
    const pages: number[] = []; const pauses: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { page: number }; pages.push(request.page);
      const results = request.page === 1 ? [{ metadata: { series: { series_id: 42 } }, record: { chapter: '58.5', id: 'a', release_date: '2026-09-13', volume: null } }] : [{ metadata: { series: { series_id: 43 } }, record: { chapter: '29-29.5 (end)', id: 'b', release_date: '2026-09-14', volume: null } }];
      return Response.json({ page: request.page, per_page: 1, results, total_hits: 2 });
    });
    const result = await new MangaUpdatesAgendaCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(result.events.map((item) => item.sequence)).toEqual(['58.5', '29-29.5 (end)']); expect(result).toMatchObject({ received: 2, skippedUnidentified: 0 }); expect(pages).toEqual([1, 2]); expect(pauses).toEqual([6_000]);
  });

  it('rejects an interrupted lane instead of publishing a partial generation', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { page: number };
      return request.page === 1 ? Response.json({ page: 1, per_page: 1, results: [{ record: { chapter: 1, release_date: '2026-09-13' }, series_id: 42 }], total_hits: 2 }) : new Response('rate limited', { status: 429 });
    });
    await expect(new MangaUpdatesAgendaCollector(fetcher, async () => undefined).collect({ from: '2026-09-12', to: '2026-09-28' })).rejects.toThrow('mangaupdates-429');
  });

  it('resumes on the requested page and carries forward provider counters', async () => {
    const pages: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the collector creates this request body and the test reads only its numeric page.
      const request = JSON.parse(String(init?.body)) as { page: number }; pages.push(request.page);
      return Response.json({ page: request.page, per_page: 40, results: [{ metadata: { series: { series_id: 42 } }, record: { chapter: '2', id: 'b', release_date: '2026-09-14', volume: null } }], total_hits: 41 });
    });
    const result = await new MangaUpdatesAgendaCollector(fetcher, async () => undefined).collect(
      { from: '2026-09-12', to: '2026-09-28' },
      { nextPage: 2, received: 40, skippedUnidentified: 1 },
    );
    expect(pages).toEqual([2]);
    expect(result).toMatchObject({ received: 41, skippedUnidentified: 1 });
  });

  it('exposes Retry-After as an absolute retry time', async () => {
    const fetcher = vi.fn(async () => new Response('busy', { headers: { 'Retry-After': '120' }, status: 429 }));
    const collector = new MangaUpdatesAgendaCollector(fetcher, async () => undefined, async () => undefined, () => 10_000);
    await expect(collector.collect({ from: '2026-09-12', to: '2026-09-28' })).rejects.toMatchObject({ message: 'mangaupdates-429', retryAt: 130_000 });
  });

  it('skips a MangaUpdates release that has no series identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      page: 1, per_page: 40, total_hits: 20,
      results: [
        { metadata: { series: { series_id: null } }, record: { chapter: '1', id: 10, release_date: '2026-09-13', volume: null } },
        ...Array.from({ length: 19 }, (_, index) => ({ metadata: { series: { series_id: 42 + index } }, record: { chapter: String(index + 2), id: 11 + index, release_date: '2026-09-13', volume: null } })),
      ],
    }));
    const result = await new MangaUpdatesAgendaCollector(fetcher, async () => undefined).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(result.events).toHaveLength(19);
    expect(result).toMatchObject({ received: 20, skippedUnidentified: 1 });
  });

  it('fails the MangaUpdates lane when more than five percent of rows lack a series identity', async () => {
    const fetcher = vi.fn(async () => Response.json({ page: 1, per_page: 40, total_hits: 1, results: [{ record: { chapter: '1', id: 10, release_date: '2026-09-13' } }] }));
    const checkpoint = vi.fn(async () => undefined);
    await expect(new MangaUpdatesAgendaCollector(fetcher, async () => undefined, checkpoint).collect({ from: '2026-09-12', to: '2026-09-28' })).rejects.toThrow('mangaupdates-unidentified-ratio:1/1');
    expect(checkpoint).not.toHaveBeenCalled();
  });
});
