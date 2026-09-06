import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createOrganizerConfiguration, createReview, createWork, favoriteSourceId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { applyConfirmedOrganizerPreview, restoreConfirmedOrganizerSnapshot } from './organizer-projection';

const configuration = createOrganizerConfiguration({ folders: [{ conditions: { mediaTypes: ['MANGA'] }, id: 'manga', name: 'Manga' }], updatedAt: '2026-09-06T00:00:00.000Z' });

async function fixture() {
  const storage = new MemoryStoragePort();
  const work = createWork({ externalReferences: [], id: workId('work_projection'), mediaKind: 'manga', preferredTitle: 'Frieren' });
  const review = createReview({ id: reviewId('review_projection'), matchedWorkId: work.id, sourceLabel: 'Source', status: 'resolved', title: 'Frieren' });
  const source = createFavoriteSource({ bookmarkId: 'bookmark-projection', folderPath: ['Imports'], id: favoriteSourceId('source_projection'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: 'Frieren', url: 'https://reader.example/frieren' });
  await storage.transaction(['works', 'reviews', 'favoriteSources'], async (session) => { await session.putWork(work); await session.putReview(review); await session.putFavoriteSource(source); });
  return storage;
}

describe('confirmed organizer projection', () => {
  it('persists and verifies a snapshot before moving a fresh preview', async () => {
    const storage = await fixture();
    const expected = await (await import('./organizer-workspace')).readOrganizerPreview(storage, configuration);
    const events: string[] = [];
    const snapshot = { capturedAt: '2026-09-06T10:00:00.000Z', format: 'tobirink-organizer-bookmarks' as const, nodes: [], version: 1 as const };
    let saved: typeof snapshot | undefined;
    const result = await applyConfirmedOrganizerPreview({
      bookmarks: { applyMoves: async () => { events.push('move'); return { moved: 1, skipped: 0 }; }, captureSnapshot: async () => { events.push('capture'); return snapshot; }, restoreSnapshot: async () => ({ restored: 0, skipped: 0 }) },
      snapshots: { load: async () => saved, save: async (value) => { events.push('save'); saved = value; } },
      storage,
    }, { configuration, confirmation: 'apply-organizer-preview', expected, now: snapshot.capturedAt });
    expect(result).toEqual({ moved: 1, skipped: 0 });
    expect(events).toEqual(['capture', 'save', 'move']);
  });

  it('rejects missing confirmation and stale previews before snapshot or mutation', async () => {
    const storage = await fixture();
    let touched = false;
    const dependencies = {
      bookmarks: { applyMoves: async () => { touched = true; return { moved: 0, skipped: 0 }; }, captureSnapshot: async () => { touched = true; throw new Error('forbidden'); }, restoreSnapshot: async () => ({ restored: 0, skipped: 0 }) },
      snapshots: { load: async () => undefined, save: async () => { touched = true; } }, storage,
    };
    const expected = await (await import('./organizer-workspace')).readOrganizerPreview(storage, configuration);
    await expect(applyConfirmedOrganizerPreview(dependencies, { configuration, confirmation: 'no', expected, now: '2026-09-06T10:00:00.000Z' })).rejects.toThrow('confirmation');
    await expect(applyConfirmedOrganizerPreview(dependencies, { configuration, confirmation: 'apply-organizer-preview', expected: { ...expected, inspectedCount: 0 }, now: '2026-09-06T10:00:00.000Z' })).rejects.toThrow('stale');
    expect(touched).toBe(false);
  });

  it('restores only after confirmation from the verified local snapshot', async () => {
    const snapshot = { capturedAt: '2026-09-06T10:00:00.000Z', format: 'tobirink-organizer-bookmarks' as const, nodes: [], version: 1 as const };
    let restored = false;
    const dependencies = { bookmarks: { applyMoves: async () => ({ moved: 0, skipped: 0 }), captureSnapshot: async () => snapshot, restoreSnapshot: async () => { restored = true; return { restored: 2, skipped: 1 }; } }, snapshots: { load: async () => snapshot, save: async () => undefined } };
    await expect(restoreConfirmedOrganizerSnapshot(dependencies, 'no')).rejects.toThrow('confirmation');
    expect(restored).toBe(false);
    await expect(restoreConfirmedOrganizerSnapshot(dependencies, 'restore-organizer-snapshot')).resolves.toEqual({ restored: 2, skipped: 1 });
  });
});
