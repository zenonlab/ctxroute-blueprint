import { describe, expect, it, vi } from 'vitest';
import { MemoryStoragePort } from '@tobirink/contracts';
import { importFavoriteSources } from '@tobirink/application';
import type { FavoriteSourceAdapter } from '@tobirink/application';
import { agendaEntryId, createAgendaEntry, createFavoriteSource, createLibrary, createProgress, createReview, createSourceEvidence, createWork, favoriteSourceId, libraryId, progressId, reviewId, workId } from '@tobirink/domain';
import { createWebBridgeRequestHandler } from './web-bridge-adapter';

const primaryLibraryId = libraryId('library_primary');

async function addResolvedWork(storage: MemoryStoragePort, input: { id: string; kind: 'anime' | 'manga'; title: string }) {
  const id = workId(input.id);
  await storage.putWork(createWork({ externalReferences: [], id, mediaKind: input.kind, preferredTitle: input.title }));
  await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: `bookmark-${input.id}`, folderPath: ['Bibliothèque'], id: favoriteSourceId(`source_${input.id.slice(5)}`), importedAt: '2026-09-06T00:00:00.000Z', matchedWorkId: id, order: 0, resolution: { kind: 'RESOLVED' }, title: input.title, url: `https://reader.example/${input.id}` }));
  return id;
}

