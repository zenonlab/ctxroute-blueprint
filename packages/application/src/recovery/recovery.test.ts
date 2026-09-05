import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createReview, favoriteSourceId, reviewId } from '@tobirink/domain';
import { MemoryRecoveryStore } from '../../../contracts/src/export/memory-recovery-store';
import { createPrivateExport, importPrivateExport, validatePrivateExport } from './private-export';

const empty = { agenda: [], favoriteSources: [], libraries: [], progress: [], reminders: [], reviews: [], works: [] };

describe('private recovery', () => {
  it('creates and validates a versioned export', async () => {
    const review = createReview({ id: reviewId('review_exported'), sourceLabel: 'reader.example', status: 'pending', title: 'Titre privé' });
    const source = createFavoriteSource({ bookmarkId: 'bookmark-exported', folderPath: ['Lectures'], id: favoriteSourceId('source_exported'), importedAt: '2026-09-04T09:00:00.000Z', order: 0, reviewId: review.id, title: 'Titre privé', url: 'https://reader.example/private' });
    const value = await createPrivateExport(new MemoryRecoveryStore({ ...empty, favoriteSources: [source], reviews: [review] }), '2026-09-04T10:00:00.000Z');
    expect(value.version).toBe(2);
    expect(value.favoriteSources).toEqual([source]);
    expect(validatePrivateExport(JSON.stringify(value))).toEqual(value);
  });

  it('validates everything and requires confirmation before atomic replacement', async () => {
    const store = new MemoryRecoveryStore(empty);
    const value = await createPrivateExport(store, '2026-09-04T10:00:00.000Z');
    await expect(importPrivateExport(JSON.stringify({ ...value, version: 3 }), store, 'replace-private-state')).rejects.toThrow();
    await expect(importPrivateExport(JSON.stringify(value), store, 'no')).rejects.toThrow('confirmation');
    await importPrivateExport(JSON.stringify(value), store, 'replace-private-state');
    expect(store.replaceCount).toBe(1);
  });

  it('imports a version 1 export with no invented favorite sources', async () => {
    const store = new MemoryRecoveryStore(empty);
    const legacy = { ...empty, exportedAt: '2026-09-04T10:00:00.000Z', format: 'tobirink-private-export', version: 1 };
    const { favoriteSources: _omitted, ...versionOne } = legacy;
    await importPrivateExport(JSON.stringify(versionOne), store, 'replace-private-state');
    expect((await store.readSnapshot()).favoriteSources).toEqual([]);
  });
});
