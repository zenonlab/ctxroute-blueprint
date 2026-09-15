import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { libraryId } from '@tobirink/domain';
import { createFavoriteResolutionRuntime } from './favorite-resolution-runtime';

describe('Public Discovery provider boundary', () => {
  it('does not restore identities or repair covers through providers', async () => {
    const hydrate = vi.fn(async () => undefined);
    const search = vi.fn(async () => { throw new Error('provider-search-must-not-run'); });
    const candidates = { anilist: { search }, 'kitsu-anime': { search }, 'kitsu-manga': { search }, mangadex: { search }, mangaupdates: { search } } as const;
    const hydration = { anilist: { hydrate }, 'kitsu-anime': { hydrate }, 'kitsu-manga': { hydrate }, mangadex: { hydrate }, mangaupdates: { hydrate } } as const;
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch: async () => ({ complete: true, records: [] }) }, candidates,
      ensureReady: async () => ({ schemaVersion: 19 }), hydration,
      libraryId: libraryId('library_primary'), now: () => '2026-09-12T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, nextAvailableAt: async () => undefined, retry: vi.fn() },
      publicDiscovery: { resolveOrRequest: async () => ({ retryAt: '2026-09-12T12:01:00.000Z', state: 'PENDING' as const }) },
      sourceAdapters: [], storage: new MemoryStoragePort(), token: () => 'd1-first-run',
    });
    await reconcile();
    expect(hydrate).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
  });
});