describe('WebBridge private projections', () => {
  it('projects Review covers and the controlled provider fallback through WebBridge', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ bookmarkId: 'review-cover', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic cover', url: 'https://reader.example/anime/synthetic-cover' }], storage, '2026-09-08T00:00:00.000Z');
    const source = (await storage.listFavoriteSources({ limit: 1 }))[0];
    if (source === undefined) throw new Error('Missing source');
    const review = createReview({ id: reviewId('review_web_cover'), reason: 'AMBIGUOUS', sourceLabel: source.url, status: 'pending', title: source.title });
    await storage.putReview(review);
    await storage.putFavoriteSource(createFavoriteSource({ ...source, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' }, reviewId: review.id }));
    const candidate = { canonicalUrl: 'https://anilist.co/anime/1', cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg' }, externalId: '1', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic cover'] };
    await storage.putFavoriteReviewCandidateSet({ candidates: [candidate, { ...candidate, canonicalUrl: 'https://kitsu.app/anime/2', externalId: '2', provider: 'kitsu-anime' }], digest: 'review-web-cover', recordedAt: '2026-09-08T00:00:00.000Z', reviewId: review.id });
    const snapshot = await createWebBridgeRequestHandler(storage)({ type: 'review.read', requestId: 'request_review_cover' });
    if (!('candidates' in snapshot)) throw new Error('Missing Review candidates');
    expect(snapshot.candidates[0]).toMatchObject({ coverFallbackSrc: 'https://tobirink.com/v1/media/provider-covers/anilist/1/cover-md', coverSrc: candidate.cover.url });
  });

  it('applies normalized search, facet, cursor, progress and the 24-item limit', async () => {
    const storage = new MemoryStoragePort();
    const ids = [];
    ids.push(await addResolvedWork(storage, { id: 'work_etoile', kind: 'anime', title: 'L’Étoile du Nord' }));
    await storage.putWork(createWork({
      externalReferences: [{ externalId: '1', provider: 'anilist' }], id: ids[0]!, mediaKind: 'anime', preferredTitle: 'L’Étoile du Nord',
      hydration: {
        candidate: {
          canonicalUrl: 'https://anilist.co/anime/1', cover: { attribution: 'AniList', url: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg' },
          displayTitle: 'L’Étoile du Nord', editorialStatus: 'ONGOING', episodeCount: 12, externalId: '1', format: 'TV', genres: ['Fantasy'], mediaKind: 'ANIME', metadataVersion: 2,
          popularity: { kind: 'MEMBERS', value: 100 }, preSerialization: false, provider: 'anilist', startYear: 2025,
          titleVariants: [{ language: 'fr', title: 'L’Étoile du Nord' }], titles: ['L’Étoile du Nord'],
        },
        favoriteAliasKeys: [], hydratedAt: '2026-09-06T00:00:00.000Z', matcherVersion: 'favorite-matcher-v2', providerTitleKeys: ['l etoile du nord'],
      },
    }));
    ids.push(await addResolvedWork(storage, { id: 'work_manga1', kind: 'manga', title: 'Étoile papier' }));
    for (let index = 0; index < 30; index += 1) ids.push(await addResolvedWork(storage, { id: `work_anime${index}`, kind: 'anime', title: `Anime ${index}` }));
    await storage.putLibrary(createLibrary(primaryLibraryId, ids));
    await storage.putProgress(createProgress({ id: progressId('progress_etoile'), kind: 'episode', maximum: 12, value: 3, workId: ids[0]! }));
    const handler = createWebBridgeRequestHandler(storage);
    const searched = await handler({ type: 'library.read', requestId: 'request_search', query: { facet: 'anime', limit: 24, search: 'etoile', sort: 'ADDED_DESC' } });
    expect(searched).toMatchObject({
      facets: { genre: [{ count: 1, label: 'Fantasy', value: 'fantasy' }], status: [{ count: 1, label: 'En cours', value: 'ONGOING' }] },
      hasMore: false,
      items: [{ canonicalUrl: 'https://anilist.co/anime/1', coverAttribution: 'AniList', coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/example.jpg', mediaKind: 'anime', progress: { kind: 'episode', maximum: 12, value: 3 }, progressLabel: 'Épisode 3/12', provider: 'anilist', sourceUrl: 'https://reader.example/work_etoile', startYear: 2025, title: 'L’Étoile du Nord' }],
      statistics: { knownMetadata: 1, total: 32 }, total: 1, truncated: false,
    });
    const faceted = await handler({ type: 'library.read', requestId: 'request_facets', query: { facet: 'all', facets: { genre: { fantasy: 'include' }, type: { ANIME: 'include', MANGA: 'exclude' } }, limit: 24, sort: 'POPULARITY_DESC' } });
    expect(faceted).toMatchObject({ facets: { genre: [{ value: 'fantasy' }] }, items: [{ title: 'L’Étoile du Nord' }], total: 1 });
    const first = await handler({ type: 'library.read', requestId: 'request_page1', query: { facet: 'anime', limit: 24, sort: 'ADDED_DESC' } });
    expect(first).toMatchObject({ hasMore: true });
    if (!('items' in first) || !('cursor' in first)) throw new Error('expected-library-page');
    expect(first.items).toHaveLength(24);
    const second = await handler({ type: 'library.read', requestId: 'request_page2', query: { cursor: first.cursor, facet: 'anime', limit: 24, sort: 'ADDED_DESC' } });
    if (!('items' in second)) throw new Error('expected-library-page');
    expect(second.items).toHaveLength(7);
    await expect(handler({ type: 'library.read', requestId: 'request_bad_cursor', query: { cursor: 'work_missing', facet: 'all', limit: 24, sort: 'ADDED_DESC' } })).rejects.toThrow('invalid-library-cursor');
  });

  it('never reads Agenda during bootstrap and forwards an exact half-open local week', async () => {
    const storage = new MemoryStoragePort();
    const agendaSpy = vi.spyOn(storage, 'listAgendaEntries');
    const sourceScanSpy = vi.spyOn(storage, 'listFavoriteSources');
    const workScanSpy = vi.spyOn(storage, 'getWork');
    const workBatchSpy = vi.spyOn(storage, 'getWorks');
    const diagnosticCountSpy = vi.spyOn(storage, 'readFavoriteResolutionCounts');
    const id = await addResolvedWork(storage, { id: 'work_weekly', kind: 'anime', title: 'Hebdomadaire' });
    await storage.putLibrary(createLibrary(primaryLibraryId, [id]));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_weekly'), occursAt: '2026-09-08T18:30:00.000Z', releaseLabel: 'Épisode 7', workId: id }));
    const handler = createWebBridgeRequestHandler(storage);
    await expect(handler({ type: 'bootstrap.read', requestId: 'request_bootstrap' })).resolves.toMatchObject({ libraryCount: 1 });
    expect(agendaSpy).not.toHaveBeenCalled();
    expect(sourceScanSpy).not.toHaveBeenCalled();
    expect(workScanSpy).not.toHaveBeenCalled();
    expect(workBatchSpy).not.toHaveBeenCalled();
    expect(diagnosticCountSpy).not.toHaveBeenCalled();
    const period = await handler({ type: 'agenda.read', requestId: 'request_agenda', from: '2026-09-07', to: '2026-09-14' });
    expect(agendaSpy).toHaveBeenCalledWith({ from: expect.stringMatching(/^2026-09-0[67]T/u), limit: 100, to: expect.stringMatching(/^2026-09-1[34]T/u) });
    expect(period).toMatchObject({ entries: [{ availability: 'official', occursAt: '2026-09-08T18:30:00.000Z', releaseLabel: 'Épisode 7', sourceUrl: 'https://reader.example/work_weekly' }], from: '2026-09-07', to: '2026-09-14' });
  });

  it('reads all 1400 library entries and accepts cursors after the former cap', async () => {
    const storage = new MemoryStoragePort();
    const ids = Array.from({ length: 1400 }, (_, index) => workId(`work_scan${String(index).padStart(4, '0')}`));
    await storage.putLibrary(createLibrary(primaryLibraryId, ids));
    for (const id of ids) await storage.putWork(createWork({ id, externalReferences: [], mediaKind: 'manga', preferredTitle: id }));
    const handler = createWebBridgeRequestHandler(storage);
    const result = await handler({ type: 'library.read', requestId: 'request_cap', query: { cursor: 'offset:1392', facet: 'all', limit: 24, sort: 'TITLE_ASC' } });
    expect(result).toMatchObject({ statistics: { total: 1400 }, total: 1400, truncated: false, hasMore: false });
    if (!('items' in result)) throw new Error('expected-library-page');
    expect(result.items).toHaveLength(8);
    const search = await handler({ type: 'library.read', requestId: 'request_search_last', query: { search: 'scan1399', facet: 'all', limit: 24, sort: 'TITLE_ASC' } });
    expect(search).toMatchObject({ total: 1, items: [{ workId: ids[1399] }] });
  });

  it('publishes a pending manga and counts it before any provider hydration', async () => {
    const storage = new MemoryStoragePort();
    const adapter: FavoriteSourceAdapter = { id: 'fixture-manga', origins: ['https://reader.example'], analyze: (input, url) => createSourceEvidence({ aliases: [], canonicalUrl: url.url, diagnostics: [], key: input.sourceKey, mediaKind: 'MANGA', proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-manga', strategy: 'exact-origin', title: 'Pending Manga' }) };
    await importFavoriteSources([{ bookmarkId: 'pending-web-manga', folderPath: ['Manga'], order: 4, state: 'eligible', title: 'Pending Manga chapitre 5', url: 'https://reader.example/series/pending-manga' }], storage, '2026-09-12T00:00:00.000Z', [adapter]);
    const handler = createWebBridgeRequestHandler(storage);

    await expect(handler({ type: 'bootstrap.read', requestId: 'request_pending_bootstrap' })).resolves.toMatchObject({ libraryCount: 1, protocolVersion: 4 });
    await expect(handler({ type: 'library.read', requestId: 'request_pending_library', query: { facet: 'all', limit: 24, sort: 'ADDED_DESC' } })).resolves.toMatchObject({
      items: [{ mediaKind: 'manga', resolutionState: 'preparation', sourceUrl: 'https://reader.example/series/pending-manga', title: 'Pending Manga' }],
      statistics: { total: 1 },
      total: 1,
    });
  });

  it('truncates a large Agenda projection below the transport ceiling', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_largeagenda');
    await storage.putWork(createWork({ externalReferences: [], id, mediaKind: 'anime', preferredTitle: 'Agenda volumineux' }));
    await storage.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-large-agenda', folderPath: [], id: favoriteSourceId('source_largeagenda'), importedAt: '2026-09-06T00:00:00.000Z', matchedWorkId: id, order: 0, resolution: { kind: 'RESOLVED' }, title: 'Source locale', url: `https://reader.example/${'a'.repeat(1_700)}` }));
    for (let index = 0; index < 100; index += 1) {
      await storage.putAgendaEntry(createAgendaEntry({ availability: 'estimated', id: agendaEntryId(`agenda_large${String(index).padStart(3, '0')}`), occursAt: `2026-09-${String(7 + (index % 7)).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`, releaseLabel: `Sortie ${index}`, workId: id }));
    }
    const period = await createWebBridgeRequestHandler(storage)({ type: 'agenda.read', requestId: 'request_large', from: '2026-09-07', to: '2026-09-14' });
    if (!('entries' in period)) throw new Error('expected-agenda-period');
    expect(period.entries.length).toBeLessThan(100);
    expect(new TextEncoder().encode(JSON.stringify(period)).byteLength).toBeLessThanOrEqual(60 * 1024);
  });
});
