import { describe, expect, it } from 'vitest';
import { D1PublicCatalogueAdapter } from './d1-catalogue-adapter';

describe('D1PublicCatalogueAdapter', () => {
  it('owns the prepared query and forwards only bounded values', async () => {
    const calls: Array<{ query: string; values: Array<number | string | null> }> = [];
    const database = {
      prepare(query: string) {
        const values: Array<number | string | null> = [];
        const call = { query, values };
        calls.push(call);
        return {
          all: async <TResult>() => {
            // SAFETY: the fake row matches every projected catalogue work field used by the methods exercised in this test.
            const results = [{ categoriesJson: '["award-winning"]', chapterTotal: 140, contentClassification: 'non-adult', coverAttribution: 'AniList', coverUrl: 'https://img.example/frieren.jpg', editorialStatus: 'ONGOING', endYear: null, episodeTotal: null, format: 'MANGA', genresJson: '["Adventure","Fantasy"]', id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2, sourceExternalId: '118586', sourceObservedAt: '2026-09-17T00:00:00.000Z', sourceProvider: 'anilist', sourceVersion: 2, startYear: 2020, volumeTotal: 16 }] as TResult[];
            return { results };
          },
          bind(...values: Array<number | string | null>) {
            call.values = values;
            return this;
          },
          first: async <TResult>() => {
            // SAFETY: the fake row matches the catalogue work projection requested by both single-row adapter methods.
            return { categoriesJson: '["award-winning"]', chapterTotal: 140, contentClassification: 'non-adult', coverAttribution: 'AniList', coverUrl: 'https://img.example/frieren.jpg', editorialStatus: 'ONGOING', endYear: null, episodeTotal: null, format: 'MANGA', genresJson: '["Adventure","Fantasy"]', id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2, sourceExternalId: '118586', sourceObservedAt: '2026-09-17T00:00:00.000Z', sourceProvider: 'anilist', sourceVersion: 2, startYear: 2020, volumeTotal: 16 } as TResult;
          },
        };
      },
    };

    const adapter = new D1PublicCatalogueAdapter(database);
    await expect(adapter.listWorksAfter({ id: 'work_dandadan', revision: 1 }, 51)).resolves.toHaveLength(1);
    await expect(adapter.findWork('work_frieren')).resolves.toMatchObject({
      id: 'work_frieren',
      metadata: {
        categories: ['award-winning'], chapterTotal: 140, contentClassification: 'non-adult',
        cover: { attribution: 'AniList', url: 'https://img.example/frieren.jpg' },
        editorialStatus: 'ONGOING', format: 'MANGA', genres: ['Adventure', 'Fantasy'], startYear: 2020, volumeTotal: 16,
        source: { externalId: '118586', observedAt: '2026-09-17T00:00:00.000Z', provider: 'anilist', version: 2 },
      },
    });
    await expect(adapter.resolveReference('anilist', '154587')).resolves.toMatchObject({ id: 'work_frieren' });
    await expect(adapter.searchWorksByTitle('Frieren', 6)).resolves.toHaveLength(1);

    expect(calls.map(({ values }) => values)).toEqual([
      [1, 'work_dandadan', 51],
      ['work_frieren'],
      ['anilist', '154587'],
      ['Frieren', 6],
    ]);
    expect(calls.every(({ query }) => query.includes('?1'))).toBe(true);
  });
});
