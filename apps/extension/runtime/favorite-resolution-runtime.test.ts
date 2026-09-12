import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { libraryId } from '@tobirink/domain';
import { createFavoriteResolutionRuntime, recordFavoriteBookmarkMutation } from './favorite-resolution-runtime';
import type { ExtensionDiagnosticInput } from './extension-diagnostics';

const unavailable = { search: async () => { throw new Error('unused'); } };
const noHydration = { hydrate: async () => undefined };
const unavailableCandidates = { anilist: unavailable, 'kitsu-anime': unavailable, 'kitsu-manga': unavailable, mangadex: unavailable, mangaupdates: unavailable } as const;
const emptyHydration = { anilist: noHydration, 'kitsu-anime': noHydration, 'kitsu-manga': noHydration, mangadex: noHydration, mangaupdates: noHydration } as const;

function resolutionTaskId(bookmarkId: string): string {
  const hexadecimal = [...new TextEncoder().encode(bookmarkId)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const encoded = `${hexadecimal.length.toString(36)}_${hexadecimal}`.padEnd(6, '0');
  return `favorite-resolution_${encoded}`;
}

describe('createFavoriteResolutionRuntime', () => {
  it.each(['PENDING', 'RETRYABLE'] as const)('continues bounded resolution while identity restoration is %s', async (status) => {
    const prepare = vi.fn(async (): Promise<'READY' | 'PENDING' | 'RETRYABLE'> => 'READY').mockResolvedValueOnce(status);
    const publish = vi.fn(async () => ({ kind: 'UNCHANGED' as const }));
    const claimNext = vi.fn(async () => undefined);
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch: async () => ({ complete: true, records: [] }) }, candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 11 }), hydration: emptyHydration, identityRecovery: { prepare, publish },
      libraryId: libraryId('library_primary'), now: () => '2026-09-08T00:00:00.000Z', outbox: { block: vi.fn(), claimNext, retry: vi.fn() },
      sourceAdapters: [], storage: new MemoryStoragePort(), token: () => 'recovery-token',
    });
    await reconcile();
    expect(claimNext).toHaveBeenCalledOnce(); expect(publish).toHaveBeenCalledOnce();
    await reconcile();
    expect(claimNext).toHaveBeenCalledTimes(2); expect(publish).toHaveBeenCalledTimes(2);
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(claimNext.mock.invocationCallOrder[0] ?? 0);
    expect(claimNext.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0] ?? 0);
  });
  it('persists the latest bookmark mutation before requesting convergence', async () => {
    const storage = new MemoryStoragePort();
    const ensureReady = vi.fn(async () => ({ schemaVersion: 8 }));
    const reconcile = vi.fn(async () => undefined);
    await recordFavoriteBookmarkMutation(
      { ensureReady, now: () => '2026-09-07T12:00:00.000Z', storage, token: () => 'mutation-sequence' },
      { bookmarkId: 'bookmark-1', kind: 'changed' },
      reconcile,
    );
    expect(await storage.getFavoriteBookmarkMutation('bookmark-1')).toEqual({
      bookmarkId: 'bookmark-1',
      kind: 'changed',
      recordedAt: '2026-09-07T12:00:00.000Z',
      sequence: 'mutation-sequence',
    });
    expect(ensureReady).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('Q-03 coalesces concurrent reconciliation requests', async () => {
    let release: (() => void) | undefined;
    const imported = new Promise<void>((resolve) => { release = resolve; });
    const readBookmarkBatch = vi.fn(async () => { await imported; return { complete: true, records: [] as const }; });
    const storage = new MemoryStoragePort();
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch },
      candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 6 }),
      hydration: emptyHydration,
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
    expect(readBookmarkBatch).toHaveBeenCalledTimes(1);
  });

  it('runs one bounded follow-up pass for a bookmark mutation during reconciliation', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const firstImport = new Promise<void>((resolve) => { release = resolve; });
    const readBookmarkBatch = vi.fn(async () => { calls += 1; if (calls === 1) await firstImport; return { complete: true, records: [] as const }; });
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch }, candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 6 }), hydration: emptyHydration,
      libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() }, sourceAdapters: [],
      storage: new MemoryStoragePort(), token: () => 'token',
    });
    const active = reconcile();
    expect(reconcile(true)).toBe(active);
    release?.();
    await active;
    expect(readBookmarkBatch).toHaveBeenCalledTimes(2);
  });

  it('Q-04 and B-05 resume the persisted inventory cursor after an interrupted slice while preserving the prior projection', async () => {
    const storage = new MemoryStoragePort();
    const cursor = { frames: [{ folderId: '0', folderPath: [], nextChildIndex: 1 }], rootId: '0' } as const;
    const firstReader = vi.fn()
      .mockResolvedValueOnce({ complete: false, cursor, records: [{ bookmarkId: 'first', folderPath: [], order: 0, title: 'First', url: 'https://reader.example/manga/first' }] })
      .mockRejectedValueOnce(new Error('suspended'));
    const dependencies = {
      candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 7 }),
      hydration: emptyHydration,
      libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: vi.fn(async () => undefined), retry: vi.fn() }, sourceAdapters: [], storage, token: () => 'inventory-session',
    } as const;
    await expect(createFavoriteResolutionRuntime({ ...dependencies, bookmarks: { readBookmarkBatch: firstReader } })()).rejects.toThrow('suspended');
    expect(dependencies.outbox.claimNext).toHaveBeenCalledOnce();
    expect(await storage.getFavoriteInventoryCheckpoint()).toMatchObject({ cursor, sessionId: 'inventory-session', status: 'active' });

    const resumedReader = vi.fn(async () => ({ complete: true, records: [] as const }));
    await createFavoriteResolutionRuntime({ ...dependencies, bookmarks: { readBookmarkBatch: resumedReader } })();
    expect(resumedReader).toHaveBeenCalledWith(cursor, 100);
    expect(await storage.getFavoriteInventoryCheckpoint()).toMatchObject({ sessionId: 'inventory-session', status: 'complete' });
    expect((await storage.listFavoriteSources({ limit: 10 }))[0]?.presence).toBe('observed');
  });

  it('B-04 completes an empty inventory without creating private data', async () => {
    const storage = new MemoryStoragePort();
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch: async () => ({ complete: true, records: [] }) },
      candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 8 }), hydration: emptyHydration,
      libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:00:00.000Z', outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() }, sourceAdapters: [], storage, token: () => 'empty-session',
    });
    await expect(reconcile()).resolves.toBeUndefined();
    expect(await storage.getFavoriteInventoryCheckpoint()).toMatchObject({ sessionId: 'empty-session', status: 'complete' });
    await expect(storage.listFavoriteSources({ limit: 1 })).resolves.toEqual([]);
  });

  it('records only bounded lifecycle counters for a completed run', async () => {
    const events: ExtensionDiagnosticInput[] = [];
    const record = async (event: ExtensionDiagnosticInput) => { events.push(event); };
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch: async () => ({ complete: true, records: [] }) },
      candidates: unavailableCandidates,
      diagnostics: { record },
      ensureReady: async () => ({ schemaVersion: 12 }),
      hydration: emptyHydration,
      libraryId: libraryId('library_primary'),
      now: () => '2026-09-12T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() },
      sourceAdapters: [],
      storage: new MemoryStoragePort(),
      token: () => 'diagnostic-run',
    });
    await reconcile();
    expect(events).toEqual([
      { outcome: 'started', runId: 'diagnostic-run', stage: 'run' },
      { counts: { batches: 1, observed: 0 }, outcome: 'complete', runId: 'diagnostic-run', stage: 'inventory' },
      { counts: { blocked: 0, completed: 0, retried: 0 }, outcome: 'complete', runId: 'diagnostic-run', stage: 'resolution' },
      { outcome: 'complete', runId: 'diagnostic-run', stage: 'run' },
    ]);
  });

  it('closes ordinary links during import so a later media slug remains ready in a noisy inventory', async () => {
    const storage = new MemoryStoragePort();
    const ordinary = Array.from({ length: 100 }, (_, index) => ({
      bookmarkId: `ordinary-${index}`,
      folderPath: [],
      order: index,
      title: `Ordinary video ${index}`,
      url: `https://www.youtube.com/watch?v=fixture-${index}`,
    }));
    const media = { bookmarkId: 'media-frieren', folderPath: ['Anime'], order: 100, title: 'Frieren', url: 'https://reader.example/anime/frieren' };
    const readBookmarkBatch = vi.fn()
      .mockResolvedValueOnce({ complete: false, cursor: { frames: [{ folderId: '0', folderPath: [], nextChildIndex: 100 }], rootId: '0' }, records: ordinary })
      .mockResolvedValueOnce({ complete: true, records: [media] });
    const reconcile = createFavoriteResolutionRuntime({
      bookmarks: { readBookmarkBatch }, candidates: unavailableCandidates,
      ensureReady: async () => ({ schemaVersion: 8 }), hydration: emptyHydration,
      libraryId: libraryId('library_primary'), now: () => '2026-09-07T12:00:00.000Z',
      outbox: { block: vi.fn(), claimNext: async () => undefined, retry: vi.fn() }, sourceAdapters: [], storage, token: () => 'noisy-session',
    });

    await reconcile();

    for (const favorite of ordinary) {
      await expect(storage.getFavoriteResolutionTask(resolutionTaskId(favorite.bookmarkId))).resolves.toMatchObject({ state: 'COMMITTED' });
    }
    await expect(storage.getFavoriteResolutionTask(resolutionTaskId(media.bookmarkId))).resolves.toMatchObject({ state: 'READY' });
    await expect(storage.listReviews({ limit: 100, status: 'pending' })).resolves.toEqual([]);
  });
});
