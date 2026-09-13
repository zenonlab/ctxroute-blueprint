import { describe, expect, it } from 'vitest';
import { collectPublicReleaseLanes } from './public-release-collectors';

const event = { id: 'anilist-1', provider: 'anilist' as const, providerWorkId: '1', releaseKind: 'episode' as const, occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T00:00:00.000Z' }, state: 'SCHEDULED' as const, provenance: { source: 'anilist', fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-09-14T00:00:00.000Z' };
describe('public release collectors', () => {
  it('isolates provider failures while retaining successful lane events', async () => {
    const result = await collectPublicReleaseLanes([{ provider: 'anilist', collect: async () => [event] }, { provider: 'mangaUpdates', collect: async () => { throw new Error('429'); } }], { from: '2026-09-12', to: '2026-09-28' });
    expect(result.events).toHaveLength(1); expect(result.failures[0]).toMatch(/^mangaUpdates:429$/u);
  });
});
