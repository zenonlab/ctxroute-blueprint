import { describe, expect, it } from 'vitest';
import { WebExtensionPublicReleaseCacheAdapter } from './web-extension-release-cache-adapter';

const snapshot = {
  entries: [{ availability: 'official' as const, label: 'Épisode 2', occursAt: '2026-09-12T18:00:00.000Z', releaseId: 'release_2', workId: 'work_frieren' }],
  generatedAt: '2026-09-05T08:00:00.000Z', revision: '2026-09-05.1',
};
interface CacheFixture { value?: object }

describe('WebExtensionPublicReleaseCacheAdapter', () => {
  it('round-trips the strict public snapshot and ignores invalid cache data', async () => {
    const fixture: CacheFixture = {};
    const adapter = new WebExtensionPublicReleaseCacheAdapter({
      async get() { return { 'tobirink.public-releases.v1': fixture.value }; },
      async set(value) { fixture.value = value['tobirink.public-releases.v1']; },
    });
    await adapter.save(snapshot);
    await expect(adapter.load()).resolves.toEqual(snapshot);
    fixture.value = { ...snapshot, privateUserId: 'forbidden' };
    await expect(adapter.load()).resolves.toBeUndefined();
  });
});
