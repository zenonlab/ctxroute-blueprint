import { describe, expect, it } from 'vitest';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { importFavoriteSources } from './import-favorite-sources';
import { reconcileFavoriteSourcePresence } from './reconcile-favorite-source-presence';

const first = { bookmarkId: 'first', folderPath: [], order: 0, state: 'eligible' as const, title: 'First', url: 'https://reader.example/manga/first' };
const second = { ...first, bookmarkId: 'second', order: 1, title: 'Second', url: 'https://reader.example/manga/second' };

describe('reconcileFavoriteSourcePresence', () => {
  it('B-03 marks a missing browser observation detached without deleting private data', async () => {
    const storage = new MemoryStoragePort();
    await importFavoriteSources([first, second], storage, '2026-09-07T12:00:00.000Z');
    await expect(reconcileFavoriteSourcePresence([second], storage)).resolves.toEqual({ detached: 1, observed: 1 });
    const sources = await storage.listFavoriteSources({ limit: 10 });
    expect(sources.map((source) => [source.bookmarkId, source.presence])).toEqual([['first', 'detached'], ['second', 'observed']]);
    const detached = sources[0];
    if (detached === undefined) throw new Error('Expected detached source.');
    await expect(storage.getFavoriteParseArtifact(detached.id)).resolves.toBeDefined();
    expect(detached.reviewId).toBeUndefined();
  });
});
