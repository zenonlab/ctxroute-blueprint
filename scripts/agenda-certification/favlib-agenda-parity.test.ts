import { describe, expect, it } from 'vitest';
import { HttpPublicReleasePageSource } from '../../packages/adapters-browser/src/releases/http-public-release-page-source';
import { resumePublicReleaseFallback } from '../../packages/application/src/agenda/public-release-fallback';
import type { PublicReleaseFallbackState, PublicReleaseFallbackStore, PublicReleasePageCheckpoint } from '../../packages/application/src/agenda/public-release-fallback';
import type { PublicReleaseEvent } from '../../packages/domain/src/release-events';
import { favlibAgendaVolume, pageLength } from './favlib-volume.fixture';

class RestartableStore implements PublicReleaseFallbackStore {
  state?: PublicReleaseFallbackState;
  readonly staged = new Map<string, PublicReleaseEvent>();
  promoted: readonly PublicReleaseEvent[] = [];
  async begin(state: PublicReleaseFallbackState) { this.state = state; this.staged.clear(); }
  async load() { return this.state; }
  async stage(generation: string, checkpoint: PublicReleasePageCheckpoint) {
    if (this.state?.generation !== generation) throw new Error('generation-mismatch');
    for (const event of checkpoint.events) this.staged.set(event.id, event);
    const lane = checkpoint.complete ? { complete: true, nextPage: checkpoint.page, notBefore: 0 } : { complete: false, nextPage: checkpoint.nextPage!, notBefore: checkpoint.notBefore! };
    this.state = { ...this.state, lanes: { ...this.state.lanes, [checkpoint.provider]: lane } };
  }
  async promote(generation: string) {
    if (this.state?.generation !== generation || !this.state.lanes.anilist.complete || !this.state.lanes.mangaupdates.complete) throw new Error('incomplete-generation');
    this.promoted = [...this.staged.values()]; this.state = undefined;
  }
}

function syntheticFetch(): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    // SAFETY: the request body is produced by the two source methods under test; the fixture reads only their numeric pagination fields.
    const request = JSON.parse(String(init?.body)) as { page?: number; variables?: { page: number } };
    if (url === 'https://graphql.anilist.co') {
      const page = request.variables!.page;
      const count = pageLength(favlibAgendaVolume.aniListReleases, favlibAgendaVolume.aniListPageSize, page);
      const offset = (page - 1) * favlibAgendaVolume.aniListPageSize;
      return Response.json({ data: { Page: { airingSchedules: Array.from({ length: count }, (_, index) => ({ airingAt: 1_789_171_200 + offset + index, episode: 1, media: { id: 10_000 + offset + index } })), pageInfo: { hasNextPage: offset + count < favlibAgendaVolume.aniListReleases } } } });
    }
    const page = request.page!;
    const count = pageLength(favlibAgendaVolume.mangaUpdatesReleases, favlibAgendaVolume.mangaUpdatesPageSize, page);
    const offset = (page - 1) * favlibAgendaVolume.mangaUpdatesPageSize;
    return Response.json({ page, per_page: favlibAgendaVolume.mangaUpdatesPageSize, total_hits: favlibAgendaVolume.mangaUpdatesReleases, results: Array.from({ length: count }, (_, index) => ({ metadata: { series: { series_id: 20_000 + offset + index } }, record: { chapter: `${offset + index + 1}.5`, id: 30_000 + offset + index, release_date: '2026-09-13' } })) });
  };
}

describe('FavLib Agenda volume parity', () => {
  it('resumes every provider page after a fresh MV3 instance and promotes one duplicate-free generation', async () => {
    const store = new RestartableStore();
    const fetcher = syntheticFetch();
    let clock = Date.parse('2026-09-13T00:00:00.000Z');
    let wakes = 0;
    for (; wakes < 100 && store.promoted.length === 0; wakes += 1) {
      const source = new HttpPublicReleasePageSource(fetcher, () => clock);
      const result = await resumePublicReleaseFallback({ clock: () => clock, source, store, token: () => 'favlib-volume' }, { from: '2026-09-12', to: '2026-09-28' });
      if (result.nextWakeAt !== undefined && result.nextWakeAt > clock) clock = result.nextWakeAt;
    }
    expect(wakes).toBe(43);
    expect(store.promoted).toHaveLength(favlibAgendaVolume.aniListReleases + favlibAgendaVolume.mangaUpdatesReleases);
    expect(new Set(store.promoted.map((event) => event.id)).size).toBe(store.promoted.length);
    expect(store.promoted.filter((event) => event.provider === 'anilist')).toHaveLength(1_501);
    expect(store.promoted.filter((event) => event.provider === 'mangaupdates')).toHaveLength(466);
    expect(store.promoted.find((event) => event.provider === 'mangaupdates')).toMatchObject({ occurrence: { kind: 'DATE' }, sequence: '1.5' });
  });
});
