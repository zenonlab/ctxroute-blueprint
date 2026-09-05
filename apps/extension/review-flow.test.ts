import { describe, expect, it } from 'vitest';
import { createWork, workId } from '../../packages/domain/src';
import { MemoryStoragePort } from '../../packages/contracts/src/memory-storage-port';
import { applyReviewDecision, resolveFavorite } from '../../packages/application/src/resolution';
import { normalizeBookmarks } from '../../packages/adapters-browser/src';

describe('review-flow', () => {
  it('persists every import state and enriches only resolved decisions', async () => {
    const storage = new MemoryStoragePort();
    const enriched: string[] = [];
    const enrichment = { enrich: async (work: { id: string }) => { enriched.push(work.id); } };
    const favorites = normalizeBookmarks([
      { bookmarkId: 'certain-1', title: 'Certain', url: 'https://example.test/certain' },
      { bookmarkId: 'ambiguous-1', title: 'Ambiguous', url: 'https://example.test/ambiguous' },
      { bookmarkId: 'offline-1', title: 'Offline', url: 'https://example.test/offline' },
      { bookmarkId: 'ignored-1', title: 'Folder', url: 'chrome://bookmarks' },
    ]);
    const certainWork = createWork({ externalReferences: [], id: workId('work_certain1'), mediaKind: 'anime', preferredTitle: 'Certain' });
    const resolver = { resolve: async (favorite: { title: string }) => favorite.title === 'Certain' ? { kind: 'certain' as const, work: certainWork } : favorite.title === 'Ambiguous' ? { kind: 'ambiguous' as const } : { kind: 'unavailable' as const } };
    const results = [];
    for (const favorite of favorites) results.push(await resolveFavorite(favorite, storage, resolver, enrichment));
    expect(results.map((result) => result.state)).toEqual(['resolved', 'review-required', 'unavailable', 'ignored']);
    const pending = results[1]?.review;
    expect(pending && await storage.getReview(pending.id)).toEqual(pending);
    expect(enriched).toEqual([certainWork.id]);
    const selected = createWork({ externalReferences: [], id: workId('work_selected1'), mediaKind: 'manga', preferredTitle: 'Selected' });
    if (!pending) throw new Error('Expected a persistent Review.');
    await applyReviewDecision(pending, selected, storage, enrichment);
    expect((await storage.getReview(pending.id))?.status).toBe('resolved');
    expect(enriched).toEqual([certainWork.id, selected.id]);
  });
});
