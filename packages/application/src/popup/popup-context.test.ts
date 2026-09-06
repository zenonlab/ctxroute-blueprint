import { describe, expect, it } from 'vitest';
import { createFavoriteSource, createProgress, createReview, createWork, favoriteSourceId, progressId, reviewId, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { parsePageProgress, popupContinuationLimit, readPopupContext } from './popup-context';
import type { PopupContinuationRecord } from './popup-context';

function record(id: string, visitedAt: string, overrides: Partial<PopupContinuationRecord> = {}): PopupContinuationRecord {
  return {
    id,
    mediaType: 'Manga',
    source: 'example.test',
    title: id,
    url: `https://example.test/${id}`,
    visitedAt,
    ...overrides,
  };
}

describe('readPopupContext', () => {
  it('parses only explicit chapter and episode markers', () => {
    expect(parsePageProgress({ title: 'Frieren — Chapitre 141', url: 'https://example.test/frieren' })).toEqual({ kind: 'chapter', value: 141 });
    expect(parsePageProgress({ title: 'Dungeon Meshi', url: 'https://example.test/watch/episode-12.5' })).toEqual({ kind: 'episode', value: 12.5 });
    expect(parsePageProgress({ title: '86 Eighty-Six', url: 'https://example.test/title/86' })).toBeUndefined();
    expect(parsePageProgress({ title: 'Frieren', url: 'https://example.test/chapter-100001' })).toBeUndefined();
  });

  it('extracts the work and preserves its latest useful page', async () => {
    const writes: PopupContinuationRecord[][] = [];
    const cache = {
      read: async () => [record('frieren', '2026-09-03T10:00:00.000Z', { url: 'https://other.test/frieren-1' })],
      write: async (items: readonly PopupContinuationRecord[]) => { writes.push([...items]); },
    };
    const result = await readPopupContext({
      cache,
      now: () => '2026-09-04T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Frieren — Chapitre 141 — Example', url: 'https://example.test/frieren/141' }) },
      storage: new MemoryStoragePort(),
    });

    expect(result.active).toMatchObject({ id: 'frieren', source: 'example.test', title: 'Frieren', url: 'https://example.test/frieren/141' });
    expect(result.continuations).toEqual([]);
    expect(writes.at(-1)?.[0]?.url).toBe('https://example.test/frieren/141');
  });

  it('expires old and completed entries and keeps the cache bounded', async () => {
    let written: readonly PopupContinuationRecord[] = [];
    const recent = Array.from({ length: 7 }, (_, index) => record(`work-${index}`, `2026-09-0${index + 1}T10:00:00.000Z`));
    const result = await readPopupContext({
      cache: {
        read: async () => [
          ...recent,
          record('finished', '2026-09-04T10:00:00.000Z', { completed: true }),
          record('expired', '2026-07-01T10:00:00.000Z'),
        ],
        write: async (items) => { written = items; },
      },
      now: () => '2026-09-08T10:00:00.000Z',
      pageContext: { readActivePage: async () => undefined },
      storage: new MemoryStoragePort(),
    });

    expect(result.continuations).toHaveLength(popupContinuationLimit);
    expect(result.continuations.map(({ id }) => id)).not.toContain('finished');
    expect(result.continuations.map(({ id }) => id)).not.toContain('expired');
    expect(written).toHaveLength(popupContinuationLimit);
  });

  it('ignores browser-internal pages while preserving cached continuations', async () => {
    const cached = [record('dandadan', '2026-09-04T09:00:00.000Z')];
    const result = await readPopupContext({
      cache: { read: async () => cached, write: async () => undefined },
      now: () => '2026-09-04T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Extensions', url: 'chrome://extensions' }) },
      storage: new MemoryStoragePort(),
    });
    expect(result).toEqual({ continuations: cached });
  });

  it('correlates one resolved local Work and persists only a compatible increase', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_frieren');
    const review = createReview({ id: reviewId('review_frieren'), matchedWorkId: id, sourceLabel: 'https://reader.test/frieren', status: 'resolved', title: 'Frieren' });
    await storage.transaction(['favoriteSources', 'progress', 'reviews', 'works'], async (session) => {
      await session.putWork(createWork({ externalReferences: [], id, mediaKind: 'manga', preferredTitle: 'Frieren' }));
      await session.putReview(review);
      await session.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-frieren', folderPath: ['Manga'], id: favoriteSourceId('source_frieren'), importedAt: '2026-09-01T10:00:00.000Z', order: 0, reviewId: review.id, title: 'Frieren', url: 'https://reader.test/frieren' }));
      await session.putProgress(createProgress({ id: progressId('progress_frieren'), kind: 'chapter', maximum: 200, value: 140, workId: id }));
    });
    const cacheWrites: PopupContinuationRecord[][] = [];
    const cache = { read: async () => [], write: async (items: readonly PopupContinuationRecord[]) => { cacheWrites.push([...items]); } };

    const increased = await readPopupContext({
      cache,
      now: () => '2026-09-06T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Frieren — Chapitre 141 — Reader', url: 'https://reader.test/frieren/chapter-141' }) },
      storage,
    });
    expect(increased.active).toMatchObject({ id, indicator: '141 / 200', mediaType: 'Manga', title: 'Frieren' });
    expect((await storage.findProgressByWorkId(id))?.value).toBe(141);
    expect(cacheWrites.at(-1)?.[0]).toMatchObject({ id, url: 'https://reader.test/frieren/chapter-141' });

    for (const [marker, value] of [['Chapitre', 141], ['Chapitre', 139], ['Chapitre', 201], ['Épisode', 142]] as const) {
      const unchanged = await readPopupContext({
        cache: { read: async () => cacheWrites.at(-1) ?? [], write: async () => undefined },
        now: () => '2026-09-06T11:00:00.000Z',
        pageContext: { readActivePage: async () => ({ title: `Frieren — ${marker} ${value} — Reader`, url: `https://reader.test/frieren/${marker}-${value}` }) },
        storage,
      });
      expect(unchanged.active?.indicator).toBe('141 / 200');
    }
    expect((await storage.findProgressByWorkId(id))?.value).toBe(141);
  });

  it('creates progress for one resolved Work and writes nothing for an ambiguous title', async () => {
    const storage = new MemoryStoragePort();
    const frierenId = workId('work_frieren-new');
    const otherId = workId('work_frieren-other');
    const firstReview = createReview({ id: reviewId('review_frieren-new'), matchedWorkId: frierenId, sourceLabel: 'source-a', status: 'resolved', title: 'Frieren' });
    await storage.transaction(['favoriteSources', 'reviews', 'works'], async (session) => {
      await session.putWork(createWork({ externalReferences: [], id: frierenId, mediaKind: 'manga', preferredTitle: 'Frieren' }));
      await session.putReview(firstReview);
      await session.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-a', folderPath: [], id: favoriteSourceId('source_frieren-new'), importedAt: '2026-09-01T10:00:00.000Z', order: 0, reviewId: firstReview.id, title: 'Frieren', url: 'https://a.test/frieren' }));
    });
    const dependencies = {
      cache: { read: async () => [], write: async () => undefined },
      now: () => '2026-09-06T10:00:00.000Z',
      pageContext: { readActivePage: async () => ({ title: 'Frieren — Chapitre 1', url: 'https://a.test/frieren/chapter-1' }) },
      storage,
    };
    expect((await readPopupContext(dependencies)).active?.indicator).toBe('1 / -');
    expect((await storage.findProgressByWorkId(frierenId))?.value).toBe(1);

    const secondReview = createReview({ id: reviewId('review_frieren-other'), matchedWorkId: otherId, sourceLabel: 'source-b', status: 'resolved', title: 'Frieren' });
    await storage.transaction(['favoriteSources', 'reviews', 'works'], async (session) => {
      await session.putWork(createWork({ externalReferences: [], id: otherId, mediaKind: 'manga', preferredTitle: 'Frieren bis' }));
      await session.putReview(secondReview);
      await session.putFavoriteSource(createFavoriteSource({ bookmarkId: 'bookmark-b', folderPath: [], id: favoriteSourceId('source_frieren-other'), importedAt: '2026-09-01T10:00:00.000Z', order: 1, reviewId: secondReview.id, title: 'Frieren', url: 'https://b.test/frieren' }));
    });
    const ambiguous = await readPopupContext({ ...dependencies, pageContext: { readActivePage: async () => ({ title: 'Frieren — Chapitre 2', url: 'https://b.test/frieren/chapter-2' }) } });
    expect(ambiguous.active).toMatchObject({ id: 'frieren', indicator: '- / -', mediaType: 'Œuvre' });
    expect(await storage.findProgressByWorkId(otherId)).toBeUndefined();
  });
});
