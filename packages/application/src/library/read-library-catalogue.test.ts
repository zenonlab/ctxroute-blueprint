import { createFavoriteSource, createLibrary, createProgress, createSourceEvidence, createWork, libraryId, progressId, workId } from '@tobirink/domain';
import type { FavoriteMediaKind } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { describe, expect, it } from 'vitest';
import { importFavoriteSources } from '../use-cases/import-favorite-sources';
import type { FavoriteSourceAdapter } from '../favorites/source-evidence';
import { readLibraryBootstrapSummary, readLibraryCatalogue } from './read-library-catalogue';

function work(id: string, input: { classification?: 'adult' | 'non-adult' | 'unknown'; genre: string; popularity: number; status: 'COMPLETED' | 'ONGOING'; title: string; year: number }) {
  return createWork({
    externalReferences: [{ externalId: id, provider: 'anilist' }], id: workId(`work_item-${id}`), mediaKind: 'anime', preferredTitle: input.title,
    hydration: {
      candidate: { contentClassification: input.classification, editorialStatus: input.status, externalId: id, format: 'TV', genres: [input.genre], mediaKind: 'ANIME', metadataVersion: 1, popularity: { kind: 'MEMBERS', value: input.popularity }, preSerialization: false, provider: 'anilist', startYear: input.year, titles: [input.title] },
      favoriteAliasKeys: [], hydratedAt: '2026-09-09T00:00:00.000Z', matcherVersion: 'matcher-v1', providerTitleKeys: [],
    },
  });
}

