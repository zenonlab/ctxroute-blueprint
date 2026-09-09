import { describe, expect, it } from 'vitest';
import { extensionMessageSchema } from './messages';
import { libraryCatalogueResponseSchema } from './library-catalogue-messages';

describe('library catalogue messages', () => {
  it('accepts bounded multi-select queries', () => {
    expect(extensionMessageSchema.safeParse({
      facets: { genre: { adventure: 'include', fantasy: 'include' }, status: { ONGOING: 'exclude' } },
      offset: 24, query: 'Hunter', sort: 'POPULARITY_DESC', type: 'library.catalogue.read', version: 1,
    }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ facets: { genre: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`genre-${index}`, 'include'])) }, sort: 'TITLE_ASC', type: 'library.catalogue.read', version: 1 }).success).toBe(false);
  });

  it('validates stable facet and statistic snapshots', () => {
    expect(libraryCatalogueResponseSchema.safeParse({ ok: true, snapshot: {
      facets: { format: [], genre: [{ count: 2, label: 'Fantasy', value: 'fantasy' }], progress: [], source: [], status: [], type: [], year: [] },
      items: [{ detail: 'TV · 2024 · En cours', id: 'work_library-one', mediaType: 'anime', progress: '3 / 12', source: 'anilist', title: 'Frieren' }],
      statistics: { completed: 0, inProgress: 1, knownMetadata: 1, notStarted: 0, total: 1 }, total: 1, truncated: false,
    } }).success).toBe(true);
  });
});
