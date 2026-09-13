import { describe, expect, it } from 'vitest';
import { resumePublicReleaseFallback } from './public-release-fallback';
import type { PublicReleaseFallbackState, PublicReleaseFallbackStore, PublicReleasePageCheckpoint } from './public-release-fallback';

class MemoryStore implements PublicReleaseFallbackStore {
  state?: PublicReleaseFallbackState;
  promoted?: string;
  async begin(state: PublicReleaseFallbackState) { this.state = state; }
  async load() { return this.state; }
  async promote(generation: string) { this.promoted = generation; this.state = undefined; }
  async stage(generation: string, page: PublicReleasePageCheckpoint) {
    if (!this.state || this.state.generation !== generation) throw new Error('generation');
    const lane = page.complete ? { complete: true, nextPage: page.page, notBefore: 0 } : { complete: false, nextPage: page.nextPage!, notBefore: page.notBefore! };
    this.state = { ...this.state, lanes: { ...this.state.lanes, [page.provider]: lane } };
  }
}

describe('resumePublicReleaseFallback', () => {
  it('persists one page per wake and promotes only after both lanes complete', async () => {
    let time = Date.parse('2026-09-12T00:00:00.000Z');
    const store = new MemoryStore();
    const source = { collectPage: async (provider: 'anilist' | 'mangaupdates', page: number): Promise<PublicReleasePageCheckpoint> => provider === 'anilist' && page === 1
      ? { complete: false, events: [], nextPage: 2, notBefore: time + 2_200, page, provider }
      : { complete: true, events: [], page, provider } };
    const dependencies = { clock: () => time, source, store, token: () => 'generation-1' };
    const window = { from: '2026-09-12', to: '2026-10-17' };
    await expect(resumePublicReleaseFallback(dependencies, window)).resolves.toMatchObject({ state: 'progressed' });
    await expect(resumePublicReleaseFallback(dependencies, window)).resolves.toMatchObject({ nextWakeAt: time + 2_200, state: 'progressed' });
    expect(store.promoted).toBeUndefined();
    time += 2_200;
    await expect(resumePublicReleaseFallback(dependencies, window)).resolves.toEqual({ state: 'complete' });
    expect(store.promoted).toBe('generation-1');
  });

  it('does not call a provider before its durable continuation time', async () => {
    const time = Date.parse('2026-09-12T00:00:00.000Z');
    const store = new MemoryStore();
    store.state = { generation: 'generation-2', lanes: { anilist: { complete: false, nextPage: 3, notBefore: time + 5_000 }, mangaupdates: { complete: true, nextPage: 1, notBefore: 0 } }, startedAt: new Date(time).toISOString(), window: { from: '2026-09-12', to: '2026-10-17' } };
    let calls = 0;
    const result = await resumePublicReleaseFallback({ clock: () => time, source: { collectPage: async () => { calls += 1; throw new Error('unexpected'); } }, store }, store.state.window);
    expect(result).toEqual({ nextWakeAt: time + 5_000, state: 'waiting' });
    expect(calls).toBe(0);
  });
});
