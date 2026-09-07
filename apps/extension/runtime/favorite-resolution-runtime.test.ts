import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { libraryId } from '@tobirink/domain';
import { createFavoriteResolutionRuntime } from './favorite-resolution-runtime';

describe('createFavoriteResolutionRuntime', () => {
  it('coalesces concurrent reconciliation requests', async () => {
    let release: (() => void) | undefined;
    const imported = new Promise<void>((resolve) => { release = resolve; });
    const importBookmarks = vi.fn(async () => { await imported; return []; });
    const unavailable = { search: async () => { throw new Error('unused'); } };
    const noHydration = { hydrate: async () => undefined };
    const storage = new MemoryStoragePort();
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { importBookmarks },
      candidates: { anilist: unavailable, mangaupdates: unavailable },
      ensureReady: async () => ({ schemaVersion: 6 }),
      hydration: { anilist: noHydration, mangaupdates: noHydration },
      libraryId: libraryId('library_primary'),
      now: () => '2026-09-07T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() },
      sourceAdapters: [],
      storage,
      token: () => 'token',
    });
    const first = reconcile();
    const second = reconcile();
    expect(first).toBe(second);
    release?.();
    await first;
    expect(importBookmarks).toHaveBeenCalledTimes(1);
  });

  it('runs one bounded follow-up pass for a bookmark mutation during reconciliation', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const firstImport = new Promise<void>((resolve) => { release = resolve; });
    const importBookmarks = vi.fn(async () => { calls += 1; if (calls === 1) await firstImport; return []; });
    const unavailable = { search: async () => { throw new Error('unused'); } };
    const noHydration = { hydrate: async () => undefined };
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { importBookmarks }, candidates: { anilist: unavailable, mangaupdates: unavailable },
      ensureReady: async () => ({ schemaVersion: 6 }), hydration: { anilist: noHydration, mangaupdates: noHydration },
      libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() }, sourceAdapters: [],
      storage: new MemoryStoragePort(), token: () => 'token',
    });
    const active = reconcile();
    expect(reconcile(true)).toBe(active);
    release?.();
    await active;
    expect(importBookmarks).toHaveBeenCalledTimes(2);
  });
});
