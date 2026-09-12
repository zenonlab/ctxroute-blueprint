import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createOrganizerConfiguration, createReview, createWork, favoriteSourceId, reviewId, workId } from '@tobirink/domain';
import { MemoryRecoveryStore } from '../../../contracts/src/export/memory-recovery-store';
import { createPrivateExport, importPrivateExport, validatePrivateExport } from './private-export';

const empty = { agenda: [], favoriteSources: [], libraries: [], progress: [], reminders: [], reviews: [], works: [] };

describe('private recovery', () => {
  it('preserves a deferred actionable Review through export and import', async () => {
    const review = createReview({ availableAt: '2026-09-09T10:00:00.000Z', id: reviewId('review_deferred'), reason: 'NOT_FOUND', sourceLabel: 'Synthetic source', status: 'pending', title: 'Synthetic voyager' });
    const value = await createPrivateExport(new MemoryRecoveryStore({ ...empty, reviews: [review] }), '2026-09-08T10:00:00.000Z');
    const restored = new MemoryRecoveryStore(empty);
    await importPrivateExport(JSON.stringify(value), restored, 'replace-private-state');
    expect((await restored.readSnapshot()).reviews).toEqual([review]);
  });

  it('creates and validates a versioned export', async () => {
    const review = createReview({ id: reviewId('review_exported'), sourceLabel: 'reader.example', status: 'pending', title: 'Titre privé' });
    const source = createFavoriteSource({ bookmarkId: 'bookmark-exported', folderPath: ['Lectures'], id: favoriteSourceId('source_exported'), importedAt: '2026-09-04T09:00:00.000Z', order: 0, reviewId: review.id, title: 'Titre privé', url: 'https://reader.example/private' });
    const organizer = createOrganizerConfiguration({ folders: [{ conditions: { mediaTypes: ['MANGA'] }, id: 'manga', name: 'Manga' }], updatedAt: '2026-09-04T09:30:00.000Z' });
    const value = await createPrivateExport(new MemoryRecoveryStore({ ...empty, favoriteSources: [source], organizer, reviews: [review] }), '2026-09-04T10:00:00.000Z');
    expect(value.version).toBe(5);
    expect(value.favoriteSources).toEqual([source]);
    expect(value.organizer).toEqual(organizer);
    expect(validatePrivateExport(JSON.stringify(value))).toEqual(value);
  });

  it('validates everything and requires confirmation before atomic replacement', async () => {
    const store = new MemoryRecoveryStore(empty);
    const value = await createPrivateExport(store, '2026-09-04T10:00:00.000Z');
    await expect(importPrivateExport(JSON.stringify({ ...value, version: 6 }), store, 'replace-private-state')).rejects.toThrow();
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
    expect((await store.readSnapshot()).organizer).toBeUndefined();
  });

  it('imports a version 2 export with no invented organizer configuration', async () => {
    const store = new MemoryRecoveryStore(empty);
    const legacy = { ...empty, exportedAt: '2026-09-04T10:00:00.000Z', format: 'tobirink-private-export', version: 2 };
    await importPrivateExport(JSON.stringify(legacy), store, 'replace-private-state');
    expect((await store.readSnapshot()).organizer).toBeUndefined();
  });

  it('restores legacy favorite sources as observed', () => {
    const review = createReview({ id: reviewId('review_legacy'), sourceLabel: 'https://reader.example/legacy', status: 'pending', title: 'Legacy' });
    const legacy = {
      ...empty,
      exportedAt: '2026-09-04T10:00:00.000Z',
      favoriteSources: [{ bookmarkId: 'legacy', folderPath: [], id: 'source_legacy', importedAt: '2026-09-04T09:00:00.000Z', order: 0, reviewId: review.id, title: 'Legacy', url: 'https://reader.example/legacy' }],
      format: 'tobirink-private-export',
      reviews: [review],
      version: 2,
    };

    expect(validatePrivateExport(JSON.stringify(legacy)).favoriteSources[0]?.presence).toBe('observed');
  });

  it('round-trips a direct resolved source without Review and rejects missing identities', async () => {
    const work = createWork({ externalReferences: [{ externalId: '1', provider: 'anilist' }], id: workId('work_direct'), mediaKind: 'anime', preferredTitle: 'Synthetic title' });
    const source = createFavoriteSource({ bookmarkId: 'direct', folderPath: [], id: favoriteSourceId('source_direct'), importedAt: '2026-09-04T09:00:00.000Z', matchedWorkId: work.id, order: 0, resolution: { kind: 'RESOLVED' }, resolutionVersions: { decision: 1, matcher: 'test-1', parser: 'test-1', receipt: 1, schema: 1, siteRules: 'test-1' }, title: work.preferredTitle, url: 'https://example.org/anime/1' });
    const value = await createPrivateExport(new MemoryRecoveryStore({ ...empty, favoriteSources: [source], works: [work] }), '2026-09-04T10:00:00.000Z');
    expect(validatePrivateExport(JSON.stringify(value)).favoriteSources).toEqual([source]);
    expect(value.reviews).toEqual([]);
    expect(() => validatePrivateExport(JSON.stringify({ ...value, works: [] }))).toThrow('missing work');
    expect(() => validatePrivateExport(JSON.stringify({ ...value, favoriteSources: [{ ...source, reviewId: 'review_missing' }] }))).toThrow('missing review');
    expect(() => validatePrivateExport(JSON.stringify({ ...value, favoriteSources: [{ ...source, resolution: { kind: 'RESOLVED', reason: 'NOT_FOUND' } }] }))).toThrow();
  });

  it('preserves actionable NOT_FOUND and human no-match through version 3 recovery', () => {
    const review = createReview({ decisionOrigin: 'human', id: reviewId('review_notfound'), reason: 'NOT_FOUND', sourceLabel: 'https://example.org/title', status: 'no-match', title: 'Synthetic title' });
    const legacy = { ...empty, exportedAt: '2026-09-04T10:00:00.000Z', format: 'tobirink-private-export', reviews: [review], version: 3 };
    expect(validatePrivateExport(JSON.stringify(legacy)).reviews).toEqual([review]);
  });

  it('round-trips hydrated public metadata and private aliases without resetting cache age', async () => {
    const work = createWork({
      externalReferences: [{ externalId: '1', provider: 'anilist' }], id: workId('work_hydrated'), mediaKind: 'anime', preferredTitle: 'Synthetic title',
      hydration: { candidate: { externalId: '1', provider: 'anilist', mediaKind: 'ANIME', preSerialization: false, titles: ['Synthetic title'] }, favoriteAliasKeys: ['["ANIME",null,"synthetic title"]'], hydratedAt: '2026-09-01T00:00:00.000Z', matcherVersion: 'favorite-matcher-v3', providerTitleKeys: ['synthetic title'] },
    });
    const value = await createPrivateExport(new MemoryRecoveryStore({ ...empty, works: [work] }), '2026-09-04T10:00:00.000Z');
    expect(validatePrivateExport(JSON.stringify(value)).works).toEqual([work]);
    expect(() => validatePrivateExport(JSON.stringify({ ...value, works: [{ ...work, hydration: { ...work.hydration, candidate: { ...work.hydration?.candidate, externalId: '2' } } }] }))).toThrow();
  });
});
