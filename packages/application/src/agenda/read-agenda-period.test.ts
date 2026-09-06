import { describe, expect, it } from 'vitest';
import { agendaEntryId, createAgendaEntry, createFavoriteSource, createReview, createWork, favoriteSourceId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { readAgendaPeriod } from './read-agenda-period';

describe('readAgendaPeriod', () => {
  it('joins bounded ordered entries and reports missing works', async () => {
    const storage = new MemoryStoragePort();
    const presentId = workId('work_agenda-present');
    const missingId = workId('work_agenda-missing');
    await storage.putWork(createWork({ externalReferences: [], id: presentId, mediaKind: 'anime', preferredTitle: 'Present' }));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_present'), occursAt: '2026-09-07T10:00:00.000Z', releaseLabel: 'Episode 1', workId: presentId }));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'estimated', id: agendaEntryId('agenda_missing'), occursAt: '2026-09-08T10:00:00.000Z', releaseLabel: 'Episode 2', workId: missingId }));

    const snapshot = await readAgendaPeriod(storage, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' });
    expect(snapshot.items.map(({ work }) => work.id)).toEqual([presentId]);
    expect(snapshot.missingWorkIds).toEqual([missingId]);
  });

  it('selects the first ordered source while preserving multiple resolved favorites', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_agenda-sources');
    const listReviewsByWorkId = storage.listReviewsByWorkId.bind(storage);
    let sourceReads = 0;
    storage.listReviewsByWorkId = async (query) => {
      sourceReads += 1;
      return listReviewsByWorkId(query);
    };
    const laterReview = createReview({ id: reviewId('review_source-later'), matchedWorkId: id, sourceLabel: 'Later', status: 'resolved', title: 'Sources' });
    const firstReview = createReview({ id: reviewId('review_source-first'), matchedWorkId: id, sourceLabel: 'First', status: 'resolved', title: 'Sources' });
    await storage.transaction(['works', 'agenda', 'reviews', 'favoriteSources'], async (session) => {
      await session.putWork(createWork({ externalReferences: [], id, mediaKind: 'manga', preferredTitle: 'Sources' }));
      await session.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_sources'), occursAt: '2026-09-09T10:00:00.000Z', releaseLabel: 'Chapter 1', workId: id }));
      await session.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_sources-two'), occursAt: '2026-09-10T10:00:00.000Z', releaseLabel: 'Chapter 2', workId: id }));
      await session.putReview(laterReview);
      await session.putReview(firstReview);
      await session.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-later', folderPath: ['B'], id: favoriteSourceId('source_later1'), importedAt: '2026-09-05T20:00:00.000Z', order: 0, reviewId: laterReview.id, title: 'Sources', url: 'https://reader.example/later' }));
      await session.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-first', folderPath: ['A'], id: favoriteSourceId('source_first1'), importedAt: '2026-09-05T20:00:00.000Z', order: 2, reviewId: firstReview.id, title: 'Sources', url: 'https://reader.example/first' }));
    });

    const snapshot = await readAgendaPeriod(storage, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' });
    expect(snapshot.items[0]?.source?.url).toBe('https://reader.example/first');
    expect(sourceReads).toBe(1);
    expect(await storage.listReviewsByWorkId({ limit: 100, workId: id })).toHaveLength(2);
  });

  it('uses a half-open period and rejects invalid bounds', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_agenda-boundary');
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'confirmed', id: agendaEntryId('agenda_boundary'), occursAt: '2026-09-14T00:00:00.000Z', releaseLabel: 'Boundary', workId: id }));
    await expect(readAgendaPeriod(storage, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' })).resolves.toEqual({ items: [], missingWorkIds: [] });
    await expect(readAgendaPeriod(storage, { from: 'invalid', to: '2026-09-14T00:00:00.000Z' })).rejects.toThrow(/canonical ISO/u);
  });
});
