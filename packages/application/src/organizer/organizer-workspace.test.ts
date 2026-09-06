import { createFavoriteSource, createOrganizerConfiguration, createReview, createWork, favoriteSourceId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { describe, expect, it } from 'vitest';
import { readOrganizerPreview, saveOrganizerConfiguration } from './organizer-workspace';

const configuration = createOrganizerConfiguration({
  folders: [{ conditions: { mediaTypes: ['MANGA'] }, id: 'manga', name: 'Manga' }],
  updatedAt: '2026-09-06T00:00:00.000Z',
});

describe('organizer workspace', () => {
  it('persists one validated configuration transactionally', async () => {
    const storage = new MemoryStoragePort();
    await saveOrganizerConfiguration(storage, configuration);
    await expect(storage.getOrganizerConfiguration()).resolves.toEqual(configuration);
  });

  it('builds a bounded preview from resolved private favorite sources', async () => {
    const storage = new MemoryStoragePort();
    const work = createWork({ externalReferences: [], id: workId('work_organizer'), mediaKind: 'manga', preferredTitle: 'Frieren' });
    const review = createReview({ id: reviewId('review_organizer'), matchedWorkId: work.id, sourceLabel: 'Source', status: 'resolved', title: 'Frieren' });
    const source = createFavoriteSource({ bookmarkId: 'bookmark-organizer', folderPath: ['Imports'], id: favoriteSourceId('source_organizer'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: 'Frieren', url: 'https://reader.example/frieren' });
    await storage.transaction(['works', 'reviews', 'favoriteSources'], async (session) => {
      await session.putWork(work);
      await session.putReview(review);
      await session.putFavoriteSource(source);
    });

    await expect(readOrganizerPreview(storage, configuration)).resolves.toMatchObject({
      inspectedCount: 1,
      items: [{ action: 'move', bookmarkId: 'bookmark-organizer', destination: ['Manga'], ruleId: 'manga' }],
      state: 'ready',
      truncated: false,
    });
  });

  it('keeps unresolved sources and unsupported metadata partial', async () => {
    const storage = new MemoryStoragePort();
    const review = createReview({ id: reviewId('review_pending-organizer'), sourceLabel: 'Source', status: 'pending', title: 'Unknown' });
    const source = createFavoriteSource({ bookmarkId: 'bookmark-pending', folderPath: [], id: favoriteSourceId('source_pending-organizer'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: 'Unknown', url: 'https://reader.example/unknown' });
    await storage.transaction(['reviews', 'favoriteSources'], async (session) => {
      await session.putReview(review);
      await session.putFavoriteSource(source);
    });
    const statusConfiguration = createOrganizerConfiguration({
      folders: [{ conditions: { editorialStatuses: ['Ongoing'] }, id: 'ongoing', name: 'En cours' }],
      updatedAt: '2026-09-06T00:00:00.000Z',
    });

    const snapshot = await readOrganizerPreview(storage, statusConfiguration);
    expect(snapshot.state).toBe('partial');
    expect(snapshot.items[0]).toMatchObject({ action: 'keep', reason: 'unrecognized' });
  });
});
