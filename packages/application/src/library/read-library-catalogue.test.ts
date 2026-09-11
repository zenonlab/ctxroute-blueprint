import { createLibrary, createProgress, createWork, libraryId, progressId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { describe, expect, it } from 'vitest';
import { readLibraryCatalogue } from './read-library-catalogue';

function work(id: string, input: { genre: string; popularity: number; status: 'COMPLETED' | 'ONGOING'; title: string; year: number }) {
  return createWork({
    externalReferences: [{ externalId: id, provider: 'anilist' }], id: workId(`work_item-${id}`), mediaKind: 'anime', preferredTitle: input.title,
    hydration: {
      candidate: { editorialStatus: input.status, externalId: id, format: 'TV', genres: [input.genre], mediaKind: 'ANIME', metadataVersion: 1, popularity: { kind: 'MEMBERS', value: input.popularity }, preSerialization: false, provider: 'anilist', startYear: input.year, titles: [input.title] },
      favoriteAliasKeys: [], hydratedAt: '2026-09-09T00:00:00.000Z', matcherVersion: 'matcher-v1', providerTitleKeys: [],
    },
  });
}

describe('readLibraryCatalogue', () => {
  it('sorts and facets 1400 works with only 100 concurrent reads per transaction', async () => {
    const storage = new MemoryStoragePort();
    const works = Array.from({ length: 1400 }, (_, index) => work(String(index), { genre: index === 1399 ? 'Last Genre' : 'Drama', popularity: index, status: 'ONGOING', title: `Synthetic ${String(index).padStart(4, '0')}`, year: 2020 }));
    await storage.putLibrary(createLibrary(libraryId('library_primary'), works.map(value => value.id)));
    for (const item of works) await storage.putWork(item);
    let active = 0; let peak = 0;
    const getWork = storage.getWork.bind(storage);
    storage.getWork = async id => { active += 1; peak = Math.max(active, peak); try { return await getWork(id); } finally { active -= 1; } };
    const snapshot = await readLibraryCatalogue(storage, { libraryId: libraryId('library_primary'), sort: 'POPULARITY_DESC' });
    expect(snapshot.total).toBe(1400);
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.items[0]?.work.id).toBe(works[1399]?.id);
    expect(snapshot.facets.genre).toContainEqual({ value: 'last genre', label: 'Last Genre', count: 1 });
    expect(peak).toBeLessThanOrEqual(100);
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

    expect(snapshot.items.map(({ work: item }) => item.preferredTitle)).toEqual(['Beta']);
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
});
