import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { agendaEntryId, createAgendaEntry, createFavoriteSource, createLibrary, createProgress, createReview, createWork, favoriteSourceId, libraryId, progressId, reviewId, workId } from '@tobirink/domain';
import { createWebBridgeRequestHandler } from './web-bridge-adapter';

const primaryLibraryId = libraryId('library_primary');

async function addResolvedWork(storage: MemoryStoragePort, input: { id: string; kind: 'anime' | 'manga'; title: string }) {
  const id = workId(input.id);
  const review = createReview({ id: reviewId(`review_${input.id.slice(5)}`), matchedWorkId: id, sourceLabel: input.title, status: 'resolved', title: input.title });
  await storage.putWork(createWork({ externalReferences: [], id, mediaKind: input.kind, preferredTitle: input.title }));
  await storage.putReview(review);
  await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: `bookmark-${input.id}`, folderPath: ['Bibliothèque'], id: favoriteSourceId(`source_${input.id.slice(5)}`), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: input.title, url: `https://reader.example/${input.id}` }));
  return id;
}

describe('WebBridge private projections', () => {
  it('applies normalized search, facet, cursor, progress and the 24-item limit', async () => {
    const storage = new MemoryStoragePort();
    const ids = [];
    ids.push(await addResolvedWork(storage, { id: 'work_etoile', kind: 'anime', title: 'L’Étoile du Nord' }));
    ids.push(await addResolvedWork(storage, { id: 'work_manga1', kind: 'manga', title: 'Étoile papier' }));
    for (let index = 0; index < 30; index += 1) ids.push(await addResolvedWork(storage, { id: `work_anime${index}`, kind: 'anime', title: `Anime ${index}` }));
    await storage.putLibrary(createLibrary(primaryLibraryId, ids));
    await storage.putProgress(createProgress({ id: progressId('progress_etoile'), kind: 'episode', maximum: 12, value: 3, workId: ids[0]! }));
    const handler = createWebBridgeRequestHandler(storage);
    const searched = await handler({ type: 'library.read', requestId: 'request_search', query: { facet: 'anime', limit: 24, search: 'etoile' } });
    expect(searched).toMatchObject({ hasMore: false, items: [{ mediaKind: 'anime', progressLabel: 'Épisode 3/12', sourceUrl: 'https://reader.example/work_etoile', title: 'L’Étoile du Nord' }] });
    const first = await handler({ type: 'library.read', requestId: 'request_page1', query: { facet: 'anime', limit: 24 } });
    expect(first).toMatchObject({ hasMore: true });
    if (!('items' in first) || !('cursor' in first)) throw new Error('expected-library-page');
    expect(first.items).toHaveLength(24);
    const second = await handler({ type: 'library.read', requestId: 'request_page2', query: { cursor: first.cursor, facet: 'anime', limit: 24 } });
    if (!('items' in second)) throw new Error('expected-library-page');
    expect(second.items).toHaveLength(7);
    await expect(handler({ type: 'library.read', requestId: 'request_bad_cursor', query: { cursor: 'work_missing', facet: 'all', limit: 24 } })).rejects.toThrow('invalid-library-cursor');
  });

  it('never reads Agenda during bootstrap and forwards an exact half-open local week', async () => {
    const storage = new MemoryStoragePort();
    const agendaSpy = vi.spyOn(storage, 'listAgendaEntries');
    const id = await addResolvedWork(storage, { id: 'work_weekly', kind: 'anime', title: 'Hebdomadaire' });
    await storage.putLibrary(createLibrary(primaryLibraryId, [id]));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_weekly'), occursAt: '2026-09-08T18:30:00.000Z', releaseLabel: 'Épisode 7', workId: id }));
    const handler = createWebBridgeRequestHandler(storage);
    await handler({ type: 'bootstrap.read', requestId: 'request_bootstrap' });
    expect(agendaSpy).not.toHaveBeenCalled();
    const period = await handler({ type: 'agenda.read', requestId: 'request_agenda', from: '2026-09-07', to: '2026-09-14' });
    expect(agendaSpy).toHaveBeenCalledWith({ from: expect.stringMatching(/^2026-09-0[67]T/u), limit: 100, to: expect.stringMatching(/^2026-09-1[34]T/u) });
    expect(period).toMatchObject({ entries: [{ availability: 'official', occursAt: '2026-09-08T18:30:00.000Z', releaseLabel: 'Épisode 7', sourceUrl: 'https://reader.example/work_weekly' }], from: '2026-09-07', to: '2026-09-14' });
  });

  it('caps the local library scan at 500 works', async () => {
    const storage = new MemoryStoragePort();
    const ids = Array.from({ length: 501 }, (_, index) => workId(`work_scan${String(index).padStart(4, '0')}`));
    await storage.putLibrary(createLibrary(primaryLibraryId, ids));
    const getWork = vi.spyOn(storage, 'getWork');
    await createWebBridgeRequestHandler(storage)({ type: 'library.read', requestId: 'request_cap', query: { facet: 'all', limit: 24 } });
    expect(getWork).toHaveBeenCalledTimes(500);
  });

  it('truncates a large Agenda projection below the transport ceiling', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_largeagenda');
    const review = createReview({ id: reviewId('review_largeagenda'), matchedWorkId: id, sourceLabel: 'Agenda', status: 'resolved', title: 'Agenda' });
    await storage.putWork(createWork({ externalReferences: [], id, mediaKind: 'anime', preferredTitle: 'Agenda volumineux' }));
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-large-agenda', folderPath: [], id: favoriteSourceId('source_largeagenda'), importedAt: '2026-09-06T00:00:00.000Z', order: 0, reviewId: review.id, title: 'Source locale', url: `https://reader.example/${'a'.repeat(1_700)}` }));
    for (let index = 0; index < 100; index += 1) {
      await storage.putAgendaEntry(createAgendaEntry({ availability: 'estimated', id: agendaEntryId(`agenda_large${String(index).padStart(3, '0')}`), occursAt: `2026-09-${String(7 + (index % 7)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`, releaseLabel: `Sortie ${index}`, workId: id }));
    }
    const period = await createWebBridgeRequestHandler(storage)({ type: 'agenda.read', requestId: 'request_large', from: '2026-09-07', to: '2026-09-14' });
    if (!('entries' in period)) throw new Error('expected-agenda-period');
    expect(period.entries.length).toBeLessThan(100);
    expect(new TextEncoder().encode(JSON.stringify(period)).byteLength).toBeLessThanOrEqual(60 * 1024);
  });
});
