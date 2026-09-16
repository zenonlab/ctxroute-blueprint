import { describe, expect, it, vi } from 'vitest';
import { AniListReleaseCollector, MangaUpdatesReleaseCollector, collectPublicReleaseLanes, digestPublicAgendaEvents } from './public-release-collectors';
import type { PublicReleasePageCheckpoint } from './public-release-collectors';

const event = { id: 'anilist-1', provider: 'anilist' as const, providerWorkId: '1', releaseKind: 'episode' as const, occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T00:00:00.000Z' }, state: 'SCHEDULED' as const, provenance: { source: 'anilist', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-09-14T00:00:00.000Z' };
describe('public release collectors', () => {
  it('uses a semantic digest that ignores observation timestamps', async () => {
    const later = { ...event, expiresAt: '2026-12-31T00:00:00.000Z', provenance: { ...event.provenance, fetchedAt: '2026-09-20T00:00:00.000Z' } };
    await expect(digestPublicAgendaEvents([event])).resolves.toBe(await digestPublicAgendaEvents([later]));
    await expect(digestPublicAgendaEvents([event])).resolves.not.toBe(await digestPublicAgendaEvents([{ ...later, occurrence: { kind: 'INSTANT', value: '2026-09-14T00:00:00.000Z' } }]));
  });

  it('isolates provider failures while retaining successful lane events', async () => {
    const result = await collectPublicReleaseLanes([{ provider: 'anilist', collect: async () => ({ events: [event], received: 1, skippedUnidentified: 0 }) }, { provider: 'mangaupdates', collect: async () => { throw new Error('429'); } }], { from: '2026-09-12', to: '2026-09-28' });
    expect(result.events).toHaveLength(1); expect(result.failures[0]).toMatch(/^mangaupdates:429$/u);
  });

  it('keeps the bounded upstream message when AniList returns a non-success response', async () => {
    const collector = new AniListReleaseCollector(async () => Response.json({ errors: [{ message: 'The AniList API has been temporarily disabled.' }] }, { status: 403 }));
    await expect(collector.collect({ from: '2026-09-12', to: '2026-09-20' })).rejects.toThrow('anilist-403:The AniList API has been temporarily disabled.');
  });

  it('follows AniList pageInfo and spaces every additional page', async () => {
    const pauses: number[] = [];
    const checkpoints: PublicReleasePageCheckpoint[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the body is produced by the collector under test and only its numeric page variable is inspected.
      const request = JSON.parse(String(init?.body)) as { variables: { page: number } };
      return Response.json({ data: { Page: { airingSchedules: [{ airingAt: 1_800_000_000 + request.variables.page, episode: request.variables.page, media: { id: 700 } }], pageInfo: { hasNextPage: request.variables.page === 1 } } } });
    });
    const result = await new AniListReleaseCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }, async (checkpoint) => { checkpoints.push(checkpoint); }, () => 10_000).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(result.events.map((item) => item.sequence)).toEqual(['1', '2']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pauses).toEqual([3_000]);
    expect(checkpoints.map(({ complete, nextPage, notBefore, page }) => ({ complete, nextPage, notBefore, page }))).toEqual([
      { complete: false, nextPage: 2, notBefore: 13_000, page: 1 },
      { complete: true, nextPage: undefined, notBefore: undefined, page: 2 },
    ]);
  });

  it('uses MangaUpdates response pagination and preserves textual chapters', async () => {
    const pauses: number[] = [];
    const requestedPages: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the body is produced by the collector under test and only its numeric page field is inspected.
      const request = JSON.parse(String(init?.body)) as { page: number };
      requestedPages.push(request.page);
      const results = request.page === 1
        ? [{ metadata: { series: { series_id: 42 } }, record: { chapter: '58.5', id: 'a', release_date: '2026-09-13' } }, { metadata: { series: { series_id: 43 } }, record: { chapter: '2a', id: 'b', release_date: '2026-09-13' } }]
        : [{ metadata: { series: { series_id: 44 } }, record: { chapter: '29-29.5 (end)', id: 'c', release_date: '2026-09-13' } }];
      return Response.json({ page: request.page, per_page: 2, results, total_hits: 3 });
    });
    const result = await new MangaUpdatesReleaseCollector(fetcher, async (milliseconds) => { pauses.push(milliseconds); }).collect({ from: '2026-09-12', to: '2026-09-28' });
    expect(result.events.map((item) => item.sequence)).toEqual(['58.5', '2a', '29-29.5 (end)']);
    expect(requestedPages).toEqual([1, 2]);
    expect(pauses).toEqual([6_000]);
  });

  it('rejects an interrupted lane instead of returning its first page', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      // SAFETY: the body is produced by the collector under test and only its numeric page field is inspected.
      const request = JSON.parse(String(init?.body)) as { page: number };
      return request.page === 1
        ? Response.json({ page: 1, per_page: 1, results: [{ record: { chapter: 1, release_date: '2026-09-13' }, series_id: 42 }], total_hits: 2 })
        : new Response('rate limited', { status: 429 });
    });
    await expect(new MangaUpdatesReleaseCollector(fetcher, async () => undefined).collect({ from: '2026-09-12', to: '2026-09-28' })).rejects.toThrow('mangaupdates-429');
  });
});