function pendingAdapter(mediaKind: FavoriteMediaKind): FavoriteSourceAdapter {
  return {
    id: 'fixture-media',
    origins: ['https://reader.example'],
    analyze: (input, url) => createSourceEvidence({ aliases: [], canonicalUrl: url.url, diagnostics: [], key: input.sourceKey, mediaKind, proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-media', strategy: 'exact-origin', title: input.title }),
  };
}

describe('readLibraryCatalogue', () => {
  it.each([
    ['MANGA', 'Manga'], ['MANHWA', 'Manhwa'], ['MANHUA', 'Manhua'], ['UNKNOWN', 'Inconnu'],
  ] as const)('preserves the parsed %s facet before hydration with include and exclude filters', async (mediaKind, label) => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([{ bookmarkId: 'typed-pending', folderPath: [], order: 1, state: 'eligible', title: 'Local River', url: 'https://reader.example/series/local-river' }], storage, '2026-09-26T00:00:00.000Z', [pendingAdapter(mediaKind)]);

    const included = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), facets: { type: { [mediaKind]: 'include' } } });
    expect(included.total).toBe(1);
    expect(included.items[0]).toMatchObject({ sourceMediaKind: mediaKind, state: 'preparation', title: 'Local River' });
    expect(included.items[0]?.candidate).toBeUndefined();
    expect(included.facets.type).toEqual([{ count: 1, label, value: mediaKind }]);
    const excluded = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), facets: { type: { [mediaKind]: 'exclude' } } });
    expect(excluded.total).toBe(0);
    expect(excluded.facets.type).toEqual(included.facets.type);
  });

  it('replaces two provisional sources with one canonical work and uses its provider subtype', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([0, 1].map((index) => ({ bookmarkId: `duplicate-${index}`, folderPath: [], order: index, state: 'eligible' as const, title: 'Local River', url: `https://reader.example/series/local-river?source=${index}` })), storage, '2026-09-26T00:00:00.000Z', [pendingAdapter('MANGA')]);
    const before = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary') });
    expect(before.total).toBe(2);
    expect(new Set(before.items.map(({ id }) => id)).size).toBe(2);
    expect(before.facets.type).toEqual([{ count: 2, label: 'Manga', value: 'MANGA' }]);

    const canonical = createWork({
      id: workId('work_canonical-river'), mediaKind: 'manga', preferredTitle: 'Canonical River',
      externalReferences: [{ externalId: '12345', provider: 'mangaupdates' }],
      hydration: {
        candidate: { externalId: '12345', mediaKind: 'MANHWA', preSerialization: false, provider: 'mangaupdates', titles: ['Canonical River'] },
        favoriteAliasKeys: [], hydratedAt: '2026-09-26T00:00:00.000Z', matcherVersion: 'matcher-v1', providerTitleKeys: [],
      },
    });
    await storage.putWork(canonical);
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [canonical.id]));
    for (const source of await storage.listFavoriteSources({ limit: 100 })) await storage.putFavoriteSource(createFavoriteSource({ ...source, matchedWorkId: canonical.id, resolution: { kind: 'RESOLVED' } }));

    const after = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), facets: { type: { MANHWA: 'include' } } });
    expect(after).toMatchObject({ total: 1, statistics: { total: 1 }, items: [{ id: canonical.id, state: 'ready' }] });
    expect(after.items[0]?.sourceMediaKind).toBeUndefined();
    expect(after.facets.type).toEqual([{ count: 1, label: 'Manhwa', value: 'MANHWA' }]);
    await expect(storage.readFavoriteResolutionCounts()).resolves.toMatchObject({ observed: 2, resolved: 2 });
    await expect(readLibraryBootstrapSummary(storage, libraryId('library_primary'))).resolves.toEqual({ libraryCount: 1 });
  });

  it('keeps all 1522 synthetic pending sources visible and all 1200 parsed manhwa filterable', async () => {
    const storage = new MemoryStoragePort();
    for (const [mediaKind, count] of [['MANHWA', 1200], ['MANHUA', 200], ['UNKNOWN', 122]] as const) {
      await importFavoriteSources(Array.from({ length: count }, (_, index) => ({ bookmarkId: `${mediaKind}-${index}`, folderPath: [], order: index, state: 'eligible' as const, title: `Synthetic ${mediaKind} ${String(index).padStart(4, '0')}`, url: `https://reader.example/series/${mediaKind.toLowerCase()}-${index}` })), storage, '2026-09-26T00:00:00.000Z', [pendingAdapter(mediaKind)]);
    }
    const snapshot = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), facets: { type: { MANHWA: 'include' } }, offset: 1192, sort: 'TITLE_ASC' });
    expect(snapshot).toMatchObject({ total: 1200, statistics: { total: 1522 }, truncated: false });
    expect(snapshot.items).toHaveLength(8);
    expect(snapshot.items.at(-1)?.title).toBe('Synthetic MANHWA 1199');
    expect(snapshot.facets.type).toContainEqual({ count: 1200, label: 'Manhwa', value: 'MANHWA' });
    expect(snapshot.items.every((item) => item.work === undefined && item.candidate === undefined)).toBe(true);
    await expect(readLibraryBootstrapSummary(storage, libraryId('library_primary'))).resolves.toEqual({ libraryCount: 1522 });
  });
  it('hides only explicit adult works before statistics and keeps unknown visible', async () => {
    const storage = new MemoryStoragePort();
    const works = [
      work('adult', { classification: 'adult', genre: 'Drama', popularity: 1, status: 'ONGOING', title: 'Adult', year: 2026 }),
      work('unknown', { classification: 'unknown', genre: 'Drama', popularity: 2, status: 'ONGOING', title: 'Unknown', year: 2026 }),
      work('safe', { classification: 'non-adult', genre: 'Drama', popularity: 3, status: 'ONGOING', title: 'Safe', year: 2026 }),
    ];
    await storage.putLibrary(createLibrary(libraryId('library_primary'), works.map(({ id }) => id)));
    for (const item of works) await storage.putWork(item);
    const snapshot = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), showAdultContent: false, sort: 'ADDED_DESC' });
    expect(snapshot.items.map(({ title }) => title).sort()).toEqual(['Safe', 'Unknown']);
    expect(snapshot.statistics.total).toBe(2);
  });
  it('sorts and facets 1400 works with storage batches of at most 100 identifiers', async () => {
    const storage = new MemoryStoragePort();
    const works = Array.from({ length: 1400 }, (_, index) => work(String(index), { genre: index === 1399 ? 'Last Genre' : 'Drama', popularity: index, status: 'ONGOING', title: `Synthetic ${String(index).padStart(4, '0')}`, year: 2020 }));
    await storage.putLibrary(createLibrary(libraryId('library_primary'), works.map(value => value.id)));
    for (const item of works) await storage.putWork(item);
    const workBatchSizes: number[] = [];
    const progressBatchSizes: number[] = [];
    const transaction = storage.transaction.bind(storage);
    storage.transaction = async <_TResult>(stores, operation) => transaction(stores, async (session) => {
      const getWorks = session.getWorks.bind(session);
      const findProgressByWorkIds = session.findProgressByWorkIds.bind(session);
      return operation({
        ...session,
        findProgressByWorkIds: async (ids) => { progressBatchSizes.push(ids.length); return findProgressByWorkIds(ids); },
        getWorks: async (ids) => { workBatchSizes.push(ids.length); return getWorks(ids); },
      });
    });
    const snapshot = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'POPULARITY_DESC' });
    expect(snapshot.total).toBe(1400);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.items[0]?.work?.id).toBe(works[1399]?.id);
    expect(snapshot.facets.genre).toContainEqual({ value: 'last genre', label: 'Last Genre', count: 1 });
    expect(workBatchSizes).toEqual(Array(14).fill(100));
    expect(progressBatchSizes).toEqual(Array(14).fill(100));
  });
  it('filters before pagination while keeping stable multi-select facets', async () => {
    const storage = new MemoryStoragePort();
    const works = [
      work('alpha', { genre: 'Adventure', popularity: 20, status: 'ONGOING', title: 'Alpha', year: 2024 }),
      work('beta', { genre: 'Fantasy', popularity: 50, status: 'COMPLETED', title: 'Beta', year: 2023 }),
      work('gamma', { genre: 'Adventure', popularity: 10, status: 'COMPLETED', title: 'Gamma', year: 2022 }),
    ];
    await storage.putLibrary(createLibrary(libraryId('library_primary'), works.map(({ id }) => id)));
    for (const item of works) await storage.putWork(item);
    await storage.putProgress(createProgress({ id: progressId('progress_item-beta'), kind: 'episode', maximum: 12, value: 12, workId: works[1]!.id }));

    const snapshot = await readLibraryCatalogue(storage, {
      facets: { genre: { adventure: 'include', fantasy: 'include' }, status: { ONGOING: 'exclude' } },
      libraryId: libraryId('library_primary'), limit: 1, sort: 'POPULARITY_DESC',
    });

    expect(snapshot.items.map((item) => item.title)).toEqual(['Beta']);
    expect(snapshot.total).toBe(2);
    expect(snapshot.facets.genre).toEqual(expect.arrayContaining([
      { count: 2, label: 'Adventure', value: 'adventure' },
      { count: 1, label: 'Fantasy', value: 'fantasy' },
    ]));
    expect(snapshot.statistics).toEqual({ completed: 1, inProgress: 0, knownMetadata: 3, notStarted: 2, total: 3 });
  });

  it('sorts missing metadata last and validates bounded pagination', async () => {
    const storage = new MemoryStoragePort();
    const known = work('known', { genre: 'Drama', popularity: 5, status: 'ONGOING', title: 'Known', year: 2020 });
    const unknown = createWork({ externalReferences: [], id: workId('work_unknown'), mediaKind: 'manga', preferredTitle: 'Unknown' });
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [unknown.id, known.id]));
    await storage.putWork(unknown); await storage.putWork(known);
    await expect(readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'YEAR_DESC' })).resolves.toMatchObject({ items: [{ work: { id: known.id } }, { work: { id: unknown.id } }] });
    await expect(readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), limit: 25 })).rejects.toThrow(/pagination/u);
  });

  it('projects a parsed manga before hydration and removes its provisional entry after resolution', async () => {
    const storage = new MemoryStoragePort();
    const adapter = {
      analyze: (input: { sourceKey: string }, url: URL) => createSourceEvidence({ aliases: [], canonicalUrl: url.href, diagnostics: [], key: input.sourceKey, mediaKind: 'MANGA', proofs: ['CATEGORY_PATH'], sourceAdapter: 'fixture-manga', strategy: 'exact-origin', title: 'Pending Paper Moon' }),
      id: 'fixture-manga',
      origins: ['https://reader.example'],
    };
    await importFavoriteSources([{ bookmarkId: 'pending-manga', folderPath: ['Manga'], order: 7, state: 'eligible', title: 'Pending Paper Moon chapitre 12', url: 'https://reader.example/series/paper-moon' }], storage, '2026-09-12T00:00:00.000Z', [adapter]);

    const pending = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'ADDED_DESC' });
    expect(pending).toMatchObject({ statistics: { total: 1 }, items: [{ mediaKind: 'manga', state: 'preparation', title: 'Pending Paper Moon' }] });
    await expect(readLibraryBootstrapSummary(storage, libraryId('library_primary'))).resolves.toEqual({ libraryCount: pending.statistics.total });
    expect(pending.items[0]?.work).toBeUndefined();

    const [source] = await storage.listFavoriteSources({ limit: 1 });
    if (source === undefined) throw new Error('missing pending source');
    const resolved = work('paper-moon', { genre: 'Fantasy', popularity: 10, status: 'ONGOING', title: 'Paper Moon', year: 2024 });
    await storage.putFavoriteSource(createFavoriteSource({ ...source, matchedWorkId: resolved.id, resolution: { kind: 'RESOLVED' } }));
    await storage.putWork(resolved);
    await storage.putLibrary(createLibrary(libraryId('library_primary'), [resolved.id]));

    const hydrated = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'ADDED_DESC' });
    expect(hydrated).toMatchObject({ statistics: { total: 1 }, items: [{ id: resolved.id, state: 'ready', title: 'Paper Moon' }] });
    await expect(readLibraryBootstrapSummary(storage, libraryId('library_primary'))).resolves.toEqual({ libraryCount: hydrated.statistics.total });
  });

  it('keeps an unknown parsed identity distinct and excludes an unsupported ordinary link', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([
      { bookmarkId: 'unknown-media', folderPath: [], order: 1, state: 'eligible', title: 'Unclassified Blue Archive', url: 'https://reader.example/title/unclassified-blue-archive' },
      { bookmarkId: 'ordinary-video', folderPath: [], order: 2, state: 'eligible', title: 'Ordinary video', url: 'https://www.youtube.com/watch?v=ordinary-video' },
    ], storage, '2026-09-12T00:00:00.000Z');

    const snapshot = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'ADDED_DESC' });

    expect(snapshot.items).toEqual([expect.objectContaining({ mediaKind: 'unknown', state: 'preparation', title: 'unclassified blue archive' })]);
    expect(snapshot.facets.type).toContainEqual({ count: 1, label: 'Inconnu', value: 'UNKNOWN' });
    await expect(readLibraryBootstrapSummary(storage, libraryId('library_primary'))).resolves.toEqual({ libraryCount: snapshot.statistics.total });
  });
});
